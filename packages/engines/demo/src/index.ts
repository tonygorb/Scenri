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
  /**
   * Milliseconds before every slot, the first one included.
   *
   * `staggerMs` only delays what comes after the first picture, so a request
   * for one picture is never slowed by it at all. That is every presenter
   * draw: a spec casting a person watched each view appear in the same frame
   * the press landed in, and so tested none of the states a person actually
   * sits in, where a draw takes tens of seconds and what it reads from can be
   * decided, redrawn or put back underneath it. Three of the four bugs
   * reported by hand on 2026-09-16 lived in exactly that gap.
   */
  delayMs?: number;
  /** `reverse` lands the last slot first: the out-of-order case a feed has to survive. */
  order?: 'request' | 'reverse';
  /** A slot that fails, reported the way codex reports a partial run. */
  failSlot?: number;
  /**
   * How many reference images it claims to read. Zero by default, which is
   * the truth: it reads none. A browser test that casts a presenter needs an
   * engine the build picker will accept, and the picker refuses one that
   * cannot hold a face. The pictures stay placeholders either way.
   */
  maxReferenceImages?: number;
}

/** The knobs as the end-to-end harness sets them, from the environment; none by default. */
export function demoOptionsFromEnv(env: Record<string, string | undefined>): DemoOptions {
  const out: DemoOptions = {};
  const stagger = Number(env.SCENRI_DEMO_STAGGER_MS);
  if (env.SCENRI_DEMO_STAGGER_MS && Number.isFinite(stagger) && stagger > 0) out.staggerMs = stagger;
  const delay = Number(env.SCENRI_DEMO_DELAY_MS);
  if (env.SCENRI_DEMO_DELAY_MS && Number.isFinite(delay) && delay > 0) out.delayMs = delay;
  if (env.SCENRI_DEMO_ORDER === 'reverse') out.order = 'reverse';
  const fail = Number(env.SCENRI_DEMO_FAIL_SLOT);
  if (env.SCENRI_DEMO_FAIL_SLOT && Number.isInteger(fail) && fail >= 0) out.failSlot = fail;
  const refs = Number(env.SCENRI_DEMO_REFS);
  if (env.SCENRI_DEMO_REFS && Number.isInteger(refs) && refs > 0) out.maxReferenceImages = refs;
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
        maxReferenceImages: opts.maxReferenceImages ?? 0,
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
        if (opts.delayMs) await sleep(opts.delayMs, signal);
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
        // the reference count rides in the label so a human looking at a
        // placeholder can see what the call carried
        const refs = req.referenceImages?.length ?? 0;
        const label = refs ? `refs=${refs} ${req.prompt}` : req.prompt;
        const hash = saveImage(await render(colors, label, req.width, req.height, slot + req.prompt.length));
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

/**
 * A read of some photographs that never spawns anything.
 *
 * The real read is codex, so a browser suite that runs with `SCENRI_NO_CODEX=1`
 * has no analyzer at all, and every branch that turns on what the read made of
 * the pictures is unreachable from a spec. That includes the one that stops a
 * run when no photograph is clear enough to draw a face from, which is a thing
 * the studio does on a person's behalf and ought to be pinned.
 *
 * It answers with a fixed draft. `photos` says what it made of each picture:
 * `usable` files the first as the portrait and the rest as ordinary snaps, and
 * `unusable` rejects every one of them, which is the case worth testing.
 */
export function createDemoAnalyzer(opts: { photos?: 'usable' | 'unusable' } = {}) {
  const rejects = opts.photos === 'unusable';
  const filing = (i: number) => ({
    index: i,
    view: (rejects || i > 0 ? 'other' : 'portrait') as 'other' | 'portrait',
    usable: !rejects,
    note: rejects ? 'too unclear to read a face from' : 'sharp enough',
  });
  return {
    isAvailable: async () => ({ ok: true }),
    analyze: async (req: { imagePaths: string[] }) => ({
      promptName: 'a person in their thirties',
      presentation: 'woman' as const,
      descriptor: 'Demo read',
      ageRange: '30s',
      hair: 'dark hair',
      identityNotes: 'read by the demo analyzer, which never looked at anything',
      negativeConstraints: [] as string[],
      suitableCategories: [] as string[],
      coverage: [] as string[],
      photos: req.imagePaths.map((_, i) => filing(i)),
    }),
  };
}
