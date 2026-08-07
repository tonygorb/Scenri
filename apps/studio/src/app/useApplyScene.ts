import { useCallback } from 'react';
import { useNavigate } from 'react-router';
import { useBrand } from './BrandLayout.js';
import { hubPath } from '../routes.js';

/**
 * "Use this scene" from the Scenes index or a scene page.
 *
 * It used to reach for `projects[0]`, and make an "Untitled" project when the
 * brand had none. The list it reached into is ordered oldest-first, so the
 * comment claiming it reused the newest project had it exactly backwards. There
 * is nothing to reach for now: the scene rides to the feed as a seed for the
 * brief, and no container is created on the way.
 */
export function useApplyScene(): (sceneId: string) => void {
  const { brand } = useBrand();
  const navigate = useNavigate();
  // a string, so the callback survives a brand refetch handing back a new object
  const hub = hubPath(brand);

  return useCallback(
    (sceneId: string) => {
      // the hub, because that is where the brief is: Home holds no composer for
      // the scene to be seeded into
      navigate(`${hub}?scene=${encodeURIComponent(sceneId)}&compose=1`);
    },
    [hub, navigate],
  );
}
