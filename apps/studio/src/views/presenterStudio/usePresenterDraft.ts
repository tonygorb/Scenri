import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type PresenterDraft, type PresenterDraftView } from '../../api.js';

/**
 * The draft on the page, as the server holds it. Every action answers with
 * the whole draft, so state is replaced, never merged; polling runs only
 * while a step is drawing, because this page is the row's only writer.
 */
export function usePresenterDraft(brandId: string, draftId: string) {
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

  const take = useCallback((next: PresenterDraft) => {
    if (alive.current) setDraft(next);
  }, []);

  const load = useCallback(async () => {
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
        if (alive.current) setErr(String(e?.message ?? e));
        return false;
      } finally {
        if (alive.current) setBusy(false);
      }
    },
    [take],
  );

  return {
    draft,
    gone,
    err,
    busy,
    drawing,
    reload: load,
    generate: (view: PresenterDraftView, adjustment?: string) =>
      act(async () => (await api.generateDraftView(brandId, draftId, view, adjustment ? { adjustment } : {})).draft),
    approve: (view: PresenterDraftView) => act(() => api.approveDraftView(brandId, draftId, view)),
    redo: (view: PresenterDraftView) => act(() => api.redoDraftView(brandId, draftId, view)),
    placePhoto: (view: PresenterDraftView, hash: string) =>
      act(() => api.placeDraftPhoto(brandId, draftId, view, hash)),
    update: (patch: { name?: string; facets?: string[]; direction?: string }) =>
      act(() => api.updatePresenterDraft(brandId, draftId, patch)),
    clearErr: () => setErr(null),
  };
}
