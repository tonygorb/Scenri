/**
 * The ordered-dither screen a picture being made is drawn through: Bayer's
 * recursive matrices (Bayer 1973). The 2n matrix tiles the n matrix four
 * times, each copy offset by the 2x2 one, so the lowest thresholds land as
 * far apart as they can and a density comes in as evenly spread dots. They
 * equal paper.design Dithering's own bayer2x2, 4x4 and 8x8 arrays
 * (packages/shaders, dithering.ts, 43cd68db), value for value.
 */
export function bayer(n: number): number[] {
  let m = [0];
  let size = 1;
  while (size < n) {
    const next = size * 2;
    const out = new Array<number>(next * next);
    for (let y = 0; y < next; y++)
      for (let x = 0; x < next; x++)
        out[y * next + x] =
          4 * m[(y % size) * size + (x % size)] + [0, 2, 3, 1][Math.floor(y / size) * 2 + Math.floor(x / size)];
    m = out;
    size = next;
  }
  return m;
}

/** A box's thresholds, w x h cells, 0..1: a cell is a dot where the density is above its threshold. */
export function thresholdsFor(n: number, w: number, h: number): Float32Array {
  const m = bayer(n).map((v) => (v + 0.5) / (n * n));
  const out = new Float32Array(w * h);
  for (let y = 0, i = 0; y < h; y++) for (let x = 0; x < w; x++, i++) out[i] = m[(y % n) * n + (x % n)];
  return out;
}
