import sharp from 'sharp';

/**
 * The most alive colour in an image, for tinting chips.
 *
 * sharp's own `stats().dominant` answers with whatever bin is biggest, which
 * on a photograph is almost always a muddy near-grey. We want the colour a
 * person would name if asked what the picture feels like, so pixels are scored
 * by saturation and mid-range lightness and the winning hue bucket is averaged.
 */
export async function vibrantColor(input: string | Buffer): Promise<string | null> {
  let data: Buffer;
  let channels: number;
  try {
    const out = await sharp(input).resize(48, 48, { fit: 'inside' }).raw().toBuffer({ resolveWithObject: true });
    data = out.data;
    channels = out.info.channels;
  } catch {
    return null;
  }

  // 24 hue buckets, each accumulating a score-weighted average
  const buckets = Array.from({ length: 24 }, () => ({ score: 0, r: 0, g: 0, b: 0 }));
  for (let i = 0; i + channels - 1 < data.length; i += channels) {
    if (channels === 4 && data[i + 3] < 128) continue; // skip transparent
    const r = data[i],
      g = data[i + 1],
      b = data[i + 2];
    const { h, s, l } = rgbToHsl(r, g, b);
    if (s < 0.18) continue; // greys carry no mood
    if (l < 0.12 || l > 0.92) continue; // near-black and blown-out highlights
    // favour saturated colours that sit in the readable middle of the range
    const score = s * (1 - Math.abs(l - 0.5) * 1.2);
    const bucket = buckets[Math.min(23, Math.floor((h / 360) * 24))];
    bucket.score += score;
    bucket.r += r * score;
    bucket.g += g * score;
    bucket.b += b * score;
  }

  const best = buckets.reduce((a, b) => (b.score > a.score ? b : a), buckets[0]);
  if (best.score <= 0) {
    // nothing colourful enough: fall back to sharp's dominant bin
    try {
      const { dominant } = await sharp(input).stats();
      return toHex(dominant.r, dominant.g, dominant.b);
    } catch {
      return null;
    }
  }
  return toHex(best.r / best.score, best.g / best.score, best.b / best.score);
}

function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  const rn = r / 255,
    gn = g / 255,
    bn = b / 255;
  const max = Math.max(rn, gn, bn),
    min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) * 60;
  else if (max === gn) h = ((bn - rn) / d + 2) * 60;
  else h = ((rn - gn) / d + 4) * 60;
  return { h, s, l };
}

const toHex = (r: number, g: number, b: number) =>
  '#' +
  [r, g, b]
    .map((v) =>
      Math.max(0, Math.min(255, Math.round(v)))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('');
