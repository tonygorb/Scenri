// Adapter for openrouter — implemented per the MVP build plan (TDD). Interface: @scenri/core/src/engine.ts
import fs from 'node:fs';
import {
  EDIT_REFERENCE_ROLE_DIRECTIVE,
  REFERENCE_ROLE_DIRECTIVE,
  type EngineAdapter,
  type EngineCapabilities,
  type EngineResult,
  type GenerateRequest,
  type EditRequest,
} from '@scenri/core';

const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';
const DEFAULT_MODEL = 'google/gemini-2.5-flash-image';
const DEFAULT_COST_PER_IMAGE_USD = 0.04;

export interface OpenRouterEngineOptions {
  getKey: () => string | null;
  saveImage: (buf: Buffer) => string;
  fetchImpl?: typeof fetch;
  model?: string;
  editModel?: string;
  costPerImageUsd?: number;
}

/** Read a local image file and wrap it as a base64 PNG data URL. */
function dataUrl(path: string): string {
  return `data:image/png;base64,${fs.readFileSync(path).toString('base64')}`;
}

function snippet(body: string): string {
  return body.length > 200 ? body.slice(0, 200) : body;
}

/**
 * The shapes this API will accept, as ratios.
 *
 * Asking for a size in prose does not work here: the model defaults to a square
 * and the server's delivered-image check (ASPECT_TOLERANCE) then rejects it, so
 * every portrait, story and landscape brief failed on this engine while square
 * ones passed. The request has to carry the ratio as a field.
 */
const ASPECT_RATIOS: [string, number][] = [
  ['1:1', 1],
  ['2:3', 2 / 3],
  ['3:2', 3 / 2],
  ['3:4', 3 / 4],
  ['4:3', 4 / 3],
  ['4:5', 4 / 5],
  ['5:4', 5 / 4],
  ['9:16', 9 / 16],
  ['16:9', 16 / 9],
  ['21:9', 21 / 9],
];

/** Nearest supported ratio to what the compiler asked for. Scenri's four formats all land exactly. */
export function aspectRatioFor(width: number, height: number): string {
  if (!(width > 0) || !(height > 0)) return '1:1';
  const want = width / height;
  let best = ASPECT_RATIOS[0];
  for (const entry of ASPECT_RATIOS) {
    if (Math.abs(entry[1] - want) < Math.abs(best[1] - want)) best = entry;
  }
  return best[0];
}

