import { useCallback } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useBrand } from '../app/BrandLayout.js';
import { useCreateFlow } from '../create/AssetCreateHost.js';
import { PresenterStudio } from '../create/presenter/PresenterStudio.js';
import { presenterStudioPath, presentersPath } from '../routes.js';
import { useTitleEntity } from '../useDocumentTitle.js';

/**
 * The presenter studio as a URL: `/presenters/new` for a fresh start,
 * `/presenters/new/:draftId` once there is a draft.
 *
 * Being a child route of the library keeps the library mounted underneath,
 * so leaving is instant and comes back to the same scroll. A draft's address
 * survives a reload and can be handed to someone; Back leaves the way the
 * close does, because every move inside the studio replaces rather than
 * pushes, leaving the one entry that opened it.
 *
 * What the studio shares with the two creation dialogs (the engine's
 * capabilities, the one announcement of what was made) still comes from the
 * host, so every door says the same thing.
 */
export function PresenterStudioRoute() {
  const { draftId = null } = useParams();
  const { brand } = useBrand();
  const navigate = useNavigate();
  const { announce, caps, capsNote } = useCreateFlow();
  useTitleEntity('Create presenter');

  const openDraft = useCallback(
    (id: string, replace = false) => navigate(presenterStudioPath(brand, id), { replace }),
    [navigate, brand],
  );
  const leaveDraft = useCallback(() => navigate(presenterStudioPath(brand), { replace: true }), [navigate, brand]);
  const close = useCallback(() => navigate(presentersPath(brand), { replace: true }), [navigate, brand]);

  return (
    <PresenterStudio
      draftId={draftId}
      onOpenDraft={openDraft}
      onLeaveDraft={leaveDraft}
      onClose={close}
      onStarted={(made) => {
        announce(made);
        close();
      }}
      caps={caps}
      capsNote={capsNote}
    />
  );
}
