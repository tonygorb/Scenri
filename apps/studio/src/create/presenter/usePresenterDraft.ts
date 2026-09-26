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
  // The view a failed draw was for, beside its words: a failure is said about
  // what did not draw. Null for anything else, and only read while `err` stands.
  const [errView, setErrView] = useState<PresenterDraftView | null>(null);
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

  /**
   * Whether the error standing is one a read left. A read is asked again every
   * second and a half while anything draws, so its failure is a moment, not
   * the conversation's: one lost poll used to latch "That did not go through:
   * Failed to fetch" with a Retry over a face that had landed fine, and stop
   * the set there. The next read that lands takes it back. An action's own
   * failure is left alone.
   */
  const readErr = useRef(false);

  // A different address is a different draft: nothing of the last one carries over.
  useEffect(() => {
    setDraft(null);
    setGone(false);
    setErr(null);
    readErr.current = false;
    setBusy(false);
  }, [draftId]);

  const load = useCallback(async () => {
    if (!draftId) return;
    const asked = draftId;
    try {
      take(await api.presenterDraft(brandId, asked));
      if (readErr.current && alive.current && want.current === asked) {
        readErr.current = false;
        setErr(null);
      }
    } catch (e: any) {
      if (!alive.current) return;
      // A failure belongs to the draft it was asked about. A 404 for a draft
      // the page has since left would otherwise redirect out of the one it is
      // on, and its error would be shown against somebody else's conversation.
      if (want.current !== asked) return;
      if (/HTTP 404|not found/i.test(String(e?.message ?? e))) setGone(true);
      else {
        readErr.current = true;
        setErrView(null);
        setErr(String(e?.message ?? e));
      }
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
    async (work: () => Promise<PresenterDraft>, view: PresenterDraftView | null = null) => {
      const asked = want.current;
      setBusy(true);
      setErr(null);
      readErr.current = false;
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
        readErr.current = false;
        setErrView(view);
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
        view,
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
  /**
   * One press is one act for the two that put a picture back. `busy` is state
   * and does not change inside a tick, so a double click on Keep previous sent
   * two reverts: the second found nothing previous to keep, and its 400 stood
   * as the conversation's error, with a Retry that could only fail again and
   * every step the flow takes on its own held behind it.
   */
  const puttingBack = useRef(false);
  const putBack = useCallback(
    async (work: () => Promise<PresenterDraft>) => {
      if (puttingBack.current) return false;
      puttingBack.current = true;
      try {
        return await act(work);
      } finally {
        puttingBack.current = false;
      }
    },
    [act],
  );
  const revert = useCallback(
    (view: PresenterDraftView) => putBack(() => api.revertDraftView(brandId, draftId ?? '', view)),
    [putBack, brandId, draftId],
  );
  /** Stop answers once the work has let go, which can take a moment: the pill says so meanwhile. */
  const [stopping, setStopping] = useState(false);
  const stop = useCallback(async () => {
    setStopping(true);
    try {
      return await act(() => api.stopDraft(brandId, draftId ?? ''));
    } finally {
      if (alive.current) setStopping(false);
    }
  }, [act, brandId, draftId]);
  const restore = useCallback(
    (view: PresenterDraftView, hash: string) => putBack(() => api.restoreDraftView(brandId, draftId ?? '', view, hash)),
    [putBack, brandId, draftId],
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
  const clearErr = useCallback(() => {
    readErr.current = false;
    setErr(null);
  }, []);

  return {
    draft,
    gone,
    err,
    errView,
    busy,
    drawing,
    reload: load,
    generate,
    approve,
    redo,
    revert,
    stop,
    stopping,
    restore,
    placePhoto,
    update,
    clearErr,
  };
}
