import { useCallback } from 'react';
import { useNavigate } from 'react-router';
import { useBrand } from '../app/BrandLayout.js';
import type { GuideTaskId } from '../api.js';
import { useCreateAsset } from '../create/AssetCreateHost.js';
import { guideIntent, guideSnapshot } from '../guide.js';
import { hubPath, presenterStudioPath, shotPath } from '../routes.js';

/**
 * Begins a guided task where it happens (DESIGN.md, "First use"): the first
 * shot on Create, a refinement on the newest shot, a product or a scene in its
 * dialog, a presenter in the studio. A task already in hand for this brand is
 * continued rather than begun again, so a presenter left half made reopens its
 * own draft and never an unrelated one.
 */
export function useLaunchTask(): (task: GuideTaskId) => Promise<void> {
  const { brand, recent } = useBrand();
  const navigate = useNavigate();
  const createAsset = useCreateAsset();
  return useCallback(
    async (task: GuideTaskId) => {
      const shot = recent.find((n) => n.kind !== 'root' && n.status === 'done' && n.images.length > 0);
      // Nothing to refine yet: refining starts with a shot.
      const want: GuideTaskId = task === 'refine' && !shot ? 'first-shot' : task;
      const held = guideSnapshot().active;
      if (!(held?.task === want && held.brandId === brand.id)) {
        await guideIntent({ start: { task: want, brandId: brand.id } });
      }
      switch (want) {
        case 'first-shot':
          return navigate(hubPath(brand));
        case 'refine':
          return navigate(shotPath(brand, null, (shot as { id: string }).id));
        case 'presenter':
          return navigate(presenterStudioPath(brand, guideSnapshot().activeDraftId));
        case 'product':
        case 'scene':
          return createAsset(want);
      }
    },
    [brand, recent, navigate, createAsset],
  );
}
