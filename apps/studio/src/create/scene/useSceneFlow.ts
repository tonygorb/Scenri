import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { uploadImage } from '../../api.js';
import type { Brand } from '../../apiTypes.js';
import { type Answer, nowIso } from '../../conversation/question.js';
import { forgetSaid } from '../../conversation/Transcript.js';
import { local } from '../../storage.js';
import { COPY } from './sceneCopy.js';
import {
  asideReply,
  composerFor,
  describesPlace,
  type FlowArgs,
  type Target,
  judge,
  packSession,
  placesTheyMade,
  recordQid,
  turnsFor,
  unpackSession,
} from './sceneFlowRules.js';
import { fillFrom, type SceneRow } from './sceneRows.js';
import {
  type Answers,
  answerPatch,
  commit,
  compileDirection,
  EMPTY_SETUP,
  isQid,
  isRow,
  type Qid,
  picturesOf,
  reduceSetup,
  setupDone,
} from './sceneSetup.js';
import {
  type Caps,
  current,
  doingLine,
  drawn,
  EMPTY,
  namedIn,
  readAsk,
  readDue,
  reduce,
  repeatsLastAsk,
  stale,
  type StudioState,
  takesOf,
  unsaved as unsavedOf,
} from './sceneStudioRules.js';
import { type SavedScene, useSceneStudio } from './useSceneStudio.js';

/**
 * Where a conversation is kept: the `local` lane, because the work it started
 * outlives the tab (a person can close the page mid-draw and open it again from
 * Activity), stamped so a conversation nobody came back to in a week is let go.
 */
const KEPT = 'scenri:scene-studio:';
const KEEP_MS = 7 * 24 * 60 * 60 * 1000;

function load(key: string) {
  const raw = local.get(key);
  if (!raw) return null;
  try {
    const o = JSON.parse(raw);
    return unpackSession(typeof o?.session === 'string' ? o.session : null);
  } catch {
    return null;
  }
}

/** Kept with the scene it edits, so the Scenes wall can tell a new scene's draft from an edit. */
function store(key: string, packed: string, sceneId: string | null) {
  local.set(key, JSON.stringify({ at: Date.now(), sceneId, session: packed }));
}

function forget(key: string) {
  local.del(key);
}

/** Conversations nobody returned to in a week. */
function pruneKept(now = Date.now()) {
  for (const k of local.keys(KEPT)) {
    let at = 0;
    try {
      at = Number(JSON.parse(local.get(k) ?? 'null')?.at) || 0;
    } catch {
      // unreadable is as good as old
    }
    if (now - at > KEEP_MS) local.del(k);
  }
}

/**
 * The scene studio's conversation: the setup answers, the versions, the
 * session, and every way a tap or a sentence moves them.
 *
 * The rules decide (`sceneSetup`, `sceneStudioRules`, `sceneFlowRules`); this
 * does. One thing happens on its own, and only one: once the place has been
 * given, it is read. Everything that spends a picture waits for a press.
 */
