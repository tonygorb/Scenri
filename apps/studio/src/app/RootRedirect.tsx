import { Navigate } from 'react-router';
import { lastBrand } from '../prefs.js';
import { useAppData } from './AppShell.js';
import { brandPath } from '../routes.js';

/**
 * "/" is a question, not a page: which brand were you working on? First run has
 * no answer yet, so it goes to the wizard instead.
 */
export function RootRedirect() {
  const { brands } = useAppData();
  const pick = pickBrand(brands);
  if (!pick) return <Navigate to="/setup" replace />;
  return <Navigate to={brandPath(pick)} replace />;
}

/**
 * Which brand to fall back on, shared with BrandLayout so "/" and an unknown
 * brand cannot disagree about where you end up.
 *
 * Remembered by id, not by slug: a renamed brand is still the one you left.
 */
export function pickBrand<T extends { id: string }>(brands: T[]): T | null {
  const remembered = lastBrand();
  return brands.find((b) => b.id === remembered) ?? brands[0] ?? null;
}
