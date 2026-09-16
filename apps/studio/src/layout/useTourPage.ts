import { useMatch, useSearchParams } from 'react-router';
import { P } from '../routes.js';
import { pageTourId, type TourId } from '../tours.js';

/**
 * The tour that belongs to the page on screen, or null. Exact matches only, so
 * a product page, an open shot or the presenter studio over its library never
 * reads as the library itself. Hooks are taken unconditionally.
 */
export function useTourPage(): TourId | null {
  const home = !!useMatch(P.brand);
  const hub = !!useMatch(P.hub);
  const products = !!useMatch(P.products);
  const presenters = !!useMatch(P.presenters);
  const scenes = !!useMatch(P.scenes);
  const [params] = useSearchParams();
  return pageTourId({ home, hub, ungrouped: params.get('in') === 'ungrouped', products, presenters, scenes });
}
