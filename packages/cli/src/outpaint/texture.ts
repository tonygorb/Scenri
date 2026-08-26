/**
 * What the seam metrics cannot see.
 *
 * `seamScore` divides the step at the join by the picture's own grain, and
 * `seamResidual` measures that step in levels. Both look at a line. Neither can
 * see that the margin's texture is the right colour at the wrong size, that it
 * is sharp where the picture is soft, or that the product has been drawn a
 * second time out in the new space.
 *
 * That blindness is on record twice. A fully local mirror extension scored a
 * perfect 0.00 join and failed forensically eight times out of eight, because
 * it had mirrored the product into the sky. And a cracked-clay extend measures
 * 11 to 17 levels of residual no matter which blending method or which bed
 * produced it, because its error was never tonal: the margin holds one crack
 * scale and one sharpness where the picture recedes and softens.
 *
 * These three measures are deliberately reported, not enforced. Every threshold
 * here has to be calibrated against a real battery before it decides anything,
 * and a threshold invented before its benchmark is a guess that then gets
 * trusted.
 */
import sharp from 'sharp';
import type { ExpandPlan } from '../expandRules.js';

/** How far from the join to start sampling, and how deep to go. */
const NEAR = 8;
const DEEP = 48;
/** How many bands to split the join into, across the axis it runs along. */
const BANDS = 8;
/** The scale gap used to turn gradient energy into a sharpness proxy. */
const COARSE = 4;

export interface TextureReport {
  /** Margin texture energy over the picture's, 1 means the scales match. */
  scale: number;
  /** Margin sharpness over the picture's, 1 means the focus matches. */
  defocus: number;
}

interface Grey {
  data: Buffer;
  width: number;
  height: number;
}

const grey = async (buf: Buffer): Promise<Grey> => {
  const { data, info } = await sharp(buf).removeAlpha().greyscale().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
};

/** Mean absolute neighbour difference inside a rectangle, both axes together. */
function energy(g: Grey, x0: number, x1: number, y0: number, y1: number): number {
  const lo = { x: Math.max(1, x0), y: Math.max(1, y0) };
  const hi = { x: Math.min(g.width, x1), y: Math.min(g.height, y1) };
  let sum = 0;
  let n = 0;
  for (let y = lo.y; y < hi.y; y++) {
    for (let x = lo.x; x < hi.x; x++) {
      const i = y * g.width + x;
      sum += Math.abs(g.data[i] - g.data[i - 1]) + Math.abs(g.data[i] - g.data[i - g.width]);
      n += 2;
    }
  }
  return n ? sum / n : 0;
}

/**
 * The two strips either side of a join, band by band along it.
 *
 * Band by band because the whole difficulty of an extend lives on the axis that
 * runs across the growth axis: measured on the golden sources, texture energy
 * varies 8.35x down a cracked-clay frame and 1.23x across it. A single number
 * for the whole join averages that away and reports nothing.
 */
function pairs(
  plan: ExpandPlan,
  source: { width: number; height: number },
  at: (x0: number, x1: number, y0: number, y1: number) => number,
): { inside: number; outside: number }[] {
  const out: { inside: number; outside: number }[] = [];
  const horizontal = plan.axis === 'width';
  const along = horizontal ? plan.height : plan.width;
  const step = Math.max(1, Math.floor(along / BANDS));

  const joins = horizontal
    ? [
        { edge: plan.left, dir: -1 },
        { edge: plan.left + source.width, dir: 1 },
      ]
    : [
        { edge: plan.top, dir: -1 },
        { edge: plan.top + source.height, dir: 1 },
      ];

  for (const { edge, dir } of joins) {
    // dir -1: margin lies before the picture. dir 1: after it.
    const marginFrom = dir < 0 ? edge - NEAR - DEEP : edge + NEAR;
    const pictureFrom = dir < 0 ? edge + NEAR : edge - NEAR - DEEP;
    for (let b = 0; b + step <= along; b += step) {
      const inside = horizontal
        ? at(pictureFrom, pictureFrom + DEEP, b, b + step)
        : at(b, b + step, pictureFrom, pictureFrom + DEEP);
      const outside = horizontal
        ? at(marginFrom, marginFrom + DEEP, b, b + step)
        : at(b, b + step, marginFrom, marginFrom + DEEP);
      out.push({ inside, outside });
    }
  }
  return out;
}

/** The median of `outside / inside`, which is 1 when the two sides agree. */
function medianRatio(bands: { inside: number; outside: number }[]): number {
  const ratios = bands
    .filter((b) => b.inside > 0.05 && b.outside > 0.05)
    .map((b) => b.outside / b.inside)
    .sort((a, b) => a - b);
  if (!ratios.length) return 1;
  const mid = ratios.length >> 1;
  return ratios.length % 2 ? ratios[mid] : (ratios[mid - 1] + ratios[mid]) / 2;
}

