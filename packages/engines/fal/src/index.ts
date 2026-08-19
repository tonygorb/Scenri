import { readFile } from 'node:fs/promises';
import type { EditRequest, EngineAdapter, EngineCapabilities, EngineResult, GenerateRequest } from '@scenri/core';

export interface FalEngineOptions {
  /** Returns the user's fal.ai API key, or null/empty when not configured. */
  getKey: () => string | null;
  /** Persists an image buffer into the content-addressed store; returns its hash. */
  saveImage: (buf: Buffer) => string;
  /** Injectable fetch for tests. Defaults to globalThis.fetch. */
  fetchImpl?: typeof fetch;
  /** Generation model slug. Defaults to 'fal-ai/flux/schnell'. */
  model?: string;
  /** Edit model slug. Defaults to 'fal-ai/flux-kontext/dev'. */
  editModel?: string;
}

const DEFAULT_MODEL = 'fal-ai/flux/schnell';
const DEFAULT_EDIT_MODEL = 'fal-ai/flux-kontext/dev';
const GENERATE_COST_PER_IMAGE_USD = 0.003;
const EDIT_COST_USD = 0.025;

function snippetOf(text: string): string {
  return text.slice(0, 200);
}

/** Decode a data: URI into a Buffer. Base64 and percent-encoded payloads supported. */
function decodeDataUri(uri: string): Buffer {
  const match = /^data:([^,]*),([\s\S]*)$/.exec(uri);
  if (!match) throw new Error('fal.ai returned an invalid data: URI');
  const meta = match[1] ?? '';
  const payload = match[2] ?? '';
  const isBase64 = meta.split(';').some((p) => p.trim().toLowerCase() === 'base64');
  if (isBase64) return Buffer.from(payload, 'base64');
  return Buffer.from(decodeURIComponent(payload), 'utf8');
}

function mimeForPath(path: string): string {
  const ext = path.toLowerCase().split('.').pop() ?? '';
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'gif') return 'image/gif';
  return 'image/png';
}

/** Accepts a data: URI as-is; otherwise reads the file at the given path. */
async function sourceImageToDataUri(source: string): Promise<string> {
  if (source.startsWith('data:')) return source;
  const buf = await readFile(source);
  return `data:${mimeForPath(source)};base64,${buf.toString('base64')}`;
}

/** Defensive parse of { images: [{ url }] }. Throws a clear Error on any missing field. */
function extractImageUrls(json: unknown): string[] {
  if (typeof json !== 'object' || json === null) {
    throw new Error('fal.ai response was not a JSON object');
  }
  const images = (json as { images?: unknown }).images;
  if (!Array.isArray(images)) {
    throw new Error('fal.ai response missing "images" array');
  }
  if (images.length === 0) {
    throw new Error('fal.ai response contained no images');
  }
  return images.map((img, i) => {
    const url = (img as { url?: unknown } | null)?.url;
    if (typeof url !== 'string' || url.length === 0) {
      throw new Error(`fal.ai response images[${i}] missing "url"`);
    }
    return url;
  });
}

export function createFalEngine(opts: FalEngineOptions): EngineAdapter {
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  const model = opts.model ?? DEFAULT_MODEL;
  const editModel = opts.editModel ?? DEFAULT_EDIT_MODEL;

  function requireKey(): string {
    const key = opts.getKey();
    if (!key) throw new Error('fal.ai API key not set. Set a fal.ai key in Settings.');
    return key;
  }

  async function postJson(endpointModel: string, key: string, body: unknown, signal?: AbortSignal): Promise<unknown> {
    const res = await fetchImpl(`https://fal.run/${endpointModel}`, {
      method: 'POST',
      headers: {
        Authorization: `Key ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal,
    });
    if (!res.ok) {
      let snippet = '';
      try {
        snippet = snippetOf(await res.text());
      } catch {
        /* body unreadable; report status alone */
      }
      throw new Error(`fal.ai request failed: HTTP ${res.status}${snippet ? `: ${snippet}` : ''}`);
    }
    try {
      return await res.json();
    } catch {
      throw new Error(`fal.ai returned a non-JSON response (HTTP ${res.status})`);
    }
  }

  async function fetchImageBuffer(url: string, signal?: AbortSignal): Promise<Buffer> {
    if (url.startsWith('data:')) return decodeDataUri(url);
    const res = await fetchImpl(url, { signal });
    if (!res.ok) {
      let snippet = '';
      try {
        snippet = snippetOf(await res.text());
      } catch {
        /* body unreadable; report status alone */
      }
      throw new Error(`fal.ai image download failed: HTTP ${res.status}${snippet ? `: ${snippet}` : ''}`);
    }
    return Buffer.from(await res.arrayBuffer());
  }

  async function saveAll(urls: string[], signal?: AbortSignal): Promise<string[]> {
    const hashes: string[] = [];
    for (const url of urls) {
      hashes.push(opts.saveImage(await fetchImageBuffer(url, signal)));
    }
    return hashes;
  }

  return {
    capabilities(): EngineCapabilities {
      return {
        id: 'fal',
        displayName: 'fal.ai (BYOK)',
        localOnly: false,
        supportsEdit: true,
        supportsMask: false,
        // 0, deliberately. This adapter's generate() sends only prompt/size/
        // count — it has never forwarded a reference image to the model. It
        // previously advertised 1, so compileBrief would resolve a product
        // photo, role-tag it, and hand it over to be dropped on the floor:
        // the user got a confident image of the wrong object with no warning.
        // Declaring 0 makes the compiler warn honestly, and the generate
        // route refuses outright when identity references are in play.
        maxReferenceImages: 0,
      };
    },

    async isAvailable() {
      const key = opts.getKey();
      if (key) return { ok: true };
      return { ok: false, reason: 'Set a fal.ai key in Settings' };
    },

    async costEstimate(req: GenerateRequest | EditRequest): Promise<number> {
      if ('instruction' in req) return EDIT_COST_USD;
      return req.count * GENERATE_COST_PER_IMAGE_USD;
    },

    async generate(req: GenerateRequest, signal?: AbortSignal): Promise<EngineResult> {
      const key = requireKey();
      const json = await postJson(
        model,
        key,
        {
          prompt: req.prompt,
          image_size: { width: req.width, height: req.height },
          num_images: req.count,
        },
        signal,
      );
      const urls = extractImageUrls(json);
      const images = await saveAll(urls, signal);
      return { images, costUsd: req.count * GENERATE_COST_PER_IMAGE_USD, raw: json };
    },

    async edit(req: EditRequest, signal?: AbortSignal): Promise<EngineResult> {
      const key = requireKey();
      const imageUrl = await sourceImageToDataUri(req.sourceImage);
      const json = await postJson(editModel, key, { prompt: req.instruction, image_url: imageUrl }, signal);
      const urls = extractImageUrls(json);
      const images = await saveAll(urls, signal);
      return { images, costUsd: EDIT_COST_USD, raw: json };
    },
  };
}
