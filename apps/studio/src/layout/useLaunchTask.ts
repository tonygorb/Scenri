import { useCallback } from 'react';
import { useMatch, useNavigate } from 'react-router';
import { useBrand } from '../app/BrandLayout.js';
import type { GuideTaskId } from '../api.js';
import { useCreateAsset } from '../create/AssetCreateHost.js';
import { arrived, guideIntent, guideSnapshot, headFor, viaBarKey, viaWayKey } from '../guide.js';
import { progressedPastWay } from '../lessons.js';
import { hubPath, P, presenterStudioPath, presentersPath, productsPath, scenesPath } from '../routes.js';

export interface LaunchHere {
  onHub: boolean;
  onShot: boolean;
  onProducts: boolean;
  onScenes: boolean;
  onPresenters: boolean;
  onStudio: boolean;
}

export type LaunchMove =
  | { kind: 'head' }
  | { kind: 'stay' }
  | { kind: 'hub' }
  | { kind: 'products' }
  | { kind: 'scenes' }
  | { kind: 'presenters' }
  | { kind: 'studio' }
  | { kind: 'dialog'; asset: 'product' | 'scene' };

/**
 * Where launching a lesson should put someone. The tutor may restore a place
 * they have already been in this lesson, and may never take them somewhere
 * for the first time. Seeing the way there is not having walked it: only a
 * later milestone, or a presenter draft, is resume.
 */
export function launchMove(
  task: GuideTaskId,
  here: LaunchHere,
  reached: readonly string[],
  draftId: string | null,
): LaunchMove {
  const resume = progressedPastWay(task, reached) || (task === 'presenter' && !!draftId);
  switch (task) {
    case 'first-shot':
    case 'reuse':
      if (here.onHub) return { kind: 'stay' };
      return resume ? { kind: 'hub' } : { kind: 'head' };
    case 'refine':
      if (here.onShot || here.onHub) return { kind: 'stay' };
      return resume ? { kind: 'hub' } : { kind: 'head' };
    case 'presenter':
      if (draftId || reached.some((m) => m === 'start' || m === 'face' || m === 'save'))
        return here.onStudio ? { kind: 'stay' } : { kind: 'studio' };
      if (here.onStudio || here.onPresenters) return { kind: 'stay' };
      return resume ? { kind: 'presenters' } : { kind: 'head' };
    case 'product':
      if (resume && reached.includes('product')) return { kind: 'dialog', asset: 'product' };
      if (here.onProducts) return { kind: 'stay' };
      return resume ? { kind: 'products' } : { kind: 'head' };
    case 'scene':
      if (resume && reached.includes('scene')) return { kind: 'dialog', asset: 'scene' };
      if (here.onScenes) return { kind: 'stay' };
      return resume ? { kind: 'scenes' } : { kind: 'head' };
  }
}

/**
 * Begins a guided task where it happens (DESIGN.md, "First use"): the first
 * shot on Create (begun anywhere else, the first step is the way there, taken
 * by their own hand: nothing jumps), a refinement on the grid, where the
 * shot to change is theirs to choose (already looking at one, begun right
 * there instead), a product or a scene from its library, a presenter from
 * its library. A task already in hand for this brand is continued rather than
 * begun again, so a presenter left half made reopens its own draft and never
 * an unrelated one. Continue restores a place they have already been; Start
 * and Start again never do.
 */
export function useLaunchTask(): (task: GuideTaskId) => Promise<void> {
  const { brand, recent, products } = useBrand();
  const navigate = useNavigate();
  const createAsset = useCreateAsset();
  const onHub = !!useMatch(P.hub);
  const onShot = !!useMatch(P.hubShot);
  const onProducts = !!useMatch(P.products);
  const onScenes = !!useMatch(P.scenes);
  const onPresenters = !!useMatch(P.presenters);
  const onStudio = !!useMatch(P.presenterStudio);
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
      const reached = guideSnapshot().progress?.[want]?.reached ?? [];
      const draftId = guideSnapshot().activeDraftId;
      const move = launchMove(want, { onHub, onShot, onProducts, onScenes, onPresenters, onStudio }, reached, draftId);
      if (move.kind !== 'head') arrived();
      switch (move.kind) {
        case 'stay':
          try {
            window.localStorage.removeItem(viaWayKey(brand.id, want));
            if (want === 'first-shot' || want === 'reuse') window.localStorage.removeItem(viaBarKey(brand.id));
          } catch {
            // nothing remembered, nothing to forget
          }
          if ((want === 'first-shot' || want === 'reuse') && onHub) return navigate(hubPath(brand));
          return;
        case 'head':
          return headFor(brand.id, want);
        case 'hub':
          return navigate(hubPath(brand));
        case 'products':
          return navigate(productsPath(brand));
        case 'scenes':
          return navigate(scenesPath(brand));
        case 'presenters':
          return navigate(presentersPath(brand));
        case 'studio':
          return navigate(presenterStudioPath(brand, draftId));
        case 'dialog':
          return createAsset(move.asset);
      }
    },
    [brand, recent, products, navigate, createAsset, onHub, onShot, onProducts, onScenes, onPresenters, onStudio],
  );
}
