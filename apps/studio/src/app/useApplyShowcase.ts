import { useCallback } from 'react';
import { useNavigate } from 'react-router';
import type { ShowcaseEntry } from '../api.js';
import { useBrand } from './BrandLayout.js';
import { hubPath } from '../routes.js';

/**
 * A curated example as a brief the Composer can be seeded with: its own
 * variants and quality come along, because an example is a whole shot and not
 * just its words. The `_at` stamp is what makes picking the same tile twice
 * land twice — the seed is compared by identity, not by content.
 *
 * One owner for both entry points: Home stages it into the docked composer,
 * Create applies it on `?showcase=` arrival. A field added to `ShowcaseEntry`
 * has to reach both, or a staged recipe generates something it did not show.
 */
export function showcaseBrief(entry: ShowcaseEntry) {
  return {
    ...entry.brief,
    ...(entry.variants ? { variants: entry.variants } : {}),
    ...(entry.quality ? { quality: entry.quality } : {}),
    _at: Date.now(),
  };
}

/**
 * "Use this" from a homepage showcase tile — carries the clicked example's
 * exact recipe (product, presenter, scene and prompt) into Create, the same
 * way `useApplyScene` carries a bare scene, except a showcase seed replaces
 * the whole brief rather than appending one chip. See `?showcase=` handling
 * in Create.tsx.
 *
 * Deliberately no `compose=1`, unlike `useApplyScene`: a bare scene seed wants
 * typing next, but a showcase delivers a complete recipe that wants reviewing —
 * and on a phone the focus would pop the keyboard over an empty brief that then
 * swaps wholesale once the showcase loads.
 */
export function useApplyShowcase(): (showcaseId: string) => void {
  const { brand } = useBrand();
  const navigate = useNavigate();
  const hub = hubPath(brand);

  return useCallback(
    (showcaseId: string) => {
      navigate(`${hub}?showcase=${encodeURIComponent(showcaseId)}`);
    },
    [hub, navigate],
  );
}
