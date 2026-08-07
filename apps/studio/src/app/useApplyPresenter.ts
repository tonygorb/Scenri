import { useCallback } from 'react';
import { useNavigate } from 'react-router';
import { api } from '../api.js';
import { useAppData } from './AppShell.js';
import { useBrand } from './BrandLayout.js';
import { hubPath } from '../routes.js';

/**
 * "Add to your roster" from the Presenters index or a presenter page.
 *
 * Unlike useApplyLook, this is a real write before it is a navigation: the
 * presenter's reference shots get copied into this brand's own characters[]
 * server-side, so the composer's @mention and attach panel can find them by
 * the same id every time after. `useAppData().refresh()` (not
 * `useBrand().refresh`, which only re-reads the workspace) is what makes the
 * new roster entry show up without a full reload — see Brand.tsx's own
 * ProductsPanel wiring for the same pattern.
 */
export function useApplyPresenter(): {
  cast: (presenterId: string) => Promise<void>;
  goToBrief: () => void;
} {
  const { brand } = useBrand();
  const { refresh } = useAppData();
  const navigate = useNavigate();
  const hub = hubPath(brand);

  const cast = useCallback(
    async (presenterId: string) => {
      await api.castPresenter(brand.id, presenterId);
      await refresh();
    },
    [brand.id, refresh],
  );

  const goToBrief = useCallback(() => {
    navigate(`${hub}?compose=1`);
  }, [hub, navigate]);

  return { cast, goToBrief };
}
