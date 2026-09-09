import { useCallback } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router';
import { useBrand } from '../app/BrandLayout.js';
import { headPresenterId } from '../brandAssets.js';
import { useCreateFlow } from '../create/AssetCreateHost.js';
import { PresenterEdit } from '../create/presenter/PresenterEdit.js';
import { presenterEditPath, presenterPath } from '../routes.js';
import { useTitleEntity } from '../useDocumentTitle.js';

/**
 * The editor as a URL: `/presenters/:presenterId/edit`, a child of the
 * presenter's page so the page stays mounted underneath and leaving is one
 * replace back onto it. A superseded id opens the current revision's editor.
 * A save lands on the page of whatever the save produced: the same record
 * when only words changed, the new revision when a picture did.
 */
export function PresenterEditRoute() {
  const { presenterId = '' } = useParams();
  const { brand } = useBrand();
  const navigate = useNavigate();
  const { caps, capsNote } = useCreateFlow();
  useTitleEntity('Edit presenter');

  const head = headPresenterId(brand, presenterId);
  const leave = useCallback((id: string) => navigate(presenterPath(brand, id), { replace: true }), [navigate, brand]);
  const close = useCallback(
    () => navigate(presenterPath(brand, presenterId), { replace: true }),
    [navigate, brand, presenterId],
  );

  if (head !== presenterId) return <Navigate to={presenterEditPath(brand, head)} replace />;
  return <PresenterEdit presenterId={presenterId} onLeave={leave} onClose={close} caps={caps} capsNote={capsNote} />;
}
