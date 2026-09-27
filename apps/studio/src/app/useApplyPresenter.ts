import { useCallback } from 'react';
import { useNavigate } from 'react-router';
import { useBrand } from './BrandLayout.js';
import { hubPath } from '../routes.js';
import { freshSeed } from '../draft.js';

/**
 * "Use in a shot" from the Presenters index or a presenter page.
 *
 * A presenter attaches straight from the curated catalog, the same way
 * `useApplyScene` attaches a scene — no roster/cast copy step first. The
 * composer resolves the presenter's reference images itself once the id
 * shows up in a `character` token. Pressed on a page with no composer, it
 * starts a new brief rather than joining the one in progress (draft.ts `freshSeed`).
 */
export function useApplyPresenter(): (presenterId: string) => void {
  const { brand } = useBrand();
  const navigate = useNavigate();
  const hub = hubPath(brand);

  return useCallback(
    (presenterId: string) => {
      navigate(`${hub}?presenter=${encodeURIComponent(presenterId)}&compose=1${freshSeed()}`);
    },
    [hub, navigate],
  );
}
