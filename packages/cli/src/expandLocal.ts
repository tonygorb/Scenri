import sharp from 'sharp';
import type { ExpandPlan } from './expandRules.js';

/**
 * Growing a frame without asking a model anything.
 *
 * The generative path can only ever be a proposal: the engine we ship by
 * default re-renders the whole frame from a sentence, has no seed, and cannot
 * be told a size, so the same shot extended twice returns two different
 * margins and the join is a lottery — measured three times on one unchanged
 * picture, the seam came back clean, badly broken, then clean again.
 *
 * This is the other answer. The margin is built from the photograph's own
 * outermost pixels, reflected outward and progressively defocused, so:
 *
 *   - the pixel beside the join IS the pixel at the join, mirrored, which
 *     makes the seam continuous by construction rather than by correction;
 *   - the same picture and the same shape always give the same result, so it
 *     can be re-run, compared, and tested;
 *   - it costs nothing, needs no key, and cannot fail.
 *
 * What it is not: invented scenery. A reflected surface is the picture's own
 * material carried outward, which is exactly right for the backdrops, sweeps,
 * gradients and defocused fields most product photographs sit on, and honest
 * about itself on a surface with strong geometry. The defocus is what keeps
 * the reflection from reading as a mirror: detail dissolves with distance the
 * way a real background falls away from the plane of focus.
 */
export async function expandLocally(source: Buffer, plan: ExpandPlan): Promise<Buffer> {
  const meta = await sharp(source).metadata();
  const W = meta.width ?? 0;
  const H = meta.height ?? 0;
  if (!W || !H) return source;

  const horizontal = plan.axis === 'width';
  const before = horizontal ? plan.left : plan.top;
  const after = horizontal ? plan.width - (plan.left + W) : plan.height - (plan.top + H);

  const layers: { input: Buffer; left: number; top: number }[] = [];
  if (before > 0) layers.push(await wing(source, { W, H }, before, horizontal, 'before', plan));
  if (after > 0) layers.push(await wing(source, { W, H }, after, horizontal, 'after', plan));

  // A ground of the picture's own average, so any pixel the wings cannot reach
  // (a margin wider than the picture itself) is still of this photograph.
  const ground = await sharp(source)
    .resize(plan.width, plan.height, { fit: 'cover', position: 'centre' })
    .blur(Math.max(12, Math.round(Math.max(plan.width, plan.height) / 24)))
    .toBuffer();

  return sharp(ground)
    .composite([...layers, { input: source, left: plan.left, top: plan.top }])
    .png()
    .toBuffer();
}

/**
 * One margin, built in bands.
 *
 * A single mirrored copy would be a mirror: recognisable, and wrong the moment
 * the surface has structure. Instead the reflection is laid down in bands that
 * lose focus as they travel, so the first band continues the picture exactly
 * where it matters — against the join — and the far bands are only tone and
 * colour, which is what a background at that distance actually looks like.
 */
async function wing(
  source: Buffer,
  size: { W: number; H: number },
  gap: number,
  horizontal: boolean,
  side: 'before' | 'after',
  plan: ExpandPlan,
): Promise<{ input: Buffer; left: number; top: number }> {
  const { W, H } = size;
  /*
   * Narrow against the join, doubling outward. An even split put a 75px
   * perfect reflection immediately outside the picture, and a 75px reflection
   * is a butterfly: measured, that band carried 100% of the edge's structure,
   * which on a surface with pattern is exactly how the trick gives itself
   * away. A thin exact band reads as continuity instead — the picture simply
   * carries on — and everything past it is defocused fast enough that no
   * symmetry can be read out of it.
   */
  const widths: number[] = [];
  for (let w = 8, used = 0; used < gap; w *= 2) {
    const take = Math.min(w, gap - used);
    widths.push(take);
    used += take;
  }
  const pieces: { input: Buffer; left: number; top: number }[] = [];

  let from = 0;
  for (let i = 0; i < widths.length; i++) {
    const width = widths[i];
    if (width <= 0) break;
    // Walk inward through the picture, mirroring each step, so consecutive
    // bands continue each other instead of repeating the same strip.
    const depth = Math.min(horizontal ? W : H, from + width);
    const take = Math.max(1, Math.min(width, (horizontal ? W : H) - Math.max(0, depth - width)));
    const region = horizontal
      ? {
          left: side === 'before' ? Math.max(0, from) : Math.max(0, W - from - take),
          top: 0,
          width: take,
          height: H,
        }
      : {
          left: 0,
          top: side === 'before' ? Math.max(0, from) : Math.max(0, H - from - take),
          width: W,
          height: take,
        };
    // Focus falls away with distance: the thin band against the join is
    // untouched so the picture continues exactly, and the rest softens fast.
    const softness = i === 0 ? 0 : Math.min(34, 1.5 * 1.9 ** i);
    let strip = sharp(source).extract(region);
    strip = horizontal ? strip.flop() : strip.flip();
    if (softness > 0) strip = strip.blur(softness);
    const buf = await strip.png().toBuffer();
    pieces.push({
      input: buf,
      left: horizontal ? (side === 'before' ? plan.left - from - take : plan.left + W + from) : plan.left,
      top: horizontal ? plan.top : side === 'before' ? plan.top - from - take : plan.top + H + from,
    });
    from += width;
  }

  // Flatten the bands into one image so the caller composites a single wing.
  const wingW = horizontal ? gap : W;
  const wingH = horizontal ? H : gap;
  const originX = horizontal ? (side === 'before' ? plan.left - gap : plan.left + W) : plan.left;
  const originY = horizontal ? plan.top : side === 'before' ? plan.top - gap : plan.top + H;
  const flat = await sharp({
    create: { width: wingW, height: wingH, channels: 3, background: { r: 0, g: 0, b: 0 } },
  })
    .composite(pieces.map((p) => ({ input: p.input, left: p.left - originX, top: p.top - originY })))
    .png()
    .toBuffer();
  return { input: flat, left: originX, top: originY };
}
