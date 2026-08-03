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