export function useSceneFlow(args: {
  brand: Brand;
  applyBrand: (b: Brand) => void;
  /** Editing this saved scene; null for a new one. */
  sceneId: string | null;
  /** The saved scene as version one, when editing. */
  seed: StudioState | null;
  /** The conversation's id: the server runs one job per conversation. */
  conversation: string;
  storageKey: string;
  caps: Caps | null;
  onSaved: (made: SavedScene, how: 'created' | 'updated') => void;
}) {
  const { brand, applyBrand, sceneId, seed, conversation, storageKey, caps } = args;
  const edit = sceneId && seed ? { name: seed.name } : null;
  // Nothing to resume is a new conversation: what an older one under the same
  // history entry said, and when, must not be remembered as said in this one.
  const [restored] = useState(() => {
    pruneKept();
    const r = load(storageKey);
    if (!r) forgetSaid(storageKey);
    return r;
  });
  const [setup, setupDispatch] = useReducer(reduceSetup, null, () => restored?.setup ?? EMPTY_SETUP);
  const [studio, dispatch] = useReducer(reduce, null, () => restored?.studio ?? seed ?? EMPTY);
  const [uploading, setUploading] = useState(0);
  const [text, setTextState] = useState('');
  /**
   * Who the line was answering when the typing began.
   *
   * A draw can land between the first letter and Enter, and the question on the
   * floor changes under the words: a name typed while the picture drew arrived
   * as a change to the scene and spent a generation on it. What was typed
   * answers what was asked, so the target is held from the first character
   * until the line is sent or emptied.
   */
  const lockedTarget = useRef<Target | null>(null);
  const [editingName, setEditingName] = useState(false);
  const [focusKey, setFocusKey] = useState<string | undefined>(undefined);
  const [note, setNote] = useState<string | null>(null);
  const gone = useRef(false);
  const setupRef = useRef(setup);
  setupRef.current = setup;
  const studioRef = useRef(studio);
  studioRef.current = studio;
  /** An answer reopened under a drawn picture, waiting on the person's yes. */
  const [confirming, setConfirming] = useState<Qid | null>(null);

  const onSavedRef = useRef(args.onSaved);
  onSavedRef.current = args.onSaved;
  const work = useSceneStudio({
    s: studio,
    dispatch,
    brandId: brand.id,
    sceneId,
    conversation,
    applyBrand,
    onSaved: (made, asNew) => {
      gone.current = true;
      forget(storageKey);
      forgetSaid(storageKey);
      onSavedRef.current(made, sceneId && !asNew ? 'updated' : 'created');
    },
  });

  useEffect(() => {
    if (!gone.current) store(storageKey, packSession(setup, studio), sceneId);
  }, [setup, studio, storageKey, sceneId]);

  // The place as the setup gives it, handed to the work once the setup is whole,
  // and not while an answer is open again: it is given when that answer is.
  useEffect(() => {
    if (edit || setup.editing || !setupDone(setup.answers)) return;
    dispatch({ type: 'inputs', place: compileDirection(setup.answers), pictures: picturesOf(setup.answers) });
  }, [setup.answers, setup.editing, edit]);

  // The one autonomous step: a place given and not read yet is read. Once per
  // revision of what was given, so a failure or a Stop asks rather than
  // retrying on its own. The revision tried is kept with the session
  // (`readTried`), so a reload or a Back does not start it again either; the
  // ref is only the guard against a double effect inside one mount.
  const fired = useRef(new Set<number>());
  const readKey = readDue(studio, !edit && setupDone(setup.answers));
  useEffect(() => {
    if (readKey === null || fired.current.has(readKey)) return;
    fired.current.add(readKey);
    void work.start('make', { draw: false });
  }, [readKey, work.start]);

  /**
   * Scenes this person already made. Read off the brand document, so a library
   * of hundreds of shots never arrives here as a strip of cans. Only places
   * with a picture, newest first; the question itself shows four and a way
   * to find the rest.
   */
  const have = useMemo(
    () => placesTheyMade((brand.json as { scenes?: { name?: unknown; preview?: unknown }[] })?.scenes ?? []),
    [brand],
  );

  const canDraw = caps?.canDraw ?? true;
  const shown = work.offline ? COPY.offline : note;
  const flow: FlowArgs = {
    setup,
    studio,
    canDraw,
    uploading,
    edit,
    editingName,
    note: shown,
    stale: stale(studio),
    have,
  };
  const turns = useMemo(() => turnsFor(flow), [setup, studio, canDraw, uploading, editingName, shown, edit, have]);
  const open = (() => {
    const last = turns[turns.length - 1];
    return last?.kind === 'question' ? last.question : null;
  })();
  const composer = composerFor(flow, open);

  /* ---- pictures */

  const addPictures = useCallback(async (files: File[]) => {
    const images = files.filter((f) => f.type.startsWith('image/') || /\.(heic|heif)$/i.test(f.name));
    if (!images.length) {
      setNote(COPY.onlyPictures);
      return;
    }
    const a = setupRef.current.answers;
    if (a.source?.door !== 'photos') setupDispatch({ type: 'answer', patch: { source: { door: 'photos' } } });
    const have = setupRef.current.answers.photos?.hashes ?? [];
    const room = 4 - have.length;
    if (room <= 0) {
      setNote(COPY.fourPictures);
      return;
    }
    setNote(images.length > room ? COPY.fourPictures : null);
    setUploading((n) => n + 1);
    try {
      for (const f of images.slice(0, room)) {
        try {
          const hash = await uploadImage(f);
          const now = setupRef.current.answers.photos?.hashes ?? [];
          setupDispatch({ type: 'photos', hashes: [...now, hash] });
        } catch (e: any) {
          setNote(`${f.name} could not be added: ${String(e?.message ?? e)}`);
        }
      }
    } finally {
      setUploading((n) => n - 1);
    }
  }, []);

  /* ---- what was said */

  const aside = (said: string, reply: string, q: string | null) =>
    setupDispatch({ type: 'aside', aside: { said, reply, q, at: nowIso() } });

  /**
   * An answer given. When it changes an answer the pictures were drawn from,
   * everything asked after that answer goes, and the pictures were asked after
   * it: the conversation reads forward (the person agreed to it first).
   */
  const answerSetup = useCallback((patch: Partial<Answers>) => {
    const s = setupRef.current;
    const was = s.held ?? s.answers;
    if (s.editing && drawn(studioRef.current) && JSON.stringify(commit(was, patch)) !== JSON.stringify(was))
      dispatch({ type: 'forget-record' });
    setupDispatch({ type: 'answer', patch });
  }, []);

  const onAnswer = useCallback(
    (qid: string, ans: Answer) => {
      setNote(null);
      if (qid === 'photos' && ans.kind === 'photos') {
        const act = ans.action;
        const hashes = setupRef.current.answers.photos?.hashes ?? [];
        if (act.type === 'add') void addPictures(act.files);
        // already in the store, so it is taken rather than uploaded; the cap
        // and the dedupe are the reducer's, the same as a dropped file's
        else if (act.type === 'pick')
          setupDispatch({
            type: 'photos',
            hashes: hashes.includes(act.hash) ? hashes.filter((h) => h !== act.hash) : [...hashes, act.hash],
          });
        else if (act.type === 'remove') setupDispatch({ type: 'photos', hashes: hashes.filter((h) => h !== act.hash) });
        else if (act.type === 'reject') setNote(COPY.onlyPictures);
        else if (act.type === 'submit' && hashes.length) answerSetup({ photos: { hashes, done: true } });
        else if (act.type === 'back') answerSetup({ source: { door: 'guided' } });
        return;
      }
      if (isQid(qid)) {
        const patch = answerPatch(qid, ans, setupRef.current.answers);
        if (patch) answerSetup(patch);
        return;
      }
      if (qid === 'retry') {
        void work.start('make', { draw: false });
        return;
      }
      if (ans.kind !== 'confirm') return;
      if (ans.id === 'draw' || ans.id === 'again') void work.start('again');
      else if (ans.id === 'use') void work.use();
    },
    [addPictures, answerSetup, work.start, work.use],
  );

  /** A sentence taken is gone from the line, the way every message box works. */
  const setText = (next: string) => {
    if (!next.trim()) lockedTarget.current = null;
    else if (!lockedTarget.current && composer.target.kind !== 'off') lockedTarget.current = composer.target;
    setTextState(next);
  };

  const onSend = (raw: string): boolean => {
    const took = route(raw);
    if (took) {
      lockedTarget.current = null;
      setTextState('');
    }
    return took;
  };

  /** Who the sentence is for, and what it does there. True when it was taken. */
  function route(raw: string): boolean {
    {
      const t = raw.trim();
      if (!t) return false;
      setNote(null);
      const target = lockedTarget.current ?? composer.target;
      if (target.kind === 'source') {
        // A whole description is the description, and nothing is asked after
        // it. A phrase is not nothing: what it names is taken as the answer to
        // those questions, and only what is left over is asked.
        if (describesPlace(t)) {
          answerSetup({ source: { door: 'words', text: t.slice(0, 400) } });
          return true;
        }
        const filled = fillFrom(t);
        const rows = Object.keys(filled) as SceneRow[];
        if (rows.length > 0) {
          answerSetup({
            source: { door: 'guided' },
            ...Object.fromEntries(rows.map((r) => [r, { pick: filled[r] }])),
          });
          return true;
        }
        aside(t, asideReply(judge(t, 'source') ?? 'vague', 'source'), 'source');
        return true;
      }
      if (target.kind === 'row' && isRow(target.id)) {
        const k = judge(t, 'row');
        if (k) {
          aside(t, asideReply(k, 'row'), target.id);
          return true;
        }
        const pick = setupRef.current.answers[target.id]?.pick;
        answerSetup({ [target.id]: { ...(pick ? { pick } : {}), words: t.slice(0, 200) } });
        return true;
      }
      if (target.kind === 'name') {
        dispatch({ type: 'name', text: namedIn(t) ?? t });
        return true;
      }
      if (target.kind === 'add' || target.kind === 'change') {
        // work already running takes no second instruction: the words wait in the line
        if (studio.job) return false;
        const read = readAsk(t);
        const q = recordQid(studio);
        if (read.kind === 'rename') {
          dispatch({ type: 'name', text: read.name });
          aside(t, COPY.renamed(read.name), q);
          return true;
        }
        if (read.kind !== 'change') {
          aside(t, read.say, q);
          return read.kind !== 'refuse';
        }
        if (target.kind === 'add') void work.start('change', { ask: t, draw: false });
        else if (repeatsLastAsk(studio, t)) void work.start('again');
        else void work.start('change', { ask: t });
        return true;
      }
      return false;
    }
  }

  const onEdit = useCallback(
    (turnId: string) => {
      if (studio.job) return;
      if (turnId === 'name') setEditingName(true);
      else if (isQid(turnId)) {
        // an answer the picture was drawn from is asked about once before it opens
        if (drawn(studio)) setConfirming(turnId);
        else setupDispatch({ type: 'edit', id: turnId });
      }
    },
    [studio],
  );

  const onSaveEdit = useCallback((turnId: string, said: string) => {
    if (turnId !== 'name') return;
    if (said.trim()) dispatch({ type: 'name', text: said.trim() });
    setEditingName(false);
  }, []);

  const onCancelEdit = useCallback(() => {
    setEditingName(false);
    setupDispatch({ type: 'cancel-edit' });
  }, []);

  const v = current(studio);
  const working = studio.job ? doingLine(studio) : work.saving ? 'Saving' : undefined;
  const begun = !edit && (!!setup.answers.source || studio.versions.length > 0);

  return {
    title: edit ? COPY.editTitle : COPY.title,
    turns,
    working,
    busy: work.saving,
    resumed: !!restored,
    memoryKey: storageKey,
    stage: {
      hash: v?.hash ?? undefined,
      alt: `Preview of ${studio.name.trim() || v?.reading.name || 'the scene'}`,
      drawing: !!studio.job && studio.job.phase === 'drawing',
      since: studio.job?.since ?? undefined,
      doing: doingLine(studio),
      takes: studio.job ? undefined : takesOf(studio),
      onTake: work.putBack,
      items: [],
    },
    composer: {
      placeholder: composer.placeholder,
      label: composer.label,
      action: composer.action,
      disabled: composer.target.kind === 'off',
      why: composer.target.kind === 'off' ? composer.target.why || null : null,
      working: composer.working,
      // Whatever runs can be stopped, whichever question holds the line.
      onStop: studio.job ? work.stop : undefined,
      stopping: !!studio.job?.stopping,
      focusKey,
      onAttachFiles: composer.attach ? (files: File[]) => void addPictures(files) : undefined,
      attachLabel: COPY.attachLabel,
    },
    text,
    onText: setText,
    onSend,
    onAnswer,
    onEdit,
    onSaveEdit,
    onCancelEdit,
    /** The yes to changing an answer under a drawn picture; the answer opens. */
    confirmingEdit: confirming !== null,
    confirmEdit: () => {
      if (confirming) setupDispatch({ type: 'edit', id: confirming });
      setConfirming(null);
    },
    cancelConfirm: () => setConfirming(null),
    onRestore: (_view: string, hash: string) => work.putBack(hash),
    onDescribe: () => setFocusKey(String(Date.now())),
    onStarter: (t: string) => {
      setText(t);
      setFocusKey(String(Date.now()));
    },
    onPaste: open?.id === 'source' || open?.id === 'photos' ? (files: File[]) => void addPictures(files) : undefined,
    canDraw,
    begun,
    unsaved: edit ? unsavedOf(studio, seed) : begun,
    /** Work is under way on the server for this conversation. */
    running: !!studio.job,
    leave: () => {
      work.stop();
      gone.current = true;
      forget(storageKey);
      forgetSaid(storageKey);
    },
  };
}
