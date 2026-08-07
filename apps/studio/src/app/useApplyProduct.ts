import { useCallback } from 'react';
import { useNavigate } from 'react-router';
import { useBrand } from './BrandLayout.js';
import { hubPath } from '../routes.js';

/**
 * "Use in creation" from the Products index or a product page.
 *
 * Same shape as `useApplyScene`/`useApplyPresenter`: a pure navigate, the
 * product rides to the composer as a seed for the brief. Products aren't a
 * curated catalog to attach from directly like a Scene or Presenter — they
 * already live in this brand's own library — but the entry point into the
 * composer works identically.
 */
export function useApplyProduct(): (productId: string) => void {
  const { brand } = useBrand();
  const navigate = useNavigate();
  const hub = hubPath(brand);

  return useCallback(
    (productId: string) => {
      navigate(`${hub}?product=${encodeURIComponent(productId)}&compose=1`);
    },
    [hub, navigate],
  );
}
