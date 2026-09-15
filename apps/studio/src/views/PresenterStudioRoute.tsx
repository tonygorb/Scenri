import { useCallback } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router';
import { useBrand } from '../app/BrandLayout.js';
import { useCreateFlow } from '../create/AssetCreateHost.js';
import { PresenterCreate } from '../create/presenter/PresenterCreate.js';
import { presenterPath, presenterStudioPath, presentersPath } from '../routes.js';
import { useTitleEntity } from '../useDocumentTitle.js';

/**
 * The presenter studio as a URL: `/presenters/new` for a fresh start,
 * `/presenters/new/:draftId` once there is a draft.
 *
 * Being a child route of the library keeps the library mounted underneath,
 * so leaving is instant and comes back to the same scroll. A draft's address
 * survives a reload and can be handed to someone; Back leaves the way the
 * close does, because every move inside the studio replaces rather than
 * pushes, leaving the one entry that opened it. A saved presenter lands on
 * its own page: it is an asset now, and the page is where it is edited.
 *
 * `/presenters/new` means a new conversation, every time. Before a draft
 * exists there is no id to key its answers by, so the conversation is named by
 * the history entry it is being had in: a push or a replace mints a fresh
 * `location.key`, a reload and Back and Forward restore the entry's own. That
 * is what makes Create presenter and Continue different actions, and it is the
 * same reasoning `ScrollPane` uses for scroll offsets.
 *
 * What the studio shares with the two creation dialogs (the engine's
 * capabilities, the one announcement of what was made) still comes from the
 * host, so every door says the same thing.
 */
export function PresenterStudioRoute() {
  const { draftId = null } = useParams();
  const { key } = useLocation();
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
    <PresenterCreate
      draftId={draftId}
      convoKey={draftId ?? key}
      onOpenDraft={openDraft}
      onLeaveDraft={leaveDraft}
      onClose={close}
      onStarted={(made) => {
        announce(made);
        navigate(made.kind === 'presenter' ? presenterPath(brand, made.id) : presentersPath(brand), { replace: true });
      }}
      caps={caps}
      capsNote={capsNote}
    />
  );
}
