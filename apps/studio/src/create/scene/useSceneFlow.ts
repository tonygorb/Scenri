import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { api, uploadImage } from '../../api.js';
import type { Brand, FeedNode, SceneExampleRole } from '../../apiTypes.js';
import { useAppData } from '../../app/AppShell.js';
import { useOpenSettings, useOpenSetup } from '../../app/dialogs.js';
import { customSceneById } from '../../brandAssets.js';
import { useBrand } from '../../app/BrandLayout.js';
import { useShotPages } from '../../composer/attach/useShotPages.js';
import { EXAMPLE_LABEL, examplesSubtitle, exampleTiles, missingMore } from '../../sceneExampleRules.js';
import { useSceneExamples } from '../../useSceneExamples.js';
import type { StageStripItem } from '../studio/StudioStage.js';
import { type Answer, nowIso } from '../../conversation/question.js';
import { forgetSaid } from '../../conversation/Transcript.js';
import { local } from '../../storage.js';
import { COPY } from './sceneCopy.js';
import { markSceneFinished } from './sceneDrafts.js';
import {
  asideReply,
  composerFor,
  describesPlace,
  type FlowArgs,
  type SetArgs,
  type Target,
  judge,
  packSession,
  recordQid,
  type ShotArgs,
  sceneOfBrief,
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
  isHeic,
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
  keptAsDraft,
  readDue,
  reduce,
  repeatsLastAsk,
  shownOf,
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

/** The record kept under a conversation's address, as stored; null when there is none. */
function readKept(key: string): { sceneId?: unknown; done?: unknown; session?: unknown } | null {
  const raw = local.get(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function load(key: string) {
  const o = readKept(key);
  return unpackSession(typeof o?.session === 'string' ? o.session : null);
}

/** Kept with the scene it edits, so the Scenes wall can tell a new scene's draft from an edit. */
function store(key: string, packed: string, sceneId: string | null) {
  local.set(key, JSON.stringify({ at: Date.now(), sceneId, session: packed }));
}

/**
 * What a shot card is called to a screen reader: the start of its prompt, cut
 * at a word. The whole head is 240 characters, heard forty-eight times over.
 */
function shotName(head: string): string {
  const t = head.trim();
  if (!t) return 'A shot';
  if (t.length <= 60) return t;
  const cut = t.slice(0, 60);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), 40)).trim()}…`;
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
  /** Use saved it: said to the rest of the app. The conversation stays open. */
  onSaved: (made: SavedScene, how: 'created' | 'updated') => void;
  /**
   * The last press after Use: where the saved scene goes next. `existing` is
   * a scene that was already there (a shot's own scene, taken as it is), so
   * nothing was saved and nothing is announced.
   */
  onDone: (sceneId: string, opts?: { existing?: true }) => void;
  /** What that press says. */
  finish: string;
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
    seed,
    applyBrand,
    onSaved: (made, asNew) => onSavedRef.current(made, sceneId && !asNew ? 'updated' : 'created'),
  });

  // Kept under the scene it saved, once it saved one, so the Scenes wall never
  // shows a used conversation as a draft. Another tab on the same address
  // writes the same key: a scene saved there stays saved here, and a record
  // let go there since this wrote it (Discard on the wall, or the last press)
  // stays let go rather than being written back by this tab's next change.
  const wrote = useRef(false);
  useEffect(() => {
    if (gone.current) return;
    const prev = readKept(storageKey);
    if (prev?.done === true || (wrote.current && !prev)) {
      gone.current = true;
      return;
    }
    const kept = typeof prev?.sceneId === 'string' ? prev.sceneId : null;
    store(storageKey, packSession(setup, studio), sceneId ?? studio.saved ?? kept);
    wrote.current = true;
  }, [setup, studio, storageKey, sceneId]);

  /* ---- after Use: the place in use */

  const savedId = studio.saved;
  const savedScene = savedId ? customSceneById(brand, savedId) : undefined;
  const ex = useSceneExamples(brand.id, savedId, savedScene?.placeUrl ?? null);
  const setRunning = ex.job?.status === 'running';
  /**
   * A press for the place in use on its way to the server. Until the run it
   * started is read back, the conversation waits as it does while a run
   * draws: the next offer used to be live before the one just answered had
   * even started.
   */
  const [asking, setAsking] = useState(false);
  const [stoppingSet, setStoppingSet] = useState(false);
  useEffect(() => {
    if (!setRunning) setStoppingSet(false);
  }, [setRunning]);
  const tiles = useMemo(() => exampleTiles(savedScene?.examples, ex.job), [savedScene?.examples, ex.job]);
  const onDoneRef = useRef(args.onDone);
  onDoneRef.current = args.onDone;
  const set: SetArgs | undefined = useMemo(() => {
    if (!savedId) return undefined;
    const kept = savedScene?.examples ?? [];
    return {
      tiles,
      running: setRunning || asking || ex.waiting,
      read: ex.read,
      who:
        kept[0]?.with ??
        ex.job?.subject.kind ??
        (savedScene?.subject === 'person' || savedScene?.figure ? 'presenter' : 'product'),
      noSubject: ex.read && !ex.job && !kept.length && ex.more.length === 0,
      missing: missingMore(ex.more, kept, ex.job),
      first: ex.first,
      // what the place moved under, said by the examples themselves: a hero that
      // came with the place is not stale because the close-up is still to come
      stale: ex.first.length > 0 && kept.some((e) => e.earlier),
      finish: args.finish,
    };
  }, [savedId, savedScene, tiles, setRunning, asking, ex.waiting, ex.read, ex.job, ex.first, ex.more, args.finish]);

  const drawSet = useCallback(
    (ask: { first: true } | { more: true } | { roles: SceneExampleRole[] }) => {
      if (!savedId) return;
      setNote(null);
      setAsking(true);
      void api
        .drawSceneExamples(brand.id, savedId, ask)
        .then(() => {
          setAsking(false);
          ex.again();
        })
        .catch((e: any) => {
          setAsking(false);
          // nothing started: the offer this press answered is made again
          if (!('roles' in ask)) dispatch({ type: 'set-failed', more: 'more' in ask });
          setNote(String(e?.message ?? e));
        });
    },
    [brand.id, savedId, ex.again],
  );

  /**
   * The last press: the conversation is over, and what it made is where it
   * goes. Its address keeps the scene's name, so a link to it later leads
   * there (`markSceneFinished`).
   */
  const finish = useCallback(() => {
    if (!savedId) return;
    gone.current = true;
    markSceneFinished(storageKey, savedId);
    forgetSaid(storageKey);
    onDoneRef.current(savedId);
  }, [savedId, storageKey]);

  /** Which picture of the set is on the stage: the one pressed, else the newest. */
  const [picked, setPicked] = useState<string | null>(null);
  // A new version is judged by its own hero first, not by whatever was pressed on the last one.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the version is what resets it
  useEffect(() => setPicked(null), [studio.current]);

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
  // ref is only the guard against a double effect inside one mount. A start
  // still on its way holds it: the read would be refused, and then never due
  // again in this mount, so it waits and goes once that work is known.
  const fired = useRef(new Set<number>());
  const readKey = readDue(studio, !edit && setupDone(setup.answers));
  useEffect(() => {
    if (readKey === null || work.starting || fired.current.has(readKey)) return;
    fired.current.add(readKey);
    void work.start('make', { draw: false, shot: setupRef.current.answers.source?.door === 'shot' });
  }, [readKey, work.starting, work.start]);

  /* ---- a place started from a shot */

  // The feed's own query, searched on the server and paged: every page read is
  // shown, and the next is asked for as the list is scrolled to its end. What
  // stood stays on screen while a new search is read, so the grid never
  // empties under the field being typed in.
  const [shotQuery, setShotQuery] = useState('');
  const pages = useShotPages(brand.id, shotQuery, !edit);
  const pagesRef = useRef(pages);
  pagesRef.current = pages;
  // Until the pages answer the search as typed, what stood stays: an empty
  // list in that gap is "not read yet", and saying "no shots" there made the
  // line blink under every keystroke.
  const lastShots = useRef<FeedNode[]>([]);
  if (pages.settled && !pages.error) lastShots.current = pages.items;
  const shotItems = pages.settled ? pages.items : lastShots.current;
  const shotsReading = !pages.error && (!pages.settled || pages.loading);
  // Whether there is a shot at all: the unsearched library once it lands, and
  // before that the brand's recent shelf, which is in long before a studio
  // opens. Null only on a reload that lands on the picture question first.
  const { recent, loaded } = useBrand();
  const [libraryHas, setLibraryHas] = useState<boolean | null>(null);
  useEffect(() => {
    if (!shotQuery.trim() && pages.settled && !pages.error) setLibraryHas(pages.items.length > 0);
  }, [shotQuery, pages.settled, pages.error, pages.items.length]);
  const anyShot = libraryHas ?? (recent.length > 0 ? true : loaded ? false : null);
  const shots: ShotArgs = useMemo(
    () => ({
      any: anyShot,
      items: shotItems.map((n) => ({ id: n.id, hash: n.images[0], alt: shotName(n.promptHead) })),
      query: shotQuery,
      more: pages.settled && pages.hasMore,
      loading: shotsReading,
      error: pages.error,
    }),
    [anyShot, shotItems, shotQuery, pages.settled, pages.hasMore, shotsReading, pages.error],
  );
  const catalogScenes = useAppData().scenes;

  /**
   * The shot picked, with the scene it was made in when there is one. A
   * refinement carries no scene of its own, so it is read off the first shot
   * of its line. Resolved before it is answered, so the read that follows the
   * answer never starts ahead of the question about the scene.
   */
  const pickShot = useCallback(
    async (id: string) => {
      const node = lastShots.current.find((n) => n.id === id) ?? pages.items.find((n) => n.id === id);
      if (!node?.images[0]) return;
      const rev = setupRef.current.revision;
      let sceneId = sceneOfBrief(node.brief);
      if (!sceneId && node.kind === 'edit') {
        const line = await api.lineage(node.id).catch(() => null);
        sceneId = sceneOfBrief(line?.ancestors.find((x) => x.kind === 'generation')?.brief);
        // the answers moved while the line was read: this pick is no longer the one standing
        if (setupRef.current.revision !== rev) return;
      }
      const name = sceneId
        ? (customSceneById(brand, sceneId)?.name ?? catalogScenes.find((x) => x.id === sceneId)?.name)
        : undefined;
      answerSetup({
        shot: { id: node.id, hash: node.images[0], ...(sceneId && name ? { scene: { id: sceneId, name } } : {}) },
        reuse: undefined,
      });
    },
    [brand, catalogScenes, pages.items],
  );

  /** The shot's own scene, taken as it is: nothing is read, drawn or saved. */
  const takeMadeIn = useCallback(() => {
    const scene = setupRef.current.answers.shot?.scene;
    if (!scene) return;
    gone.current = true;
    forget(storageKey);
    forgetSaid(storageKey);
    onDoneRef.current(scene.id, { existing: true });
  }, [storageKey]);

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
    shots,
    set,
  };
  const turns = useMemo(
    () => turnsFor(flow),
    [setup, studio, canDraw, uploading, editingName, shown, edit, shots, set],
  );
  const open = (() => {
    const last = turns[turns.length - 1];
    return last?.kind === 'question' ? last.question : null;
  })();
  const composer = composerFor(flow, open);

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

  /* ---- pictures */

  /** Pictures on their way up, counted against the four so two quick adds cannot pass it together. */
  const reserved = useRef(0);
  const addPictures = useCallback(
    async (files: File[]) => {
      const heic = files.some(isHeic);
      const images = files.filter((f) => f.type.startsWith('image/') && !isHeic(f));
      if (!images.length) {
        setNote(heic ? COPY.heicNotYet : COPY.onlyPictures);
        return;
      }
      // Pictures dropped or pasted choose the pictures, the same answer Add
      // pictures is, so a record drawn from other answers goes the same way.
      if (setupRef.current.answers.source?.door !== 'photos') answerSetup({ source: { door: 'photos' } });
      const have = setupRef.current.answers.photos?.hashes ?? [];
      const room = 4 - have.length - reserved.current;
      if (room <= 0) {
        setNote(COPY.fourPictures);
        return;
      }
      const taken = images.slice(0, room);
      setNote(images.length > room ? COPY.fourPictures : heic ? COPY.heicNotYet : null);
      reserved.current += taken.length;
      setUploading((n) => n + 1);
      try {
        for (const f of taken) {
          try {
            setupDispatch({ type: 'photo', hash: await uploadImage(f) });
          } catch (e: any) {
            setNote(`${f.name} could not be added: ${String(e?.message ?? e)}`);
          } finally {
            reserved.current -= 1;
          }
        }
      } finally {
        setUploading((n) => n - 1);
      }
    },
    [answerSetup],
  );

  const tilesRef = useRef(tiles);
  tilesRef.current = tiles;
  const openSettings = useOpenSettings();
  const openSetup = useOpenSetup();
  const onAnswer = useCallback(
    (qid: string, ans: Answer) => {
      setNote(null);
      // a failure's own fix, where it lives (failure.ts), and the line for one nothing here fixes
      if (ans.kind === 'confirm' && ans.id.startsWith('remedy:')) {
        const opens = ans.id.slice('remedy:'.length);
        if (opens === 'setup') openSetup();
        else if (opens === 'engines' || opens === 'budget') openSettings(opens);
        return;
      }
      if (ans.kind === 'confirm' && ans.id === 'reword') {
        setFocusKey(String(Date.now()));
        return;
      }
      if (qid === 'photos' && ans.kind === 'photos') {
        const act = ans.action;
        const hashes = setupRef.current.answers.photos?.hashes ?? [];
        if (act.type === 'add') void addPictures(act.files);
        else if (act.type === 'instead') answerSetup({ source: { door: 'shot' } });
        else if (act.type === 'remove') setupDispatch({ type: 'photos', hashes: hashes.filter((h) => h !== act.hash) });
        else if (act.type === 'reject') setNote(COPY.onlyPictures);
        else if (act.type === 'submit' && hashes.length) answerSetup({ photos: { hashes, done: true } });
        else if (act.type === 'back') answerSetup({ source: { door: 'guided' } });
        return;
      }
      if (qid === 'shot' && ans.kind === 'pick') {
        const act = ans.action;
        if (act.type === 'pick') void pickShot(act.id);
        else if (act.type === 'query') setShotQuery(act.text);
        else if (act.type === 'more') {
          if (!pagesRef.current.loading) pagesRef.current.loadMore();
        } else if (act.type === 'back') {
          setShotQuery('');
          answerSetup({ source: { door: 'photos' }, photos: { hashes: [], done: false } });
        }
        return;
      }
      if (qid === 'reuse' && ans.kind === 'choice' && ans.id === 'use') {
        takeMadeIn();
        return;
      }
      if (isQid(qid)) {
        const patch = answerPatch(qid, ans, setupRef.current.answers);
        if (patch) answerSetup(patch);
        return;
      }
      if (qid === 'retry') {
        void work.start('make', { draw: false, shot: setupRef.current.answers.source?.door === 'shot' });
        return;
      }
      if (ans.kind !== 'confirm') return;
      if (qid === 'set-start') {
        if (ans.id === 'draw-set') {
          dispatch({ type: 'set-drawn' });
          drawSet({ first: true });
        } else dispatch({ type: 'set-declined' });
        return;
      }
      if (qid === 'set-more') {
        if (ans.id === 'more') {
          dispatch({ type: 'ask-more' });
          drawSet({ more: true });
        } else dispatch({ type: 'decline-more' });
        return;
      }
      if (qid === 'set-done') {
        if (ans.id === 'retry-failed')
          drawSet({ roles: tilesRef.current.filter((t) => t.state === 'failed').map((t) => t.role) });
        else finish();
        return;
      }
      if (ans.id === 'draw' || ans.id === 'again') void work.start('again');
      else if (ans.id === 'use') void work.use();
      else if (ans.id === 'another-shot') onEditRef.current('shot');
    },
    [addPictures, answerSetup, work.start, work.use, drawSet, finish, pickShot, takeMadeIn, openSettings, openSetup],
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
        // work already running, or on its way, takes no second instruction: the words wait in the line
        if (studio.job || work.starting) return false;
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
        // the shot grid opens as it was first shown, not on a search left behind
        if (turnId === 'shot') setShotQuery('');
        // an answer the picture was drawn from is asked about once before it opens
        if (drawn(studio)) setConfirming(turnId);
        else setupDispatch({ type: 'edit', id: turnId });
      }
    },
    [studio],
  );
  const onEditRef = useRef(onEdit);
  onEditRef.current = onEdit;

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
  const setLine =
    setRunning && ex.job
      ? examplesSubtitle({
          status: ex.job.status,
          step: ex.job.current,
          done: ex.job.done.length,
          total: ex.job.roles.length,
          error: ex.job.error,
        })
      : undefined;
  const working = studio.job ? doingLine(studio) : work.saving ? 'Saving' : setLine;

  // The stage after Use: the place and its examples in the strip, the hero
  // first (it came with the place), the one pressed on the stage, else the one
  // being drawn, else the newest.
  const strip: StageStripItem[] = [];
  let onStage: { hash?: string; drawing: boolean } | null = null;
  const placeItem = (sel: string): StageStripItem => ({
    view: 'place',
    label: 'The place',
    state: sel === 'place' ? 'current' : 'approved',
    hash: v?.hash ?? undefined,
    photo: false,
    drawing: false,
    approved: true,
    error: false,
  });
  if (savedId) {
    const drawingNow = setRunning ? ex.job?.current : null;
    const newest = [...tiles].reverse().find((t) => t.state === 'shown')?.role ?? null;
    const sel = picked ?? drawingNow ?? newest ?? 'place';
    const heroFirst = tiles[0]?.role === 'hero' && tiles[0].state === 'shown';
    if (!heroFirst) strip.push(placeItem(sel));
    for (const [i, t] of tiles.entries()) {
      strip.push({
        view: t.role,
        label: EXAMPLE_LABEL[t.role],
        state: sel === t.role ? 'current' : t.state === 'shown' ? 'approved' : 'todo',
        hash: t.hash,
        photo: false,
        drawing: t.state === 'drawing',
        approved: t.state === 'shown',
        error: t.state === 'failed',
      });
      if (heroFirst && i === 0) strip.push(placeItem(sel));
    }
    const chosen = strip.find((x) => x.view === sel) ?? strip[0];
    onStage = { hash: chosen.hash, drawing: chosen.drawing };
  } else if (v?.hash && v.hero) {
    // Before Use: the hero is what is judged, and the place it came with sits
    // beside it, the picture a shot is given.
    const sel = picked === 'place' ? 'place' : 'hero';
    strip.push(
      {
        view: 'hero',
        label: EXAMPLE_LABEL.hero,
        state: sel === 'hero' ? 'current' : 'approved',
        hash: v.hero,
        photo: false,
        drawing: false,
        approved: true,
        error: false,
      },
      placeItem(sel),
    );
  }
  const begun = !edit && (!!setup.answers.source || studio.versions.length > 0);

  return {
    title: edit ? COPY.editTitle : COPY.title,
    turns,
    working,
    busy: work.saving,
    resumed: !!restored,
    memoryKey: storageKey,
    stage: onStage
      ? {
          hash: onStage.hash,
          alt: `${studio.name.trim() || v?.reading.name || 'The scene'}, in use`,
          drawing: onStage.drawing || (!!studio.job && studio.job.phase === 'drawing'),
          doing: setLine ?? doingLine(studio),
          items: strip,
          onPick: (view: string) => setPicked(view),
        }
      : {
          hash: (picked === 'place' ? v?.hash : shownOf(v)) ?? undefined,
          alt: `Preview of ${studio.name.trim() || v?.reading.name || 'the scene'}`,
          drawing: !!studio.job && studio.job.phase === 'drawing',
          since: studio.job?.since ?? undefined,
          doing: doingLine(studio),
          takes: studio.job ? undefined : takesOf(studio),
          onTake: work.putBack,
          items: strip,
          onPick: (view: string) => setPicked(view),
        },
    composer: {
      placeholder: composer.placeholder,
      label: composer.label,
      action: composer.action,
      disabled: composer.target.kind === 'off',
      why: composer.target.kind === 'off' ? composer.target.why || null : null,
      working: composer.working,
      // Whatever runs can be stopped, whichever question holds the line: the
      // place, or the pictures of it in use (what landed stays).
      // A Stop that never reached the server is said, and the pill is Stop again.
      onStop: studio.job
        ? () => {
            setNote(null);
            void work.stop().then((ok) => {
              if (!ok) setNote(COPY.stopLost);
            });
          }
        : setRunning && savedId
          ? () => {
              setStoppingSet(true);
              void api
                .stopSceneExamples(brand.id, savedId)
                .then(() => ex.again())
                .catch(() => {
                  setStoppingSet(false);
                  setNote(COPY.stopLost);
                });
            }
          : undefined,
      stopping: !!studio.job?.stopping || stoppingSet,
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
    onRetry: (view: string) => drawSet({ roles: [view as SceneExampleRole] }),
    onDescribe: () => setFocusKey(String(Date.now())),
    onStarter: (t: string) => {
      setText(t);
      setFocusKey(String(Date.now()));
    },
    onPaste: open?.id === 'source' || open?.id === 'photos' ? (files: File[]) => void addPictures(files) : undefined,
    canDraw,
    begun,
    unsaved: studio.saved ? false : edit ? unsavedOf(studio, seed) : begun,
    /** Work is under way on the server for this conversation. */
    running: !!studio.job || setRunning,
    /** Use has saved it: closing goes where the last press would. */
    saved: !!savedId,
    finish,
    /** A new scene with something in it: it stays on the Scenes wall when the studio closes. */
    keptAsDraft: !edit && keptAsDraft(studio),
    leave: () => {
      void work.stop();
      gone.current = true;
      forget(storageKey);
      forgetSaid(storageKey);
    },
  };
}