export function createOpenRouterEngine(opts: OpenRouterEngineOptions): EngineAdapter {
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  const perImageUsd = opts.costPerImageUsd ?? DEFAULT_COST_PER_IMAGE_USD;

  function requireKey(): string {
    const key = opts.getKey();
    if (!key) throw new Error('OpenRouter API key is not set. Set an OpenRouter API key in Settings.');
    return key;
  }

  /** POST one chat/completions request and return the parsed JSON body. */
  async function post(key: string, body: unknown, signal?: AbortSignal): Promise<any> {
    const res = await fetchImpl(ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal,
    });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`OpenRouter request failed: HTTP ${res.status}: ${snippet(text)}`);
    }
    let json: any;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error(`OpenRouter returned non-JSON body (HTTP ${res.status}): ${snippet(text)}`);
    }
    return json;
  }

  /** Extract image buffers from choices[0].message.images[*].image_url.url data URLs. */
  function extractImages(json: any): Buffer[] {
    const message = json?.choices?.[0]?.message;
    if (!message || typeof message !== 'object') {
      throw new Error('OpenRouter response missing choices[0].message');
    }
    const images = message.images;
    if (!Array.isArray(images) || images.length === 0) {
      throw new Error('OpenRouter response contained no images (choices[0].message.images is empty or missing)');
    }
    return images.map((img: any, i: number) => {
      const url = img?.image_url?.url;
      if (typeof url !== 'string') {
        throw new Error(`OpenRouter response image ${i} missing image_url.url`);
      }
      const match = /^data:[^;,]+;base64,(.+)$/s.exec(url);
      if (!match) {
        throw new Error(`OpenRouter response image ${i} is not a base64 data URL`);
      }
      return Buffer.from(match[1], 'base64');
    });
  }

  return {
    capabilities(): EngineCapabilities {
      return {
        id: 'openrouter',
        displayName: 'OpenRouter (BYOK)',
        localOnly: false,
        supportsEdit: true,
        supportsMask: false,
        maxReferenceImages: 4,
      };
    },

    async isAvailable() {
      const key = opts.getKey();
      if (key) return { ok: true };
      return { ok: false, reason: 'Set an OpenRouter API key in Settings' };
    },

    async costEstimate(req: GenerateRequest | EditRequest): Promise<number> {
      const count = 'count' in req ? req.count : 1;
      return count * perImageUsd;
    },

    async generate(req: GenerateRequest, signal?: AbortSignal): Promise<EngineResult> {
      const key = requireKey();
      // Bind each image to its role positionally. Without this the model gets
      // N undifferentiated images plus prose mentioning a product and a
      // person, and has to guess which is which — which is exactly how a
      // presenter's face ends up rendered as the product.
      const roles = req.referenceRoles ?? [];
      const refs = req.referenceImages ?? [];
      const roleDirective = REFERENCE_ROLE_DIRECTIVE;
      const refDirectives = refs
        .map((_, i) => {
          const role = roles[i] ?? 'reference';
          return refs.length > 1
            ? `Attached image ${i + 1} is ${roleDirective[role]}.`
            : `The attached image is ${roleDirective[role]}.`;
        })
        .join(' ');
      const content: unknown[] = [
        { type: 'text', text: refDirectives ? `${req.prompt} ${refDirectives}` : req.prompt },
        ...refs.map((p) => ({
          type: 'image_url',
          image_url: { url: dataUrl(p) },
        })),
      ];
      const body = {
        model: opts.model ?? DEFAULT_MODEL,
        modalities: ['image', 'text'],
        messages: [{ role: 'user', content }],
        image_config: { aspect_ratio: aspectRatioFor(req.width, req.height) },
      };

      const hashes: string[] = [];
      const raws: unknown[] = [];
      let reportedCost = 0;
      let sawReportedCost = false;

      for (let i = 0; i < req.count; i++) {
        const json = await post(key, body, signal);
        raws.push(json);
        for (const buf of extractImages(json)) hashes.push(opts.saveImage(buf));
        if (typeof json?.usage?.cost === 'number') {
          reportedCost += json.usage.cost;
          sawReportedCost = true;
        }
      }

      const costUsd = sawReportedCost ? reportedCost : req.count * perImageUsd;
      return { images: hashes, costUsd, raw: raws };
    },

    async edit(req: EditRequest, signal?: AbortSignal): Promise<EngineResult> {
      const key = requireKey();
      // The source image is attachment 1, so references are named from 2 up.
      // They were previously dropped entirely, which is how "restore the label"
      // reached the model with nothing to restore it from.
      const editRefs = req.referenceImages ?? [];
      const editRoles = req.referenceRoles ?? [];
      const refDirectives = editRefs
        .map((_, i) => `Attached image ${i + 2} is ${EDIT_REFERENCE_ROLE_DIRECTIVE[editRoles[i] ?? 'reference']}.`)
        .join(' ');
      const instruction = refDirectives
        ? `${req.instruction} Attached image 1 is the image to edit. ${refDirectives}`
        : req.instruction;
      const body = {
        model: opts.editModel ?? opts.model ?? DEFAULT_MODEL,
        modalities: ['image', 'text'],
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: instruction },
              { type: 'image_url', image_url: { url: dataUrl(req.sourceImage) } },
              ...editRefs.map((p) => ({ type: 'image_url', image_url: { url: dataUrl(p) } })),
            ],
          },
        ],
      };

      const json = await post(key, body, signal);
      const [buf] = extractImages(json);
      const costUsd = typeof json?.usage?.cost === 'number' ? json.usage.cost : perImageUsd;
      return { images: [opts.saveImage(buf)], costUsd, raw: json };
    },
  };
}
