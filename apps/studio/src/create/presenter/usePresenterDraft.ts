import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type PresenterDraft, type PresenterDraftView } from '../../api.js';

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

  // Answers can cross: a poll sent before an action lands after it. The row's
  // own clock decides, so an older answer never overwrites a newer draft.
  const take = useCallback((next: PresenterDraft) => {
    if (!alive.current) return;
    setDraft((cur) => (cur && cur.id === next.id && next.updatedAt < cur.updatedAt ? cur : next));
  }, []);

  // A different address is a different draft: nothing of the last one carries over.
  useEffect(() => {
    setDraft(null);
    setGone(false);
    setErr(null);
  }, [draftId]);

  const load = useCallback(async () => {
    if (!draftId) return;
    try {
      take(await api.presenterDraft(brandId, draftId));
    } catch (e: any) {
      if (!alive.current) return;
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
      setBusy(true);
      setErr(null);
      try {
        take(await work());
        return true;
      } catch (e: any) {
        if (!alive.current) return false;
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
        if (alive.current) setBusy(false);
      }
    },
    [take, load],
  );

  return {
    draft,
    gone,
    err,
    busy,
    drawing,
    reload: load,
    generate: (view: PresenterDraftView, adjustment?: string, decide?: 'auto') =>
      act(
        async () =>
          (
            await api.generateDraftView(brandId, draftId ?? '', view, {
              ...(adjustment ? { adjustment } : {}),
              ...(decide ? { decide } : {}),
            })
          ).draft,
      ),
    approve: (view: PresenterDraftView) => act(() => api.approveDraftView(brandId, draftId ?? '', view)),
    redo: (view: PresenterDraftView) => act(() => api.redoDraftView(brandId, draftId ?? '', view)),
    revert: (view: PresenterDraftView) => act(() => api.revertDraftView(brandId, draftId ?? '', view)),
    stop: () => act(() => api.stopDraft(brandId, draftId ?? '')),
    restore: (view: PresenterDraftView, hash: string) =>
      act(() => api.restoreDraftView(brandId, draftId ?? '', view, hash)),
    placePhoto: (view: PresenterDraftView, hash: string) =>
      act(() => api.placeDraftPhoto(brandId, draftId ?? '', view, hash)),
    update: (patch: {
      name?: string;
      facets?: string[];
      direction?: string;
      keep?: string;
      detailRefs?: Record<string, string[]>;
      extras?: boolean;
    }) => act(() => api.updatePresenterDraft(brandId, draftId ?? '', patch)),
    clearErr: () => setErr(null),
  };
}
