import { useCallback } from 'react';
import { useMatch, useNavigate } from 'react-router';
import { useBrand } from '../app/BrandLayout.js';
import type { GuideTaskId } from '../api.js';
import { useCreateAsset } from '../create/AssetCreateHost.js';
import { guideIntent, guideSnapshot, headFor, viaBarKey } from '../guide.js';
import { hubPath, P, presenterStudioPath } from '../routes.js';

/**
 * Begins a guided task where it happens (DESIGN.md, "First use"): the first
 * shot on Create (begun anywhere else, the first step is the way there, taken
 * by their own hand: nothing jumps), a refinement on the grid, where the
 * shot to change is theirs to choose (already looking at one, begun right
 * there instead), a product or a scene in its dialog, a presenter in the
 * studio. A task already in hand for this brand is continued rather than
 * begun again, so a presenter left half made reopens its own draft and never
 * an unrelated one.
 */
export function useLaunchTask(): (task: GuideTaskId) => Promise<void> {
  const { brand, recent, products } = useBrand();
  const navigate = useNavigate();
  const createAsset = useCreateAsset();
  const onHub = !!useMatch(P.hub);
  const onShot = !!useMatch(P.hubShot);
  return useCallback(
    async (task: GuideTaskId) => {
      const shot = recent.find((n) => n.kind !== 'root' && n.status === 'done' && n.images.length > 0);
      // Nothing to refine yet: refining starts with a shot. Nothing of their
      // own to use again: that lesson starts with adding one.
      const want: GuideTaskId =
        task === 'refine' && !shot ? 'first-shot' : task === 'reuse' && products.length === 0 ? 'product' : task;
      const held = guideSnapshot().active;
      // In hand here already: carried on. Paused here: the record continues it
      // (same window, same draft). Anything else begins it.
      if (!(held?.task === want && held.brandId === brand.id && !held.paused)) {
        await guideIntent({ start: { task: want, brandId: brand.id } });
      }
      switch (want) {
        case 'reuse':
        case 'first-shot':
          if (onHub) {
            // begun where it happens: the opening greets them, and the walk is four
            try {
              window.localStorage.removeItem(viaBarKey(brand.id));
            } catch {
              // nothing remembered, nothing to forget
            }
            return navigate(hubPath(brand));
          }
          return headFor(brand.id);
        case 'refine':
          // Already looking at one: begin right there, nothing to navigate.
          // Otherwise the grid, where which shot to change is theirs to choose.
          if (onShot) return;
          return navigate(hubPath(brand));
        case 'presenter':
          return navigate(presenterStudioPath(brand, guideSnapshot().activeDraftId));
        case 'product':
        case 'scene':
          return createAsset(want);
      }
    },
    [brand, recent, products, navigate, createAsset, onHub, onShot],
  );
}
