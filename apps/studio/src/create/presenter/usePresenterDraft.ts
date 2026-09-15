import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type PresenterDraft, type PresenterDraftView } from '../../api.js';
import { acceptsDraft } from './draftTransport.js';

/**
 * The draft the dialog is holding, as the server holds it. Every action
 * answers with the whole draft, so state is replaced, never merged; polling
 * runs only while a step is drawing or the photos are being read.
 */
export function usePresenterDraft(brandId: string, draftId: string | null) {
  const [draft, setDraft] = useState<PresenterDraft | null>(null);
  const [gone, setGone] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // The id this hook is asking about, readable from work that started before
  // the page moved. A ref rather than the closure's own `draftId`, so an answer
  // is judged against where the page is now, not where it was when asked.
  const want = useRef(draftId);
  want.current = draftId;

  // Answers can cross, in two ways: an older read for this draft can land after
  // a newer one, and a read for a draft the page has since left can land at
  // all. `acceptsDraft` refuses both. See its note for what the second one did.
  const take = useCallback((next: PresenterDraft) => {
    if (!alive.current) return;
    setDraft((cur) => (acceptsDraft(cur, next, want.current) ? next : cur));
  }, []);

  // A different address is a different draft: nothing of the last one carries over.
  useEffect(() => {
    setDraft(null);
    setGone(false);
    setErr(null);
    setBusy(false);
  }, [draftId]);

  const load = useCallback(async () => {
    if (!draftId) return;
    const asked = draftId;
    try {
      take(await api.presenterDraft(brandId, asked));
    } catch (e: any) {
      if (!alive.current) return;
      // A failure belongs to the draft it was asked about. A 404 for a draft
      // the page has since left would otherwise redirect out of the one it is
      // on, and its error would be shown against somebody else's conversation.
      if (want.current !== asked) return;
      if (/HTTP 404|not found/i.test(String(e?.message ?? e))) setGone(true);
      else setErr(String(e?.message ?? e));
    }
  }, [brandId, draftId, take]);

  useEffect(() => {
    void load();
  }, [load]);

  const drawing = !!draft && (draft.stage !== 'idle' || !!draft.activeView);
  useEffect(() => {
    if (!drawing) return;
    const t = setInterval(() => void load(), 1500);
    return () => clearInterval(t);
  }, [drawing, load]);

  /** One action at a time, its answer taken as the new truth, its failure said once. */
  const act = useCallback(
    async (work: () => Promise<PresenterDraft>) => {
      const asked = want.current;
      setBusy(true);
      setErr(null);
      try {
        take(await work());
        return true;
      } catch (e: any) {
        if (!alive.current) return false;
        // Whatever this was, it was about the draft it was asked for. Once the
        // page has moved, its failure is not this conversation's to report.
        if (want.current !== asked) return false;
        // "A view is still being drawn" is not a failure: the work this asked
        // for is already happening. Said as an error it latched, stopped every
        // step the flow takes on its own, and stayed hidden until the drawing
        // ended. Read the row again instead, and carry on.
        if (e?.status === 409) {
          void load();
          return false;
        }
        setErr(String(e?.message ?? e));
        return false;
      } finally {
        // Always cleared, whether or not the page moved: a stale action that
        // left `busy` standing would hold the new conversation still forever.
        if (alive.current) setBusy(false);
      }
    },
    [take, load],
  );

  /**
   * Stable while the draft is.
   *
   * These were inline arrows, so every render handed back new functions and
   * the flow's one step effect, which depends on them, re-ran on every render.
   * The fired-key set was then the only thing between a render and a
   * generation, rather than the second guard it is meant to be.
   */
  const generate = useCallback(
    (view: PresenterDraftView, adjustment?: string, decide?: 'auto') =>
      act(
        async () =>
          (
            await api.generateDraftView(brandId, draftId ?? '', view, {
              ...(adjustment ? { adjustment } : {}),
              ...(decide ? { decide } : {}),
            })
          ).draft,
      ),
    [act, brandId, draftId],
  );
  const approve = useCallback(
    (view: PresenterDraftView) => act(() => api.approveDraftView(brandId, draftId ?? '', view)),
    [act, brandId, draftId],
  );
  const redo = useCallback(
    (view: PresenterDraftView) => act(() => api.redoDraftView(brandId, draftId ?? '', view)),
    [act, brandId, draftId],
  );
  const revert = useCallback(
    (view: PresenterDraftView) => act(() => api.revertDraftView(brandId, draftId ?? '', view)),
    [act, brandId, draftId],
  );
  const stop = useCallback(() => act(() => api.stopDraft(brandId, draftId ?? '')), [act, brandId, draftId]);
  const restore = useCallback(
    (view: PresenterDraftView, hash: string) => act(() => api.restoreDraftView(brandId, draftId ?? '', view, hash)),
    [act, brandId, draftId],
  );
  const placePhoto = useCallback(
    (view: PresenterDraftView, hash: string) => act(() => api.placeDraftPhoto(brandId, draftId ?? '', view, hash)),
    [act, brandId, draftId],
  );
  const update = useCallback(
    (patch: {
      name?: string;
      facets?: string[];
      direction?: string;
      keep?: string;
      detailRefs?: Record<string, string[]>;
      extras?: boolean;
    }) => act(() => api.updatePresenterDraft(brandId, draftId ?? '', patch)),
    [act, brandId, draftId],
  );
  const clearErr = useCallback(() => setErr(null), []);

  return {
    draft,
    gone,
    err,
    busy,
    drawing,
    reload: load,
    generate,
    approve,
    redo,
    revert,
    stop,
    restore,
    placePhoto,
    update,
    clearErr,
  };
}
