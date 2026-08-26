/**
 * Which engine paints a margin.
 *
 * Growing a frame is not the same job as making a picture, and the engine that
 * made the picture is not always the one that should continue it. A real
 * outpainter is given the picture and where it sits and paints only the new
 * space; everything else is handed a bed and re-renders the whole frame, after
 * which the original is composited back over it.
 *
 * The identity argument that normally forbids switching providers does not
 * apply here. `fal` and `replicate` both declare `maxReferenceImages: 0`, which
 * would be disqualifying for a generation, but an extend needs no references:
 * the Product and the Presenter live inside the protected region and are
 * composited back untouched. That is exactly why a shot made on one engine may
 * legitimately be extended by another.
 *
 * The shot's own engine still wins whenever it can do the job, so nobody is
 * moved to another provider for no reason.
 */
import type { EngineAdapter } from '@scenri/core';

export type OutpaintMethod = 'outpaint' | 'reframe';

export interface OutpaintRoute {
  engine: EngineAdapter;
  /**
   * `outpaint` means the engine was given the margin to paint. `reframe` means
   * it was given a bed and re-rendered the frame, and the guarantee was taken
   * afterwards rather than asked for.
   */
  method: OutpaintMethod;
  /** True when the margin is going to a different engine than the shot used. */
  crossed: boolean;
}

const canOutpaint = (e: EngineAdapter) => {
  const caps = e.capabilities();
  return caps.supportsOutpaint === true;
};

const usable = async (e: EngineAdapter) => {
  try {
    return (await e.isAvailable()).ok;
  } catch {
    return false;
  }
};

/**
 * Pick the engine for a margin.
 *
 * Order: the shot's own engine if it can genuinely outpaint, then any other
 * connected engine that can, then the shot's own engine on the bed path.
 *
 * Placeholder engines are only ever used when they are the shot's own engine.
 * The offline demo adapter declares `supportsOutpaint` so the path is not
 * blocked in development, and letting it win a search would hand real work to
 * something that draws gradients.
 */
export async function resolveOutpaintRoute(all: EngineAdapter[], shot: EngineAdapter): Promise<OutpaintRoute> {
  if (canOutpaint(shot)) return { engine: shot, method: 'outpaint', crossed: false };

  const shotId = shot.capabilities().id;
  for (const candidate of all) {
    const caps = candidate.capabilities();
    if (caps.id === shotId || caps.placeholder || !canOutpaint(candidate)) continue;
    if (await usable(candidate)) return { engine: candidate, method: 'outpaint', crossed: true };
  }
  return { engine: shot, method: 'reframe', crossed: false };
}
