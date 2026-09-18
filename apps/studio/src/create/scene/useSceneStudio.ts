import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { api, uploadImage } from '../../api.js';
import type { Brand, SceneReading, ScenePatch } from '../../apiTypes.js';
import { COPY } from './sceneCopy.js';
import {
  type Caps,
  current,
  deserialize,
  EMPTY,
  offerOf,
  PICTURES_MAX,
  readAsk,
  reduce,
  repeatsLastAsk,
  serialize,
  type StudioState,
  unsaved,
  versionOfHash,
} from './sceneStudioRules.js';

/** How often a running job is asked about. Once a second: a draw takes a minute. */
const POLL_MS = 1000;
/** Failed asks in a row before the studio says it has lost touch. */
const OFFLINE_AFTER = 3;

export interface SavedScene {
  id: string;
  name: string;
  verticals: string[];
}

/** A picture on its way up: shown from the file itself the moment it is chosen. */
export interface Upload {
  id: string;
  url: string;
}

const storageOk = () => {
  try {
    return typeof sessionStorage !== 'undefined';
  } catch {
    return false;
  }
};

function load(key: string): StudioState | null {
  if (!storageOk()) return null;
  try {
    return deserialize(sessionStorage.getItem(key));
  } catch {
    return null;
  }
}

function store(key: string, s: StudioState) {
  if (!storageOk()) return;
  try {
    sessionStorage.setItem(key, serialize(s));
  } catch {
    // full or refused: the studio still works, it just does not resume
  }
}

function forget(key: string) {
  if (!storageOk()) return;
  try {
    sessionStorage.removeItem(key);
  } catch {
    // nothing to forget
  }
}

