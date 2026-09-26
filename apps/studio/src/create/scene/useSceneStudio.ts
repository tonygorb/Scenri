import { type Dispatch, useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../api.js';
import type { Brand, SceneReading, ScenePatch } from '../../apiTypes.js';
import { COPY } from './sceneCopy.js';
import {
  type Action,
  changedFrom,
  current,
  offerOf,
  type StudioState,
  type Version,
  versionOfHash,
} from './sceneStudioRules.js';

/** How often a running job is asked about. Once a second: a draw takes a minute. */
const POLL_MS = 1000;
/** Failed asks in a row before the studio says it has lost touch. */
const OFFLINE_AFTER = 3;
/** A Stop lost on the way is sent once more, this much later, before the pill gives it back. */
const STOP_AGAIN_MS = 1000;

export interface SavedScene {
  id: string;
  name: string;
  verticals: string[];
}

/**
 * The record the scene routes take, from the words standing and what they were
 * made from. The place goes as the scene's picture and its hero as the hero
 * example; which one stands for the scene is the server's to keep (a new hero
 * is the cover only of a scene that has not chosen one).
 */
function patchOf(s: StudioState, words: SceneReading, v: Version | null): ScenePatch {
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
    refHashes: [...s.pictures, ...s.heldPictures],
    ...(v?.hash ? { previewHash: v.hash, anchor: v.anchor === true } : {}),
    ...(v?.hash && v.hero ? { heroHash: v.hero, ...(v.heroWith ? { heroWith: v.heroWith } : {}) } : {}),
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
  /** The conversation asking: the server answers a second start with the job already running. */
  conversation: string;
  /** The saved scene as the editor opened it: an edit sends only what changed from this. */
  seed: StudioState | null;
  applyBrand: (b: Brand) => void;
  /** `asNew` when an edit was saved as a scene of its own. */
  onSaved: (made: SavedScene, asNew: boolean) => void;
}) {
  const { s, dispatch, brandId, sceneId, conversation, applyBrand } = args;
  const [offline, setOffline] = useState(false);
  const [saving, setSaving] = useState(false);
  /**
   * A start on its way to the server, before any job is known. The line and
   * the read that starts on its own wait on it as they wait on running work:
   * a sentence sent now was emptied from the line and never started, and a
   * read due now was spent on a start that could not happen.
   */
  const [starting, setStarting] = useState(false);
  /** Starts that failed before anything ran: the question pressed is handed back each time. */
  const [failed, setFailed] = useState(0);
  const live = useRef(s);
  live.current = s;
  const seedRef = useRef(args.seed);
  seedRef.current = args.seed;
  /** One press is one act: a latch that changes inside the tick, where state does not. */
  const pressing = useRef(false);
  const onSavedRef = useRef(args.onSaved);
  onSavedRef.current = args.onSaved;

  const start = useCallback(
    async (kind: 'make' | 'again' | 'change', opts: { ask?: string; draw?: boolean; shot?: boolean } = {}) => {
      if (pressing.current || live.current.job) return;
      pressing.current = true;
      setStarting(true);
      try {
        const st = live.current;
        const v = current(st);
        const body =
          kind === 'make'
            ? {
                kind,
                instruction: st.place,
                imageHashes: st.pictures,
                draw: opts.draw ?? false,
                ...(opts.shot ? { shot: true } : {}),
              }
            : kind === 'again'
              ? { kind, reading: v?.reading, imageHashes: st.pictures }
              : {
                  kind,
                  reading: v?.reading,
                  ask: opts.ask,
                  // before a picture exists the words change on their own; after, the picture changes with them
                  from: v?.hash ?? undefined,
                  // an edit of an anchor is one too; of an older picture, it is not
                  ...(v?.hash && v.anchor ? { fromAnchor: true } : {}),
                  // the hero changes by the same sentence, keeping who stands in it
                  ...(v?.hash && v.hero ? { fromHero: v.hero, ...(v.heroWith ? { heroWith: v.heroWith } : {}) } : {}),
                  imageHashes: st.pictures,
                  draw: opts.draw,
                };
        const label = st.name.trim() || v?.reading.name || undefined;
        const { jobId, job, existing } = await api.startSceneStudioJob(brandId, {
          ...body,
          conversation,
          ...(sceneId ? { sceneId } : {}),
          ...(label ? { label } : {}),
        });
        // The job may be one already running for this conversation. The same
        // kind of work is a start that raced a remount, and is adopted as it
        // is. Another kind was started in another window on the same address,
        // from its own answers: its place is not this one's words.
        if (existing && job.kind !== kind) {
          dispatch({ type: 'error', text: COPY.busyElsewhere });
          return;
        }
        dispatch({
          type: 'started',
          id: jobId,
          kind: job.kind,
          ask: job.kind === kind ? opts.ask : undefined,
          since: job.phaseAt,
        });
      } catch (e: any) {
        dispatch({ type: 'error', text: String(e?.message ?? e) });
        setFailed((n) => n + 1);
      } finally {
        pressing.current = false;
        setStarting(false);
      }
    },
    [brandId, dispatch],
  );

  // A start whose answer never came back (a reload or a Back while it was on
  // its way) left its work running on the server with no id kept here. Looked
  // for once, so the picture it is making lands in the conversation it was
  // pressed in. Only a conversation that has said something: a window opened
  // fresh on the same address has no work of its own to find.
  useEffect(() => {
    const st = live.current;
    if (st.job || (!st.versions.length && !st.inputsRev)) return;
    let alive = true;
    api
      .activity(brandId)
      .then((a) => {
        const w = a.studio?.find(
          (x) => x.kind === 'scene' && x.conversation === conversation && x.status === 'running' && !!x.job,
        );
        if (!alive || !w?.job || live.current.job || pressing.current) return;
        dispatch({ type: 'started', id: w.id.slice('scene:'.length), kind: w.job, since: w.startedAt });
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [brandId, conversation, dispatch]);

  // The name is asked while the first picture draws, after the work started:
  // once it is given, the work is called by it, so Activity and the card that
  // says it finished name the scene the person named.
  const named = s.named ? s.name.trim() : '';
  const labelledJob = s.job?.id ?? null;
  useEffect(() => {
    if (!labelledJob || !named) return;
    void api.labelSceneStudioJob(brandId, labelledJob, named).catch(() => undefined);
  }, [labelledJob, named, brandId]);

  // One loop per job, keyed on its id: a reload re-attaches to the same work.
  const jobId = s.job?.id ?? null;
  useEffect(() => {
    if (!jobId) return;
    let alive = true;
    let misses = 0;
    let first = true;
    let timer: ReturnType<typeof setTimeout>;
    const ask = async () => {
      try {
        const job = await api.sceneStudioJob(brandId, jobId);
        if (!alive) return;
        misses = 0;
        setOffline(false);
        // A Stop said before a reload may never have reached the server: the
        // page that sent it did not hear. Said again once, on re-attaching.
        if (first && job.status === 'running' && live.current.job?.stopping)
          void api.cancelSceneStudioJob(brandId, jobId).catch(() => undefined);
        first = false;
        if (job.status === 'running') {
          dispatch({ type: 'progress', job });
          timer = setTimeout(ask, POLL_MS);
        } else dispatch({ type: 'finished', job });
      } catch (e: any) {
        if (!alive) return;
        // the server no longer knows it: a restart between the start and now.
        // It is answering, so it is not lost touch with either.
        if (e?.status === 404) {
          setOffline(false);
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

  /**
   * Stop the work in flight. Said at once (the pill reads Stopping and cannot be
   * pressed again); the job ends on the server, and the poll brings its answer
   * back like any other. If it had already finished, that answer is the result:
   * a picture that landed before the Stop reached the server is kept, never
   * thrown away.
   *
   * A Stop lost on the way is sent once more (the server takes a second one
   * for work already stopping as nothing). Lost twice, the pill is Stop again
   * and the answer is false, so the flow can say so: a Stop swallowed in
   * silence left the pill on Stopping for good while the draw spent anyway.
   */
  const stop = useCallback((): Promise<boolean> => {
    const job = live.current.job;
    if (!job || job.stopping) return Promise.resolve(true);
    dispatch({ type: 'stopping', id: job.id });
    const send = () => api.cancelSceneStudioJob(brandId, job.id);
    return send()
      .catch(() => new Promise((r) => setTimeout(r, STOP_AGAIN_MS)).then(send))
      .then(
        () => true,
        () => {
          dispatch({ type: 'stop-failed', id: job.id });
          return false;
        },
      );
  }, [brandId, dispatch]);

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
   *
   * Saved here, and the conversation goes on: saving draws nothing, the place
   * in use is offered as its own press (sceneExamples.ts), and the studio shows
   * the pictures as they land. Leaving at any point loses nothing.
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
        // a picture still drawing lands on the scene by itself (attach below)
        const body = patchOf(named, offer.words, drawing ? null : (current(st) ?? null));
        const seed = seedRef.current;
        const was = seed ? current(seed) : null;
        const res =
          sceneId && !opts.asNew
            ? await api.updateScene(
                brandId,
                sceneId,
                seed && was ? changedFrom(body, patchOf(seed, was.reading, was)) : body,
              )
            : // Said with the conversation, so a Use pressed again after its answer
              // was lost (a reload, a dropped connection) is the scene already made.
              await api.createScene(brandId, { ...body, conversation });
        applyBrand(res.brand);
        const saved = res.scene as { id: string; name: string; verticals?: string[] };
        if (drawing) {
          const attached = await api.attachSceneStudioJob(brandId, drawing, saved.id).catch(() => null);
          if (attached?.state === 'landed') applyBrand(attached.brand);
        }
        dispatch({ type: 'saved', id: saved.id });
        onSavedRef.current({ id: saved.id, name: saved.name, verticals: saved.verticals ?? [] }, !!opts.asNew);
      } catch (e: any) {
        dispatch({ type: 'error', text: String(e?.message ?? e) });
      } finally {
        pressing.current = false;
        setSaving(false);
      }
    },
    [brandId, sceneId, conversation, applyBrand, dispatch],
  );

  return { offline, saving, starting, failed, start, stop, putBack, use };
}
