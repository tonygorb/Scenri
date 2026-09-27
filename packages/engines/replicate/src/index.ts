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
/** The expansion model: given a picture and a canvas, it paints only the margin. */
const DEFAULT_EXPAND_MODEL = 'bria/expand-image';
const DEFAULT_POLL_INTERVAL_MS = 1500;
/**
 * The adapter's own ceiling on one prediction. The server's node budget is ten
 * minutes too, so in practice the caller's signal ends a slow prediction first
 * and this is only the backstop. It used to be two minutes, which gave up on a
 * slow prediction long before anyone else had, and it went on to be billed.
 */
const DEFAULT_TIMEOUT_MS = 600_000;
/** Replicate refuses a Cancel-After shorter than this. */
const MIN_CANCEL_AFTER_S = 5;
/** A cancel is best effort, so a Stop never waits on one longer than this. */
const CANCEL_TIMEOUT_MS = 5_000;
const GENERATE_COST_PER_IMAGE_USD = 0.003;
const EDIT_COST_USD = 0.04;

export interface ReplicateEngineOptions {
  getKey: () => string | null;
  saveImage: (buf: Buffer) => string;
  fetchImpl?: typeof fetch;
  model?: string;
  editModel?: string;
  /** Outpainting model slug, used when an edit is an expansion. */
  expandModel?: string;
  pollIntervalMs?: number;
  /** The adapter's own ceiling on one prediction, in ms; also sent to Replicate as Cancel-After, rounded up to whole seconds and never below five. */
  timeoutMs?: number;
}

type AspectRatio = '1:1' | '16:9' | '21:9' | '3:2' | '2:3' | '4:5' | '5:4' | '3:4' | '4:3' | '9:16' | '9:21';

interface Prediction {
  id?: unknown;
  status?: string;
  output?: unknown;
  error?: unknown;
  urls?: { get?: unknown; cancel?: unknown };
  [key: string]: unknown;
}

/**
 * The provider takes a fixed ratio menu, not pixel dimensions: the eleven
 * black-forest-labs/flux-schnell documents. This table once held only three of
 * them, so the 4:5 portrait Scenri defaults to was refused before it was ever
 * sent. Snapping within a bucket is fine; substituting a different bucket is a
 * failed generation, so a shape the menu cannot hold still says so.
 */
function nearestAspectRatio(width: number, height: number): AspectRatio {
  const candidates: Array<[AspectRatio, number]> = [
    ['1:1', 1],
    ['16:9', 16 / 9],
    ['21:9', 21 / 9],
    ['3:2', 3 / 2],
    ['2:3', 2 / 3],
    ['4:5', 4 / 5],
    ['5:4', 5 / 4],
    ['3:4', 3 / 4],
    ['4:3', 4 / 3],
    ['9:16', 9 / 16],
    ['9:21', 9 / 21],
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
    expandModel = DEFAULT_EXPAND_MODEL,
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
        // Replicate's own copy of the ceiling, measured from creation, so a
        // prediction nobody here can cancel any more (the app quit, or a Stop
        // landed while this request was still open and no id had come back)
        // still stops running, and billing, on its own.
        'Cancel-After': `${Math.max(MIN_CANCEL_AFTER_S, Math.ceil(timeoutMs / 1000))}s`,
      },
      body: JSON.stringify({ input }),
      signal,
    });
    if (!res.ok) throw await httpError(res, 'prediction create');
    return asPrediction(await res.json(), 'prediction create');
  }

  /**
   * Asks Replicate to stop a prediction this adapter has given up on. The URL
   * is the one the create response names, or the documented path built from
   * its id. Never handed the caller's signal: that signal is usually why this
   * runs, and it is already aborted.
   */
  async function cancelPrediction(key: string, prediction: Prediction): Promise<void> {
    const url =
      typeof prediction.urls?.cancel === 'string'
        ? prediction.urls.cancel
        : typeof prediction.id === 'string'
          ? `${API_BASE}/predictions/${prediction.id}/cancel`
          : null;
    if (!url) return;
    try {
      await fetchImpl(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(CANCEL_TIMEOUT_MS),
      });
    } catch {
      // best effort; the error that ended the wait is the one worth reporting
    }
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
      // Still running with nothing to poll: stop it rather than leave it to bill.
      await cancelPrediction(key, prediction);
      throw new Error(
        `Replicate prediction did not succeed (status: ${prediction.status ?? 'unknown'}) and no polling URL was provided`,
      );
    }

    /*
     * Once this wait ends without a result, nobody will ever read one, so a
     * prediction still running is only spending the user's money. A Stop, the
     * caller's budget and this adapter's own ceiling all land in the catch,
     * and each asks Replicate to cancel before the error goes up. One that
     * already failed or was canceled has nothing left to stop.
     */
    const deadline = Date.now() + timeoutMs;
    try {
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
    } catch (err) {
      if (prediction.status !== 'failed' && prediction.status !== 'canceled') {
        await cancelPrediction(key, initial);
      }
      throw err;
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
        // bria/expand-image: the picture plus the canvas it belongs in.
        supportsOutpaint: true,
        // 0, deliberately — see the same note in the fal adapter. generate()
        // sends no reference image, only its prompt and settings, so a
        // declared capacity of 1 was a promise this adapter never kept.
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
          // Left alone, flux-schnell answers in webp at quality 80: a lossy
          // frame the server then re-encodes to png anyway. A png arrives as
          // delivered. The edit models need no such line: kontext-pro already
          // answers in png, and bria's expander has no format field. The
          // generate input assumes the flux-schnell schema, as aspect_ratio does.
          output_format: 'png',
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
      const dataUri = `data:image/png;base64,${file.toString('base64')}`;
      /*
       * An expansion is its own operation, not an instruction. The editor this
       * adapter otherwise uses re-renders the whole frame from a sentence,
       * which is exactly the path that cannot be relied on to continue a
       * picture across a join; the expand model is handed the picture and the
       * canvas it belongs in, and paints only what is missing.
       */
      if (req.expand && req.width && req.height) {
        const started = await createPrediction(
          key,
          expandModel,
          {
            image_url: dataUri,
            canvas_size: [req.width, req.height],
            original_image_size: [req.expand.width, req.expand.height],
            original_image_location: [req.expand.left, req.expand.top],
            ...(req.instruction.trim() ? { prompt: req.instruction } : {}),
            ...(typeof req.seed === 'number' ? { seed: req.seed } : {}),
          },
          signal,
        );
        const done = await waitForCompletion(key, started, signal);
        return { images: await downloadOutputs(done, signal), costUsd: EDIT_COST_USD, raw: done };
      }
      const created = await createPrediction(
        key,
        editModel,
        {
          prompt: req.instruction,
          input_image: dataUri,
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
