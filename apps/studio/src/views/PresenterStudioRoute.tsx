import { useCallback, useEffect, useRef } from 'react';
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
  const { announce, caps } = useCreateFlow();
  useTitleEntity('Create presenter');
  // A save resolves after an await. If the studio was closed meanwhile, the
  // person is somewhere else now, and the answer must not pull them back.
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  /**
   * The draft the conversation on screen is about, and a count that remounts it.
   *
   * The conversation keeps its answers in memory for as long as it is mounted,
   * which is right for the draft it made (a create replaces the address, and
   * the answers go on with the id) and wrong for any other. A toast's Open, or
   * an Activity row, pushes another draft's address into this same mount, and
   * the answers held here were read as that draft's: its words were rewritten,
   * its face drawn again, and this conversation's own key retired. So arriving
   * at a draft this conversation neither made nor was opened on starts that
   * draft's own conversation from nothing, the way opening it from the wall
   * does. Start over keeps the mount, and the words it hands the composer.
   */
  const about = useRef(draftId);
  const mount = useRef(0);
  if (draftId !== about.current) {
    about.current = draftId;
    mount.current += 1;
  }

  // Both only while the studio is on screen: a draft that answers after the
  // person went Back must not pull them back into it.
  const openDraft = useCallback(
    (id: string, replace = false) => {
      if (!mounted.current) return;
      if (replace) about.current = id;
      navigate(presenterStudioPath(brand, id), { replace });
    },
    [navigate, brand],
  );
  const leaveDraft = useCallback(() => {
    if (!mounted.current) return;
    about.current = null;
    navigate(presenterStudioPath(brand), { replace: true });
  }, [navigate, brand]);
  const close = useCallback(() => navigate(presentersPath(brand), { replace: true }), [navigate, brand]);

  return (
    <PresenterCreate
      key={mount.current}
      draftId={draftId}
      convoKey={draftId ?? key}
      onOpenDraft={openDraft}
      onLeaveDraft={leaveDraft}
      onClose={close}
      onStarted={(made) => {
        // said by the page it lands on, unless the person has already gone elsewhere
        announce(made, { quiet: mounted.current && made.kind === 'presenter' });
        if (!mounted.current) return;
        navigate(made.kind === 'presenter' ? presenterPath(brand, made.id) : presentersPath(brand), { replace: true });
      }}
      caps={caps}
    />
  );
}
