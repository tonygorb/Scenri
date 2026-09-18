import { type Dispatch, useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../api.js';
import type { Brand, SceneReading, ScenePatch } from '../../apiTypes.js';
import { COPY } from './sceneCopy.js';
import { type Action, current, offerOf, type StudioState, versionOfHash } from './sceneStudioRules.js';

/** How often a running job is asked about. Once a second: a draw takes a minute. */
const POLL_MS = 1000;
/** Failed asks in a row before the studio says it has lost touch. */
const OFFLINE_AFTER = 3;

export interface SavedScene {
  id: string;
  name: string;
  verticals: string[];
}

/** The record the scene routes take, from the words standing and what they were made from. */
function patchOf(s: StudioState, words: SceneReading, hash: string | null): ScenePatch {
  return {
    name: s.name.trim() || words.name,
    prompt: words.prompt,
    lighting: words.lighting,
    description: words.description,
    subject: words.subject,
    // an empty string clears what a revision no longer says
    camera: words.camera ?? '',
    figure: words.figure ?? '',
    figureTreatment: words.figureTreatment ?? '',
    keywords: words.keywords ?? [],
    collections: words.collections ?? [],
    verticals: words.verticals ?? [],
    ...(words.promptName ? { promptName: words.promptName } : {}),
    instruction: s.place.trim(),
    refHashes: s.pictures,
    ...(hash ? { previewHash: hash } : {}),
  };
}

/**
 * The scene studio's work: starting a read, a draw or a change, watching it,
 * stopping it, and writing the scene on Use.
 *
 * Every answer from the server goes through the reducer, which refuses
 * anything for work this conversation is no longer waiting on, so a reload, a
 * Stop or a late poll can never put a stranger's picture on the stage.
 */
export function useSceneStudio(args: {
  s: StudioState;
  dispatch: Dispatch<Action>;
  brandId: string;
  sceneId: string | null;
  applyBrand: (b: Brand) => void;
  /** `asNew` when an edit was saved as a scene of its own. */
  onSaved: (made: SavedScene, asNew: boolean) => void;
}) {
  const { s, dispatch, brandId, sceneId, applyBrand } = args;
  const [offline, setOffline] = useState(false);
  const [saving, setSaving] = useState(false);
  const live = useRef(s);
  live.current = s;
  /** One press is one act: a latch that changes inside the tick, where state does not. */
  const pressing = useRef(false);
  const onSavedRef = useRef(args.onSaved);
  onSavedRef.current = args.onSaved;

  const start = useCallback(
    async (kind: 'make' | 'again' | 'change', opts: { ask?: string; draw?: boolean } = {}) => {
      if (pressing.current || live.current.job) return;
      pressing.current = true;
      try {
        const st = live.current;
        const v = current(st);
        const body =
          kind === 'make'
            ? { kind, instruction: st.place, imageHashes: st.pictures, draw: opts.draw ?? false }
            : kind === 'again'
              ? { kind, reading: v?.reading, imageHashes: st.pictures }
              : {
                  kind,
                  reading: v?.reading,
                  ask: opts.ask,
                  // before a picture exists the words change on their own; after, the picture changes with them
                  from: v?.hash ?? undefined,
                  imageHashes: st.pictures,
                  draw: opts.draw,
                };
        const { jobId, job } = await api.startSceneStudioJob(brandId, body);
        dispatch({ type: 'started', id: jobId, kind, ask: opts.ask, since: job.phaseAt });
      } catch (e: any) {
        dispatch({ type: 'error', text: String(e?.message ?? e) });
      } finally {
        pressing.current = false;
      }
    },
    [brandId, dispatch],
  );

  // One loop per job, keyed on its id: a reload re-attaches to the same work.
  const jobId = s.job?.id ?? null;
  useEffect(() => {
    if (!jobId) return;
    let alive = true;
    let misses = 0;
    let timer: ReturnType<typeof setTimeout>;
    const ask = async () => {
      try {
        const job = await api.sceneStudioJob(brandId, jobId);
        if (!alive) return;
        misses = 0;
        setOffline(false);
        if (job.status === 'running') {
          dispatch({ type: 'progress', job });
          timer = setTimeout(ask, POLL_MS);
        } else dispatch({ type: 'finished', job });
      } catch (e: any) {
        if (!alive) return;
        // the server no longer knows it: a restart between the start and now
        if (e?.status === 404) {
          dispatch({ type: 'lost', id: jobId, error: COPY.lost });
          return;
        }
        misses++;
        if (misses >= OFFLINE_AFTER) setOffline(true);
        timer = setTimeout(ask, Math.min(POLL_MS * 2 ** Math.min(misses, 3), 8000));
      }
    };
    void ask();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [jobId, brandId, dispatch]);

  const stop = useCallback(() => {
    const id = live.current.job?.id;
    if (id) void api.cancelSceneStudioJob(brandId, id).catch(() => undefined);
  }, [brandId]);

  const putBack = useCallback(
    (hash: string) => {
      const i = versionOfHash(live.current, hash);
      if (i >= 0) dispatch({ type: 'put-back', index: i });
    },
    [dispatch],
  );

  /**
   * Use: the words standing become the scene. A picture still drawing from
   * those words lands on the scene's card when it is done. Unnamed, it takes
   * the name the reader gave it.
   */
  const use = useCallback(
    async (opts: { asNew?: boolean } = {}) => {
      const st = live.current;
      const suggested = current(st)?.reading.name || st.job?.pending?.name || '';
      const named = { ...st, name: st.name.trim() || suggested };
      const offer = offerOf(named);
      if (!offer.can || !offer.words || pressing.current) return;
      pressing.current = true;
      setSaving(true);
      try {
        const drawing = st.job?.phase === 'drawing' ? st.job.id : null;
        const hash = drawing ? null : (current(st)?.hash ?? null);
        const body = patchOf(named, offer.words, hash);
        const res =
          sceneId && !opts.asNew ? await api.updateScene(brandId, sceneId, body) : await api.createScene(brandId, body);
        applyBrand(res.brand);
        const saved = res.scene as { id: string; name: string; verticals?: string[] };
        if (drawing) {
          const attached = await api.attachSceneStudioJob(brandId, drawing, saved.id).catch(() => null);
          if (attached?.state === 'landed') applyBrand(attached.brand);
        }
        onSavedRef.current({ id: saved.id, name: saved.name, verticals: saved.verticals ?? [] }, !!opts.asNew);
      } catch (e: any) {
        dispatch({ type: 'error', text: String(e?.message ?? e) });
      } finally {
        pressing.current = false;
        setSaving(false);
      }
    },
    [brandId, sceneId, applyBrand, dispatch],
  );

  return { offline, saving, start, stop, putBack, use };
}
