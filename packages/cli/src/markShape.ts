import sharp from 'sharp';
import type { MarkShape } from '@scenri/brand';

/**
 * What a scraped mark actually is, once decoded.
 *
 * Some of this cannot be known any other way. linear.app's header logo is
 * white-on-dark and rasterises to nothing on a light background; a mark nobody
 * can see is worse than no mark at all, because it reads as a broken image
 * everywhere it is used and no one can say why. paulgraham.com's only image is
 * a 69x399 column. Both were being crowned.
 */
export async function inspectMark(buf: Buffer, toPng: (b: Buffer) => Promise<Buffer>): Promise<MarkShape> {
  const png = await toPng(buf);
  const meta = await sharp(png).metadata();
  let blank = false;
  try {
    // The question is not "is this image empty" but "would anyone see it". So
    // composite it onto white, the way the kit and every card show it, and
    // look for ink.
    //
    // The round trip through toBuffer matters: sharp's stats() reads the INPUT
    // image and not the pipeline, so flattening without materialising it
    // measures the original - where a transparent pixel reports RGB 0, which
    // looks exactly like ink.
    const flat = await sharp(png).flatten({ background: '#ffffff' }).toBuffer();
    const stats = await sharp(flat).stats();
    blank = stats.channels.slice(0, 3).every((c) => c.min > 200);
  } catch {
    // An image sharp cannot measure is one we simply do not judge.
  }
  return {
    longEdge: Math.max(meta.width ?? 0, meta.height ?? 0) || null,
    width: meta.width ?? null,
    height: meta.height ?? null,
    blank,
  };
}
