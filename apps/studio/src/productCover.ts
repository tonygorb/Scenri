import { assetThumbUrl, type ThumbSize } from './apiUploads.js';

/**
 * The one answer to "which picture stands for this product".
 *
 * Every card, chip, tile and picker used to reach for `shots[0]`, which made
 * the cover a side effect of reference order: promoting a side view on the
 * product page silently changed the library card, and two surfaces fetched the
 * original PNG into a 200px cell. This module is the rule, once, the way
 * presenterVisual.ts is for a person.
 *
 * A cover is display media. It is a real photograph chosen by rule, or the one
 * the user picked; never a view Scenri drew, never a generation of its own,
 * and never read by the compiler, which has its own order (photographs first).
 */
type CoverShot = { file: string; angle?: string | null; source?: 'photo' | 'derived' };
type CoverProduct = { cover?: string | null; shots?: CoverShot[] };

export function coverOf(p: CoverProduct): string | null {
  if (p.cover) return p.cover;
  const shots = p.shots ?? [];
  const photos = shots.filter((s) => s.source !== 'derived');
  const byAngle = (angle: string) => photos.find((s) => s.angle === angle);
  return (byAngle('three-quarter') ?? byAngle('front') ?? photos[0] ?? shots[0])?.file ?? null;
}

/** The cover at a derivative width, or null when the product has no picture. */
export function productCoverUrl(p: CoverProduct, size: ThumbSize): string | null {
  const ref = coverOf(p);
  return ref ? assetThumbUrl(ref, size) : null;
}
