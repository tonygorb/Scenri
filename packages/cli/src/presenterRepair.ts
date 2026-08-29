import type { Core } from '@scenri/core';
import { brandCharacters, commit, presenterCrops } from './customAssets.js';

/**
 * One-time repair of custom presenter thumbnails, run at boot.
 *
 * Presenters built before the crop fix keep whatever preview and avatar
 * hashes were minted at creation: on the no-engine path that was a square of
 * forehead cut by geometry meant for studio frames, and sometimes nothing at
 * all. The record itself is intact — the first shot and the first source
 * photo are still there — so the correct crops can be recomputed exactly the
 * way a fresh build would compute them.
 *
 * Idempotence is structural, not tracked: the image store is content
 * addressed, so recomputing an already-correct presenter yields the same
 * hashes and nothing is written. The second boot is a read-only walk. A new
 * hash is a new URL, and /api/images is immutable-cached, so no client cache
 * needs busting.
 */

/** Which crop geometry a presenter's shots were made for. */
export function presenterCropMode(firstShotFile: unknown, firstSourceFile: unknown): 'upload' | 'generated' {
  // When the first shot IS the first source photo, no engine ever drew a
  // studio frame: the crops must read the photograph, not assume a full
  // length standing figure.
  return firstShotFile && firstShotFile === firstSourceFile ? 'upload' : 'generated';
}

export async function repairPresenterCrops(
  core: Core,
  log: (line: string) => void = () => {},
): Promise<{ repaired: number }> {
  let repaired = 0;
  for (const brand of core.store.listBrands()) {
    for (const c of brandCharacters(brand.json)) {
      // Structural, not origin-gated: legacy roster rows predate the
      // `origin: 'custom'` marker but carry the same shots and render through
      // the same avatar chain, and requiring the marker left exactly those
      // presenters stuck with no derived avatar at all. Anything without an
      // id to commit against or an asset-ref first shot is skipped below.
      if (!c?.id) continue;
      try {
        const firstShot = c.shots?.[0]?.file;
        const hash = typeof firstShot === 'string' && firstShot.startsWith('asset:') ? firstShot.slice(6) : null;
        if (!hash) continue;
        const mode = presenterCropMode(firstShot, c.sourceRefs?.[0]?.file);
        const { previewHash, avatarHash } = await presenterCrops(core, hash, mode);
        const preview = previewHash ? `asset:${previewHash}` : undefined;
        const avatar = avatarHash ? `asset:${avatarHash}` : undefined;
        if ((!preview || preview === c.preview) && (!avatar || avatar === c.avatar)) continue;
        commit(core, brand.id, (json) => {
          json.characters = brandCharacters(json).map((row: any) =>
            row.id === c.id ? { ...row, ...(preview ? { preview } : {}), ...(avatar ? { avatar } : {}) } : row,
          );
        });
        repaired += 1;
        log(`Repaired presenter thumbnails: ${c.name ?? c.id}`);
      } catch {
        // one broken record must never block boot; the presenter simply
        // keeps whatever it had
      }
    }
  }
  return { repaired };
}
