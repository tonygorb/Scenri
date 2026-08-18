import { useMatch } from 'react-router';
import { P } from '../../routes.js';

/**
 * useParams only reaches as far as the route that rendered you, so the child
 * route's shotId is invisible from here. The overlay hangs off the hub and off
 * a set alike, so both spellings have to be matched — and unconditionally,
 * because React counts hooks by position.
 */
export function useNodeId(): string | null {
  const onHub = useMatch(P.hubShot);
  const inSet = useMatch(P.setShot);
  return onHub?.params.shotId ?? inSet?.params.shotId ?? null;
}
