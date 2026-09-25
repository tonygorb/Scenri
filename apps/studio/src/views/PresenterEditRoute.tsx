import { useCallback, useEffect, useRef, useState } from 'react';
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
  const { caps } = useCreateFlow();
  useTitleEntity('Edit presenter');
  // A save or a revert resolves after an await. If the editor was closed
  // meanwhile, the person is somewhere else now, and the answer must not pull
  // them back: the same guard the creation studio keeps.
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Decided once, on arrival: a save mints a new head while this route is
  // still mounted, and following it here would reopen the editor on the
  // new record instead of landing on its page. Arriving at another presenter
  // is a new arrival: the router mounts this afresh per presenter.
  const [head] = useState(() => headPresenterId(brand, presenterId));
  const leave = useCallback(
    (id: string) => {
      if (mounted.current) navigate(presenterPath(brand, id), { replace: true });
    },
    [navigate, brand],
  );
  const close = useCallback(
    () => navigate(presenterPath(brand, presenterId), { replace: true }),
    [navigate, brand, presenterId],
  );

  if (head !== presenterId) return <Navigate to={presenterEditPath(brand, head)} replace />;
  return <PresenterEdit presenterId={presenterId} onLeave={leave} onClose={close} caps={caps} />;
}
