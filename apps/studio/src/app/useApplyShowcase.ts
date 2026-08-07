import { useCallback } from 'react';
import { useNavigate } from 'react-router';
import { useBrand } from './BrandLayout.js';
import { hubPath } from '../routes.js';

/**
 * "Use this" from a homepage showcase tile — carries the clicked example's
 * exact recipe (product, presenter, scene and prompt) into Create, the same
 * way `useApplyScene` carries a bare scene, except a showcase seed replaces
 * the whole brief rather than appending one chip. See `?showcase=` handling
 * in Create.tsx.
 */
export function useApplyShowcase(): (showcaseId: string) => void {
  const { brand } = useBrand();
  const navigate = useNavigate();
  const hub = hubPath(brand);

  return useCallback(
    (showcaseId: string) => {
      navigate(`${hub}?showcase=${encodeURIComponent(showcaseId)}&compose=1`);
    },
    [hub, navigate],
  );
}