/**
 * How the margin's texture compares with the picture's, in scale and in focus.
 *
 * Scale is the ratio of raw gradient energy. A margin drawn at 1.78x the
 * picture's texel size, which is what a cover-resized bed teaches, carries less
 * energy per pixel and reads well below 1.
 *
 * Focus is the ratio of that same energy to the energy left after a coarse
 * blur. A sharp region loses most of it, a soft one loses little, so the
 * quotient is a cheap depth-of-field proxy that does not need a defocus model.
 */
export async function textureReport(
  image: Buffer,
  plan: ExpandPlan,
  source: { width: number; height: number },
): Promise<TextureReport> {
  const fine = await grey(image);
  const coarse = await grey(await sharp(image).blur(COARSE).png().toBuffer());

  const scale = medianRatio(pairs(plan, source, (a, b, c, d) => energy(fine, a, b, c, d)));
  const sharpness = (g: Grey, c: Grey) => (a: number, b: number, y0: number, y1: number) => {
    const hi = energy(g, a, b, y0, y1);
    const lo = energy(c, a, b, y0, y1);
    return lo > 0.05 ? hi / lo : 0;
  };
  const defocus = medianRatio(pairs(plan, source, sharpness(fine, coarse)));
  return { scale, defocus };
}

/**
 * Whether the picture's subject appears a second time out in the margin.
 *
 * Normalised cross correlation of the source's most salient patch against the
 * generated space, both reduced to a small grid first because a duplicate is a
 * large, coarse thing and full resolution buys nothing but time. The number is
 * a correlation, so 1 is a perfect copy and anything under about 0.5 is the
 * ordinary agreement two crops of one scene already have.
 */
export async function duplicationPeak(
  image: Buffer,
  plan: ExpandPlan,
  source: { width: number; height: number },
  subject: { left: number; top: number; width: number; height: number },
): Promise<number> {
  const GRID = 96;
  const PATCH = 24;
  const patch = await grey(
    await sharp(image)
      .extract({
        left: plan.left + subject.left,
        top: plan.top + subject.top,
        width: Math.max(8, subject.width),
        height: Math.max(8, subject.height),
      })
      .resize(PATCH, PATCH, { fit: 'fill' })
      .png()
      .toBuffer(),
  );

  const horizontal = plan.axis === 'width';
  const regions = horizontal
    ? [
        { left: 0, top: 0, width: plan.left, height: plan.height },
        { left: plan.left + source.width, top: 0, width: plan.width - plan.left - source.width, height: plan.height },
      ]
    : [
        { left: 0, top: 0, width: plan.width, height: plan.top },
        { left: 0, top: plan.top + source.height, width: plan.width, height: plan.height - plan.top - source.height },
      ];

  let best = 0;
  for (const region of regions) {
    if (region.width < 8 || region.height < 8) continue;
    const w = Math.max(PATCH, Math.min(GRID, Math.round((region.width / region.height) * GRID)));
    const h = Math.max(PATCH, GRID);
    const field = await grey(await sharp(image).extract(region).resize(w, h, { fit: 'fill' }).png().toBuffer());
    best = Math.max(best, ncc(patch, field));
  }
  return best;
}

/** Peak normalised cross correlation of a patch slid over a field. */
function ncc(patch: Grey, field: Grey): number {
  const pn = patch.width * patch.height;
  let pMean = 0;
  for (let i = 0; i < pn; i++) pMean += patch.data[i];
  pMean /= pn;
  let pVar = 0;
  for (let i = 0; i < pn; i++) pVar += (patch.data[i] - pMean) ** 2;
  if (pVar < 1e-6) return 0;

  let best = 0;
  for (let oy = 0; oy + patch.height <= field.height; oy += 2) {
    for (let ox = 0; ox + patch.width <= field.width; ox += 2) {
      let fMean = 0;
      for (let y = 0; y < patch.height; y++)
        for (let x = 0; x < patch.width; x++) fMean += field.data[(oy + y) * field.width + ox + x];
      fMean /= pn;
      let num = 0;
      let fVar = 0;
      for (let y = 0; y < patch.height; y++) {
        for (let x = 0; x < patch.width; x++) {
          const f = field.data[(oy + y) * field.width + ox + x] - fMean;
          num += (patch.data[y * patch.width + x] - pMean) * f;
          fVar += f * f;
        }
      }
      if (fVar < 1e-6) continue;
      best = Math.max(best, num / Math.sqrt(pVar * fVar));
    }
  }
  return best;
}
