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
/** One image's own wall clock, so a later image in a run is never starved. */
const PER_IMAGE_TIMEOUT_MS = 300_000;

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

  /**
   * POST one chat/completions request and return the parsed JSON body.
   *
   * The call carries its OWN bound. This adapter fans a multi-image run out
   * into N sequential calls, and with only the node-level watchdog above them
   * the images shared one flat budget: three slow calls left the fourth a few
   * seconds, and when it lost the race the abort took the three finished
   * images with it. A per-call bound makes every image's allowance the same.
   */
  async function post(key: string, body: unknown, signal?: AbortSignal): Promise<any> {
    const bound = AbortSignal.timeout(PER_IMAGE_TIMEOUT_MS);
    const res = await fetchImpl(ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: signal ? AbortSignal.any([signal, bound]) : bound,
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
        // Four is OUR conservative constant, not a provider fact: OpenRouter
        // multiplexes many image models and their input limits differ, so
        // there is no single upstream number to cite the way codex's five is
        // cited. Four keeps a full identity payload (product essential +
        // angle, presenter, mark) inside every model we have routed to.
        maxReferenceImages: 4,
        // Same uplink argument as codex: the provider reads references at
        // reduced resolution anyway, and these ride base64-inlined inside a
        // JSON body — a full-resolution phone photo is tens of megabytes of
        // request for nothing.
        maxReferenceEdge: 2048,
        // N sequential calls, one image each: the server budgets the node by
        // that shape instead of handing the whole run one flat ten minutes.
        perImageTimeoutMs: PER_IMAGE_TIMEOUT_MS,
        imageConcurrency: 1,
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
      // Ordinal binding leaves the identity contract stated once, before the
      // images. On this path there are no filenames to bind to (codex names
      // its files), so when a person reference rides beside a scene or mood
      // image the carve-out is repeated AFTER the image list — the last words
      // the model reads about the pictures it was just handed.
      const identityCoda =
        roles.includes('character') && roles.some((r) => r === 'scene' || r === 'reference')
          ? 'Identity check: the person in this image comes only from the character reference image(s); the scene ' +
            'and reference images lend world, composition, lighting and treatment — take no face or likeness from them.'
          : null;
      const content: unknown[] = [
        { type: 'text', text: refDirectives ? `${req.prompt} ${refDirectives}` : req.prompt },
        ...refs.map((p) => ({
          type: 'image_url',
          image_url: { url: dataUrl(p) },
        })),
        ...(identityCoda ? [{ type: 'text', text: identityCoda }] : []),
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
        /*
         * The set clause for this slot, last, after the pictures and after the
         * identity coda — the final words the model reads.
         *
         * This path used to send the identical body N times and take whatever
         * came back, which is not a set either: nothing asked the run to be
         * consistent and nothing asked it to differ, so four images were four
         * unrelated samples. A fresh object per call, never a mutation of the
         * shared one, so no slot can inherit another slot's text.
         */
        const variation = req.variations?.[i];
        const json = await post(
          key,
          variation
            ? { ...body, messages: [{ role: 'user', content: [...content, { type: 'text', text: variation }] }] }
            : body,
          signal,
        );
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
        // Mirrors generate: an edit given no shape answered at whatever ratio
        // the model felt like, and the drift compounded down refine chains.
        ...(req.width && req.height ? { image_config: { aspect_ratio: aspectRatioFor(req.width, req.height) } } : {}),
      };

      const json = await post(key, body, signal);
      const [buf] = extractImages(json);
      const costUsd = typeof json?.usage?.cost === 'number' ? json.usage.cost : perImageUsd;
      return { images: [opts.saveImage(buf)], costUsd, raw: json };
    },
  };
}
