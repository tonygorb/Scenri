import sharp from 'sharp';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';

export interface DiffResult {
  /** 0..1 fraction of pixels that changed (after normalizing sizes). */
  score: number;
  /** PNG buffer highlighting changed pixels. */
  heatmap: Buffer;
  width: number;
  height: number;
}

/** Visual drift-diff between two images; sizes are normalized to the smaller common box. */
export async function driftDiff(a: Buffer, b: Buffer): Promise<DiffResult> {
  const metaA = await sharp(a).metadata();
  const metaB = await sharp(b).metadata();
  const width = Math.min(metaA.width ?? 1, metaB.width ?? 1, 1024);
  const height = Math.min(metaA.height ?? 1, metaB.height ?? 1, 1024);

  const [rawA, rawB] = await Promise.all(
    [a, b].map((buf) => sharp(buf).resize(width, height, { fit: 'cover' }).ensureAlpha().raw().toBuffer()),
  );

  const out = new PNG({ width, height });
  const changed = pixelmatch(rawA, rawB, out.data, width, height, { threshold: 0.1, diffColor: [255, 64, 64] });
  return {
    score: changed / (width * height),
    heatmap: PNG.sync.write(out),
    width,
    height,
  };
}

export interface ChangeMask {
  /** One byte per pixel: 255 where the two images differ, 0 where they agree. */
  mask: Buffer;
  width: number;
  height: number;
  /** Fraction of the frame that changed. */
  changed: number;
  /** Fraction of the frame covered by the bounding box around the changes. */
  spread: number;
}

/**
 * Which pixels moved, as a mask rather than a score.
 *
 * `driftDiff` has always computed exactly this and thrown it away, keeping only
 * the count and a rendered heatmap. Preserving a local edit needs the shape
 * itself, so it comes out here and both callers share one definition of what
 * "changed" means.
 *
 * Two differences from the scoring path, and both matter. The images are fitted
 * rather than covered, because `cover` crops and a cropped mask cannot be
 * mapped back onto the source it came from. And anti-aliased pixels are counted
 * as changes: for a preservation mask, over-including a boundary pixel is free
 * while missing one leaves a visible edge.
 */
export async function changeMask(a: Buffer, b: Buffer, cap = 1024): Promise<ChangeMask> {
  const metaA = await sharp(a).metadata();
  const width = Math.min(metaA.width ?? 1, cap);
  const height = Math.min(metaA.height ?? 1, cap);

  const [rawA, rawB] = await Promise.all(
    [a, b].map((buf) => sharp(buf).resize(width, height, { fit: 'fill' }).ensureAlpha().raw().toBuffer()),
  );

  const out = new PNG({ width, height });
  pixelmatch(rawA, rawB, out.data, width, height, { threshold: 0.1, includeAA: true, diffMask: true });

  // pixelmatch's diffMask leaves untouched pixels fully transparent, so alpha
  // is the answer already.
  const mask = Buffer.alloc(width * height);
  let changed = 0;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let i = 0; i < width * height; i++) {
    if (out.data[i * 4 + 3] > 0) {
      mask[i] = 255;
      changed++;
      const x = i % width;
      const y = (i / width) | 0;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  const boxArea = maxX < 0 ? 0 : (maxX - minX + 1) * (maxY - minY + 1);
  return {
    mask,
    width,
    height,
    changed: changed / (width * height),
    spread: boxArea / (width * height),
  };
}
