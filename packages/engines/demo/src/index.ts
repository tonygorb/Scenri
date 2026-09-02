import sharp from 'sharp';
import {
  BUDGET_EXHAUSTED,
  type EngineAdapter,
  type EngineCapabilities,
  type EngineResult,
  type GenerateRequest,
  type EditRequest,
  type OnImageLanded,
} from '@scenri/core';

/**
 * How the demo run behaves, for the tests that need a run to take its time.
 * Every knob is off by default: a plain demo generation lands as fast as sharp
 * can draw, which is what every existing end-to-end spec relies on.
 */
export interface DemoOptions {
  /** Milliseconds between one slot landing and the next. */
  staggerMs?: number;
  /** `reverse` lands the last slot first: the out-of-order case a feed has to survive. */
  order?: 'request' | 'reverse';
  /** A slot that fails, reported the way codex reports a partial run. */
  failSlot?: number;
}

/** The knobs as the end-to-end harness sets them, from the environment; none by default. */
export function demoOptionsFromEnv(env: Record<string, string | undefined>): DemoOptions {
  const out: DemoOptions = {};
  const stagger = Number(env.SCENRI_DEMO_STAGGER_MS);
  if (env.SCENRI_DEMO_STAGGER_MS && Number.isFinite(stagger) && stagger > 0) out.staggerMs = stagger;
  if (env.SCENRI_DEMO_ORDER === 'reverse') out.order = 'reverse';
  const fail = Number(env.SCENRI_DEMO_FAIL_SLOT);
  if (env.SCENRI_DEMO_FAIL_SLOT && Number.isInteger(fail) && fail >= 0) out.failSlot = fail;
  return out;
}

/** Resolves after `ms`, or at once when the signal aborts: the caller reads the signal next. */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Demo engine: always available, zero cost. Renders a placeholder using the
 * brand palette + prompt text so every flow works without keys or agents.
 */
export function createDemoEngine(saveImage: (buf: Buffer) => string, opts: DemoOptions = {}): EngineAdapter {
  const paletteOf = (req: GenerateRequest | EditRequest): string[] => {
    const p = (req.brand?.brand as any)?.palette;
    const hexes = [p?.primary?.hex, p?.secondary?.hex, ...(p?.accent ?? []).map((a: any) => a?.hex)].filter(
      (h: unknown): h is string => typeof h === 'string' && /^#[0-9a-fA-F]{6}$/.test(h),
    );
    return hexes.length ? hexes : ['#4B5563', '#9CA3AF'];
  };

  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').slice(0, 90);

  async function render(colors: string[], label: string, w: number, h: number, seed: number): Promise<Buffer> {
    const c0 = colors[seed % colors.length];
    const c1 = colors[(seed + 1) % colors.length] ?? '#111111';
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
      <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="${c0}"/><stop offset="100%" stop-color="${c1}"/>
      </linearGradient></defs>
      <rect width="100%" height="100%" fill="url(#g)"/>
      <circle cx="${w * (0.25 + (0.5 * ((seed * 37) % 100)) / 100)}" cy="${h * 0.38}" r="${Math.min(w, h) * 0.18}" fill="#ffffff" opacity="0.25"/>
      <text x="24" y="${h - 48}" font-family="Helvetica, Arial" font-size="${Math.max(14, Math.round(w / 42))}" fill="#ffffff" opacity="0.92">${esc(label)}</text>
      <text x="24" y="${h - 22}" font-family="Helvetica, Arial" font-size="12" fill="#ffffff" opacity="0.6">Scenri demo engine</text>
    </svg>`;
    return sharp(Buffer.from(svg)).png().toBuffer();
  }

  return {
    capabilities(): EngineCapabilities {
      return {
        id: 'demo',
        displayName: 'Demo',
        localOnly: false,
        supportsEdit: true,
        supportsMask: false,
        // It draws a placeholder for everything, expansions included, so it
        // stands in for a capable engine rather than blocking the path in
        // development and in the end-to-end suite. `placeholder` below is what
        // says none of this is a real picture.
        supportsOutpaint: true,
        maxReferenceImages: 0,
        placeholder: true,
      };
    },
    async isAvailable() {
      return { ok: true };
    },
    async costEstimate() {
      return 0;
    },
    async generate(req: GenerateRequest, signal?: AbortSignal, onImage?: OnImageLanded): Promise<EngineResult> {
      const colors = paletteOf(req);
      const count = Math.max(1, req.count);
      const slots = Array.from({ length: count }, (_, i) => i);
      if (opts.order === 'reverse') slots.reverse();
      const landed = new Map<number, string>();
      const failures: string[] = [];
      for (const [position, slot] of slots.entries()) {
        if (position > 0 && opts.staggerMs) await sleep(opts.staggerMs, signal);
        if (signal?.aborted) {
          // a budget abort keeps what landed; a cancel is the user asking for the stop
          if (signal.reason === BUDGET_EXHAUSTED) break;
          throw Object.assign(new Error('generation cancelled'), { name: 'AbortError' });
        }
        if (slot === opts.failSlot) {
          failures.push(`demo: slot ${slot + 1} refused`);
          continue;
        }
        const hash = saveImage(await render(colors, req.prompt, req.width, req.height, slot + req.prompt.length));
        landed.set(slot, hash);
        onImage?.(slot, hash);
      }
      const done = [...landed.keys()].sort((a, b) => a - b);
      const images = done.map((slot) => landed.get(slot)!);
      if (done.length === count) return { images, costUsd: 0 };
      return { images, costUsd: 0, raw: { requested: count, variantIndexes: done, partialFailures: failures } };
    },
    async edit(req: EditRequest): Promise<EngineResult> {
      const colors = paletteOf(req);
      // The requested canvas, when the server states one: a hardcoded square
      // made every demo edit of a non-square shot fail the aspect check.
      const buf = await render(
        colors,
        `edit: ${req.instruction}`,
        req.width ?? 1024,
        req.height ?? 1024,
        req.instruction.length,
      );
      return { images: [saveImage(buf)], costUsd: 0 };
    },
  };
}
