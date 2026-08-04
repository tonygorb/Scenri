import { Navigate } from 'react-router';
import { lastBrand } from '../prefs.js';
import { useAppData } from './AppShell.js';
import { brandPath } from './brandPath.js';

/**
 * "/" is a question, not a page: which brand were you working on? First run has
 * no answer yet, so it goes to the wizard instead.
 */
export function RootRedirect() {
  const { brands } = useAppData();
  if (brands.length === 0) return <Navigate to="/setup" replace />;

  // remembered by id, not by slug: a renamed brand is still the one you left
  const remembered = lastBrand();
  const pick = brands.find((b) => b.id === remembered) ?? brands[0];
  return <Navigate to={brandPath(pick)} replace />;
}
