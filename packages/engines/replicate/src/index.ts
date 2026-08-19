/**
 * Replicate (BYOK) engine adapter.
 *
 * Implements the locked EngineAdapter interface from @scenri/core.
 * All external I/O (HTTP) goes through an injectable fetchImpl so tests
 * never touch the network.
 */

import { readFile } from 'node:fs/promises';
import { ASPECT_TOLERANCE } from '@scenri/core';
import type { EditRequest, EngineAdapter, EngineCapabilities, EngineResult, GenerateRequest } from '@scenri/core';

const API_BASE = 'https://api.replicate.com/v1';
const DEFAULT_MODEL = 'black-forest-labs/flux-schnell';
const DEFAULT_EDIT_MODEL = 'black-forest-labs/flux-kontext-pro';
const DEFAULT_POLL_INTERVAL_MS = 1500;
const DEFAULT_TIMEOUT_MS = 120_000;
const GENERATE_COST_PER_IMAGE_USD = 0.003;
const EDIT_COST_USD = 0.04;

export interface ReplicateEngineOptions {
  getKey: () => string | null;
  saveImage: (buf: Buffer) => string;
  fetchImpl?: typeof fetch;
  model?: string;
  editModel?: string;
  pollIntervalMs?: number;
  timeoutMs?: number;
}

type AspectRatio = '1:1' | '16:9' | '9:16';

interface Prediction {
  status?: string;
  output?: unknown;
  error?: unknown;
  urls?: { get?: unknown };
  [key: string]: unknown;
}

/**
 * The provider takes a fixed ratio menu, not pixel dimensions, and it has no
 * portrait entry: 4:5 (0.8) lands nearer 1:1 than 9:16, so every portrait
 * request used to come back silently squared. Snapping within a bucket is
 * fine; substituting a different bucket is a failed generation, so it says so.
 */
function nearestAspectRatio(width: number, height: number): AspectRatio {
  const candidates: Array<[AspectRatio, number]> = [
    ['1:1', 1],
    ['16:9', 16 / 9],
    ['9:16', 9 / 16],
  ];
  const ratio = width / height;
  let best = candidates[0];
  for (const candidate of candidates) {
    if (Math.abs(candidate[1] - ratio) < Math.abs(best[1] - ratio)) {
      best = candidate;
    }
  }
  if (Math.abs(best[1] - ratio) / ratio > ASPECT_TOLERANCE)
    throw new Error(
      `replicate supports only ${candidates.map((c) => c[0]).join(', ')}; ` +
        `a ${width}x${height} request would be silently returned as ${best[0]}`,
    );
  return best[0];
}