/** The record the scene routes take, from the words standing and what they were made from. */
function patchOf(s: StudioState, words: SceneReading, hash: string | null): ScenePatch {
  return {
    name: s.name.trim(),
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
 * The scene studio's edges: the session, the uploads, the jobs, the save.
 *
 * `rules` decides; this does. Every answer from the server goes through the
 * reducer, which refuses anything for work this conversation is no longer
 * waiting on, so a reload, a Stop or a late poll can never put a stranger's
 * picture on the stage.
 */
export function useSceneStudio(args: {
  brandId: string;
  /** Where this conversation is remembered across a reload. */
  storageKey: string;
  /** The saved scene, as version one, when editing. */
  seed: StudioState | null;
  sceneId: string | null;
  caps: Caps | null;
  applyBrand: (b: Brand) => void;
  /** `asNew` when an edit was saved as a scene of its own. */
  onSaved: (made: SavedScene, asNew: boolean) => void;
}) {
  const { brandId, storageKey, seed, sceneId, caps, applyBrand } = args;
  const [s, dispatch] = useReducer(reduce, null, () => load(storageKey) ?? seed ?? EMPTY);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [offline, setOffline] = useState(false);
  const [saving, setSaving] = useState(false);
  const live = useRef(s);
  live.current = s;
  const uploadsRef = useRef(uploads);
  uploadsRef.current = uploads;
  /** One press is one act: a latch that changes inside the tick, where state does not. */
  const pressing = useRef(false);
  const gone = useRef(false);
  const onSavedRef = useRef(args.onSaved);
  onSavedRef.current = args.onSaved;

  useEffect(() => {
    if (!gone.current) store(storageKey, s);
  }, [s, storageKey]);

  /* ---- pictures */

  const addFiles = useCallback(async (files: File[]) => {
    const room = PICTURES_MAX - live.current.pictures.length - uploadsRef.current.length;
    const images = files.filter((f) => f.type.startsWith('image/') || /\.(heic|heif)$/i.test(f.name));
    if (live.current.job) return;
    if (!images.length) {
      dispatch({ type: 'error', text: 'Only pictures can describe a place.' });
      return;
    }
    if (room <= 0) {
      dispatch({ type: 'error', text: 'Four pictures is the most a scene is read from.' });
      return;
    }
    const taking = images.slice(0, room);
    if (images.length > room) dispatch({ type: 'error', text: 'Four pictures is the most a scene is read from.' });
    // there in one frame: drawn from the file itself while the upload runs
    const pending = taking.map((f) => ({ id: `${f.name}-${f.size}-${Math.random()}`, url: URL.createObjectURL(f) }));
    setUploads((u) => [...u, ...pending]);
    // Sequential: a handful of small uploads is quick, and a failed one names itself.
    for (const [i, f] of taking.entries()) {
      try {
        const hash = await uploadImage(f);
        dispatch({ type: 'add-pictures', hashes: [hash] });
      } catch (e: any) {
        dispatch({ type: 'error', text: `${f.name} could not be added: ${String(e?.message ?? e)}` });
      } finally {
        URL.revokeObjectURL(pending[i].url);
        setUploads((u) => u.filter((x) => x.id !== pending[i].id));
      }
    }
  }, []);

  const removePicture = useCallback((hash: string) => dispatch({ type: 'remove-picture', hash }), []);

  /* ---- work */

  const start = useCallback(
    async (kind: 'make' | 'again' | 'change', opts: { ask?: string; place?: string } = {}) => {
      if (pressing.current || live.current.job) return;
      pressing.current = true;
      try {
        if (opts.place !== undefined) dispatch({ type: 'place', text: opts.place });
        const st = live.current;
        const place = (opts.place ?? st.place).trim();
        const v = current(st);
        const body =
          kind === 'make'
            ? { kind, instruction: place, imageHashes: st.pictures, draw: caps ? caps.canDraw : true }
            : kind === 'again'
              ? { kind, reading: v?.reading, imageHashes: st.pictures }
              : { kind, reading: v?.reading, ask: opts.ask, from: v?.hash ?? undefined, imageHashes: st.pictures };
        const { jobId, job } = await api.startSceneStudioJob(brandId, body);
        dispatch({ type: 'started', id: jobId, kind, ask: opts.ask, since: job.phaseAt });
      } catch (e: any) {
        dispatch({ type: 'error', text: String(e?.message ?? e) });
      } finally {
        pressing.current = false;
      }
    },
    [brandId, caps],
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
  }, [jobId, brandId]);

  const stop = useCallback(() => {
    const id = live.current.job?.id;
    if (id) void api.cancelSceneStudioJob(brandId, id).catch(() => undefined);
  }, [brandId]);

  /**
   * The change line. What it is decides what it costs: a person or a product
   * is said no to, a way back is Put back, a greeting gets a line, the same
   * sentence again is Try again, and only a change spends a generation.
   */
  const send = useCallback(
    (text: string): boolean => {
      const t = text.trim();
      if (!t || live.current.job) return false;
      const read = readAsk(t);
      if (read.kind !== 'change') {
        dispatch({ type: 'say', text: read.say });
        // a refusal keeps the words, so they can be put another way
        return read.kind !== 'refuse';
      }
      if (repeatsLastAsk(live.current, t)) void start('again');
      else void start('change', { ask: t });
      return true;
    },
    [start],
  );

  const putBack = useCallback((hash: string) => {
    const i = versionOfHash(live.current, hash);
    if (i >= 0) dispatch({ type: 'put-back', index: i });
  }, []);

  const editWords = useCallback((reading: SceneReading) => dispatch({ type: 'edit-words', reading }), []);
  const setPlace = useCallback((text: string) => dispatch({ type: 'place', text }), []);
  const setName = useCallback((text: string) => dispatch({ type: 'name', text }), []);
  const clearSaid = useCallback(() => dispatch({ type: 'say', text: null }), []);

  /**
   * Use: the words standing become the scene. A picture still drawing from
   * those words lands on the scene's card when it is done.
   */
  const use = useCallback(
    async (opts: { asNew?: boolean } = {}) => {
      const st = live.current;
      const offer = offerOf(st);
      if (!offer.can || !offer.words || pressing.current) return;
      pressing.current = true;
      setSaving(true);
      try {
        const drawing = st.job?.phase === 'drawing' ? st.job.id : null;
        const hash = drawing ? null : (current(st)?.hash ?? null);
        const body = patchOf(st, offer.words, hash);
        const res =
          sceneId && !opts.asNew ? await api.updateScene(brandId, sceneId, body) : await api.createScene(brandId, body);
        applyBrand(res.brand);
        const saved = res.scene as { id: string; name: string; verticals?: string[] };
        if (drawing) {
          const attached = await api.attachSceneStudioJob(brandId, drawing, saved.id).catch(() => null);
          if (attached?.state === 'landed') applyBrand(attached.brand);
        }
        gone.current = true;
        forget(storageKey);
        onSavedRef.current({ id: saved.id, name: saved.name, verticals: saved.verticals ?? [] }, !!opts.asNew);
      } catch (e: any) {
        dispatch({ type: 'error', text: String(e?.message ?? e) });
      } finally {
        pressing.current = false;
        setSaving(false);
      }
    },
    [brandId, sceneId, applyBrand, storageKey],
  );

  /** Leaving on purpose: the conversation is forgotten, and anything still drawing is stopped. */
  const leave = useCallback(() => {
    const id = live.current.job?.id;
    if (id) void api.cancelSceneStudioJob(brandId, id).catch(() => undefined);
    gone.current = true;
    forget(storageKey);
  }, [brandId, storageKey]);

  return {
    s,
    uploads,
    uploading: uploads.length > 0,
    offline,
    saving,
    unsaved: unsaved(s, seed),
    addFiles,
    removePicture,
    setPlace,
    setName,
    start,
    stop,
    send,
    putBack,
    editWords,
    clearSaid,
    use,
    leave,
  };
}