async function httpError(res: Response, context: string): Promise<Error> {
  let snippet = '';
  try {
    snippet = (await res.text()).slice(0, 200);
  } catch {
    // body unreadable; status alone will have to do
  }
  return new Error(`Replicate ${context} failed: HTTP ${res.status}${snippet ? `: ${snippet}` : ''}`);
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('Replicate request aborted'));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error('Replicate request aborted'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function asPrediction(json: unknown, context: string): Prediction {
  if (typeof json !== 'object' || json === null) {
    throw new Error(`Replicate ${context}: response is not a JSON object`);
  }
  return json as Prediction;
}

export function createReplicateEngine(opts: ReplicateEngineOptions): EngineAdapter {
  const {
    getKey,
    saveImage,
    fetchImpl = globalThis.fetch,
    model = DEFAULT_MODEL,
    editModel = DEFAULT_EDIT_MODEL,
    pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  } = opts;

  function requireKey(): string {
    const key = getKey();
    if (!key) {
      throw new Error('Replicate API token is not set. Set a Replicate API token in Settings');
    }
    return key;
  }

  async function createPrediction(
    key: string,
    modelSlug: string,
    input: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<Prediction> {
    const url = `${API_BASE}/models/${modelSlug}/predictions`;
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        Prefer: 'wait',
      },
      body: JSON.stringify({ input }),
      signal,
    });
    if (!res.ok) throw await httpError(res, 'prediction create');
    return asPrediction(await res.json(), 'prediction create');
  }

  async function waitForCompletion(key: string, initial: Prediction, signal?: AbortSignal): Promise<Prediction> {
    let prediction = initial;
    if (prediction.status === 'succeeded') return prediction;

    const failureError = (p: Prediction): Error => {
      const detail = p.error != null ? `: ${String(p.error).slice(0, 200)}` : '';
      return new Error(`Replicate prediction ${p.status}${detail}`);
    };

    if (prediction.status === 'failed' || prediction.status === 'canceled') {
      throw failureError(prediction);
    }

    const getUrl = prediction.urls?.get;
    if (typeof getUrl !== 'string' || getUrl.length === 0) {
      throw new Error(
        `Replicate prediction did not succeed (status: ${prediction.status ?? 'unknown'}) and no polling URL was provided`,
      );
    }

    const deadline = Date.now() + timeoutMs;
    for (;;) {
      if (Date.now() >= deadline) {
        throw new Error(`Replicate prediction timed out after ${timeoutMs}ms`);
      }
      await sleep(pollIntervalMs, signal);
      const res = await fetchImpl(getUrl, {
        headers: { Authorization: `Bearer ${key}` },
        signal,
      });
      if (!res.ok) throw await httpError(res, 'prediction poll');
      prediction = asPrediction(await res.json(), 'prediction poll');
      if (prediction.status === 'succeeded') return prediction;
      if (prediction.status === 'failed' || prediction.status === 'canceled') {
        throw failureError(prediction);
      }
    }
  }

  async function downloadOutputs(prediction: Prediction, signal?: AbortSignal): Promise<string[]> {
    const output = prediction.output;
    let urls: unknown[];
    if (typeof output === 'string') {
      urls = [output];
    } else if (Array.isArray(output)) {
      urls = output;
    } else {
      throw new Error(
        `Replicate prediction succeeded but 'output' is missing or has an unexpected shape (got ${output === undefined ? 'undefined' : typeof output})`,
      );
    }
    if (urls.length === 0) {
      throw new Error("Replicate prediction succeeded but 'output' contains no image URLs");
    }
    const hashes: string[] = [];
    for (const url of urls) {
      if (typeof url !== 'string' || url.length === 0) {
        throw new Error("Replicate prediction 'output' contains a non-string entry");
      }
      const res = await fetchImpl(url, { signal });
      if (!res.ok) throw await httpError(res, 'image download');
      const buf = Buffer.from(await res.arrayBuffer());
      hashes.push(saveImage(buf));
    }
    return hashes;
  }

  return {
    capabilities(): EngineCapabilities {
      return {
        id: 'replicate',
        displayName: 'Replicate (BYOK)',
        localOnly: false,
        supportsEdit: true,
        supportsMask: false,
        // 0, deliberately — see the same note in the fal adapter. generate()
        // sends only prompt/num_outputs/aspect_ratio, so a declared capacity
        // of 1 was a promise this adapter never kept.
        maxReferenceImages: 0,
      };
    },

    async isAvailable(): Promise<{ ok: boolean; reason?: string }> {
      const key = getKey();
      if (key && key.length > 0) return { ok: true };
      return { ok: false, reason: 'Set a Replicate API token in Settings' };
    },

    async costEstimate(req: GenerateRequest | EditRequest): Promise<number> {
      if ('instruction' in req) return EDIT_COST_USD;
      return req.count * GENERATE_COST_PER_IMAGE_USD;
    },

    async generate(req: GenerateRequest, signal?: AbortSignal): Promise<EngineResult> {
      const key = requireKey();
      const created = await createPrediction(
        key,
        model,
        {
          prompt: req.prompt,
          num_outputs: req.count,
          aspect_ratio: nearestAspectRatio(req.width, req.height),
        },
        signal,
      );
      const prediction = await waitForCompletion(key, created, signal);
      const images = await downloadOutputs(prediction, signal);
      return {
        images,
        costUsd: req.count * GENERATE_COST_PER_IMAGE_USD,
        raw: prediction,
      };
    },

    async edit(req: EditRequest, signal?: AbortSignal): Promise<EngineResult> {
      const key = requireKey();
      const file = await readFile(req.sourceImage);
      const created = await createPrediction(
        key,
        editModel,
        {
          prompt: req.instruction,
          input_image: `data:image/png;base64,${file.toString('base64')}`,
        },
        signal,
      );
      const prediction = await waitForCompletion(key, created, signal);
      const images = await downloadOutputs(prediction, signal);
      return {
        images,
        costUsd: EDIT_COST_USD,
        raw: prediction,
      };
    },
  };
}
