import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { api, type PresenterDraft, thumbUrl, uploadImage } from '../../api.js';
import { useAppData } from '../../app/AppShell.js';
import { normalizeHex, type Swatch as PaletteSwatch } from '../../brand/palette.js';
import { useBrand } from '../../app/BrandLayout.js';
import { useOpenSetup } from '../../app/dialogs.js';
import { type Answer, type Swatch, answersNothing, nowIso } from '../../conversation/question.js';
import { forgetSaid } from '../../conversation/Transcript.js';
import type { FlowProps } from '../flow.js';
import { type CreationState, EMPTY_STATE, deserialize, readyToDraw, reduce, serialize } from './creationState.js';
import { type AsidePhase, asideReply } from './presenterCopy.js';
import {
  TEXT_QIDS,
  activeQuestion,
  answerPatch,
  attachedWords,
  compileDirection,
  compileKeep,
  compileRefs,
  composerFor,
  editCost,
  flowContext,
  seedFromDraft,
  sentenceTarget,
  sourceFromText,
  turnsFor,
} from './presenterFlowRules.js';
import { colourName, colourRow } from './presenterLook.js';
import { type TraitId, traitOf } from './presenterTraits.js';
import {
  type Answers,
  type FlowContext,
  type LookStep,
  type Qid,
  type TraitQid,
  isLookQid,
  isQid,
  nextQuestion,
  traitOfQid,
} from './presenterQuestions.js';
import {
  MAX_PHOTOS,
  type StudioView,
  VIEW_LABEL,
  composerState,
  drawing as isDrawing,
  identityLocked,
  nextToDraw,
  refineTarget,
  saveBlocker,
  seedCategories,
  selectedView,
  stripItems,
  readsAsPerson,
  doingLine,
  takesOf,
} from './presenterStudioRules.js';
import { usePresenterDraft } from './usePresenterDraft.js';

/**
 * The creation flow: what the studio shell shows while a person is being
 * made, and what each answer does.
 *
 * The answers and the conversation around them are one reducer's state
 * (`creationState`), mirrored to session storage so a reload lands where it
 * left off; the server draft is the other truth, from the first generation
 * on. The transcript is computed from both on every render (`turnsFor`),
 * never stored. This hook wires taps and sentences to actions, and runs the
 * side effects (uploads, the draft, the drawing) at the edge, each one
 * checked against the revision it started under before it is allowed to
 * change anything.
 */
const setupKey = (brandId: string) => `scenri:presenter-setup:${brandId}`;
const pointerKey = (brandId: string) => `scenri:presenter-draft:${brandId}`;
const session = {
  read(key: string): string | null {
    try {
      return sessionStorage.getItem(key);
    } catch {
      return null;
    }
  },
  write(key: string, value: string) {
    try {
      sessionStorage.setItem(key, value);
    } catch {
      /* private mode */
    }
  },
  remove(key: string) {
    try {
      sessionStorage.removeItem(key);
    } catch {
      /* private mode */
    }
  },
};

export interface CreationFlowArgs extends Pick<FlowProps, 'onStarted' | 'caps' | 'capsNote'> {
  draftId: string | null;
  onOpenDraft: (id: string, replace?: boolean) => void;
  onLeaveDraft: () => void;
}

const sameRefs = (x: Record<string, string[]> | undefined, y: Record<string, string[]>) =>
  JSON.stringify(x ?? {}) === JSON.stringify(y);

/**
 * The detail a picture belongs to right now, or none.
 *
 * Whatever the conversation is on is what a picture would join: the answer
 * being changed, else the question being answered in words, else the one being
 * asked. One reading for the button and for what the button does, so the two
 * can never mean different questions; and none at all while some other answer
 * is being changed, because that answer is the only thing being acted on.
 */
function pictureFor(state: CreationState, ctx: FlowContext): { id: TraitId; part: 'what' | 'where' } | null {
  const focus =
    state.editing && state.editing !== 'name' ? state.editing : (state.saying ?? nextQuestion(state.answers, ctx));
  const trait = focus && focus !== 'keep' ? traitOfQid(focus) : null;
  return trait && trait.part === 'what' ? trait : null;
}

export function useCreationFlow({ draftId, onOpenDraft, onLeaveDraft, onStarted, caps, capsNote }: CreationFlowArgs) {
  const { brand } = useBrand();
  const { presenterCategories } = useAppData();
  const openSetup = useOpenSetup();
  const canDraw = !!caps?.canGenerate;

  const [state, dispatch] = useReducer(reduce, brand.id, (id) => {
    const back = deserialize(session.read(setupKey(id)));
    return back ? { ...EMPTY_STATE, answers: back.answers, revision: back.revision } : EMPTY_STATE;
  });
  // the latest state, for work that finishes after the render it started in
  const stateRef = useRef(state);
  stateRef.current = state;
  const stored = serialize(state);
  useEffect(() => {
    session.write(setupKey(brand.id), stored);
  }, [brand.id, stored]);

  const [focus, setFocus] = useState<StudioView | null>(null);
  const [compare, setCompare] = useState(false);
  const [askErr, setAskErr] = useState<string | null>(null);
  const [facets, setFacets] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [busySetup, setBusySetup] = useState(false);
  // what is being asked before something expensive: starting over, or a
  // changed answer that redraws what was drawn from the old one
  const [confirming, setConfirming] = useState<'start-over' | 'redraw' | null>(null);
  const [pendingEdit, setPendingEdit] = useState<Qid | null>(null);
  // pressed "Change something": the composer takes the focus, nothing else moves
  const [changing, setChanging] = useState(0);
  // the pictures on their way to the store, each shown from the file itself
  const [carrying, setCarrying] = useState<{ key: string; id: TraitQid; url: string }[]>([]);
  // the picture the browser holds for each one stored, so a chip shows the
  // thing itself rather than waiting on a thumbnail to be made
  const refShots = useRef(new Map<string, string>());
  const [booting, setBooting] = useState(!draftId);
  // the page opened on a draft: its conversation was had before this page
  const [resumed] = useState(!!draftId);
  useEffect(
    () => () => {
      for (const url of refShots.current.values()) URL.revokeObjectURL(url);
    },
    [],
  );
  const catsSeeded = useRef(false);
  const started = useRef('');
  const syncing = useRef(false);
  // the revision a draft was started from without a click, so one person is
  // one draft however many renders the start takes
  const autoStarted = useRef(-1);
  // which draft's answers were read into the conversation, once each
  const seededFor = useRef<string | null>(null);
  const leaving = useRef(false);

  const s = usePresenterDraft(brand.id, draftId);
  const d = s.draft;
  const ctx = useMemo(() => flowContext(d, canDraw), [d, canDraw]);

  // A new draft starts its own count of what was drawn without a click.
  useEffect(() => {
    started.current = '';
    catsSeeded.current = false;
    setFacets([]);
    if (!draftId) leaving.current = false;
  }, [draftId]);

  // A fresh start resumes the draft this session pointed at, in place.
  useEffect(() => {
    if (draftId) {
      setBooting(false);
      return;
    }
    let alive = true;
    const pointed = session.read(pointerKey(brand.id));
    if (!pointed) {
      setBooting(false);
      return;
    }
    void api
      .presenterDrafts(brand.id)
      .then((r) => {
        if (!alive) return;
        if (r.drafts.some((x) => x.id === pointed)) onOpenDraft(pointed, true);
        else session.remove(pointerKey(brand.id));
      })
      .catch(() => undefined)
      .finally(() => {
        if (alive) setBooting(false);
      });
    return () => {
      alive = false;
    };
  }, [brand.id, draftId, onOpenDraft]);

  // The engine's reading of the categories fills the line once, to correct rather than to type.
  useEffect(() => {
    if (catsSeeded.current || !d) return;
    const read = seedCategories(d, facets);
    if (!read) return;
    catsSeeded.current = true;
    setFacets(read);
  }, [d, facets]);

  useEffect(() => {
    if (s.gone) {
      session.remove(pointerKey(brand.id));
      onLeaveDraft();
    }
  }, [s.gone, brand.id, onLeaveDraft]);

  // A draft opened with no answers of its own carries them: the person was
  // drawn from what the draft holds, and the conversation reads from there.
  const carried = !!d && !state.answers.source;
  useEffect(() => {
    if (!carried || !d || leaving.current || seededFor.current === d.id) return;
    seededFor.current = d.id;
    dispatch({ type: 'restore', answers: seedFromDraft(d), revision: stateRef.current.revision + 1 });
  }, [carried, d]);

  const clearSetup = useCallback(
    (draftId?: string) => {
      session.remove(setupKey(brand.id));
      forgetSaid(`presenter-create:${brand.id}:new`);
      if (draftId) forgetSaid(`presenter-create:${brand.id}:${draftId}`);
    },
    [brand.id],
  );

  const openDraft = useCallback(
    (id: string) => {
      session.write(pointerKey(brand.id), id);
      onOpenDraft(id);
    },
    [brand.id, onOpenDraft],
  );

  /**
   * The draft, made from the answers as they stand. If the answers moved
   * while it was being made, the draft is of somebody else and is let go.
   */
  const startScratch = useCallback(async () => {
    const st = stateRef.current;
    if (!canDraw || busySetup) return;
    const rev = st.revision;
    setBusySetup(true);
    setAskErr(null);
    try {
      const keep = compileKeep(st.answers);
      const refs = compileRefs(st.answers);
      const draft = await api.createPresenterDraft(brand.id, {
        source: 'synthetic',
        direction: compileDirection(st.answers),
        ...(keep ? { keep } : {}),
        ...(Object.keys(refs).length ? { detailRefs: refs } : {}),
      });
      if (stateRef.current.revision !== rev) {
        void api.deletePresenterDraft(brand.id, draft.id).catch(() => undefined);
        return;
      }
      openDraft(draft.id);
    } catch (e: any) {
      setAskErr(String(e?.message ?? e));
    } finally {
      setBusySetup(false);
    }
  }, [brand.id, canDraw, busySetup, openDraft]);

  const startPhotos = useCallback(async () => {
    const st = stateRef.current;
    const photos = st.answers.photos;
    if (!photos?.hashes.length || !photos.attested || busySetup) return;
    const rev = st.revision;
    setBusySetup(true);
    setAskErr(null);
    try {
      const draft = await api.createPresenterDraft(brand.id, {
        source: 'photos',
        imageHashes: photos.hashes,
        attestation: true,
      });
      if (stateRef.current.revision !== rev) {
        void api.deletePresenterDraft(brand.id, draft.id).catch(() => undefined);
        return;
      }
      openDraft(draft.id);
    } catch (e: any) {
      setAskErr(String(e?.message ?? e));
    } finally {
      setBusySetup(false);
    }
  }, [brand.id, busySetup, openDraft]);

  // A person described in words starts drawing the moment nothing is left to
  // ask; the rows end at a read-back and a tap instead.
  const complete =
    !d && readyToDraw(state, ctx) && state.answers.source?.door === 'scratch' && state.answers.source.via !== 'taps';
  useEffect(() => {
    if (!complete || !canDraw || busySetup || askErr || booting || draftId) return;
    if (autoStarted.current === state.revision) return;
    autoStarted.current = state.revision;
    void startScratch();
  }, [complete, canDraw, busySetup, askErr, booting, draftId, state.revision, startScratch]);

  const addFiles = useCallback(async (files: File[]) => {
    setAskErr(null);
    dispatch({ type: 'upload-begin' });
    try {
      for (const f of files) {
        const h = await uploadImage(f);
        // the reducer refuses a photograph the door no longer wants
        dispatch({ type: 'uploaded', hash: h, max: MAX_PHOTOS });
      }
    } catch (e: any) {
      setAskErr(String(e?.message ?? e));
    } finally {
      dispatch({ type: 'upload-end' });
    }
  }, []);

  /**
   * An answer, given or changed. Nothing is drawn from it here: a change takes
   * back everything the conversation asked after it, so the person is not whole
   * again until those questions are answered, and drawing from each one on the
   * way would spend a generation on somebody half-described.
   */
  const commitAnswer = useCallback(
    (patch: Partial<Answers>) => {
      dispatch({ type: 'answer', patch, ctx });
    },
    [ctx],
  );

  const save = useCallback(async () => {
    if (!d || saving) return;
    const blocker = saveBlocker(d, d.name, canDraw);
    if (blocker) {
      setSaveErr(blocker);
      return;
    }
    setSaving(true);
    setSaveErr(null);
    try {
      await api.updatePresenterDraft(brand.id, d.id, { facets });
      const r = await api.savePresenterDraft(brand.id, d.id);
      session.remove(pointerKey(brand.id));
      clearSetup(d.id);
      dispatch({ type: 'start-over' });
      onStarted({ kind: 'presenter', id: r.presenter.id, name: r.presenter.name });
    } catch (e: any) {
      setSaving(false);
      setSaveErr(String(e?.message ?? e));
    }
  }, [d, saving, canDraw, brand.id, facets, clearSetup, onStarted]);

  const startOver = useCallback(async () => {
    const st = stateRef.current;
    const text = st.answers.describe || d?.direction || '';
    leaving.current = true;
    if (d) {
      try {
        await api.deletePresenterDraft(brand.id, d.id);
      } catch {
        /* a draft that is already gone is what we wanted */
      }
    }
    session.remove(pointerKey(brand.id));
    clearSetup(d?.id);
    dispatch({ type: 'start-over', text });
    setAskErr(null);
    setConfirming(null);
    setPendingEdit(null);
    autoStarted.current = -1;
    onLeaveDraft();
  }, [d, brand.id, clearSetup, onLeaveDraft]);

  // What is being waited for that never reached the engine, said once with a Retry.
  const failed = d ? (s.err && !isDrawing(d) ? s.err : null) : askErr;
  const turns = useMemo(() => turnsFor({ state, draft: d, canGenerate: canDraw, failed }), [state, d, canDraw, failed]);
  const question = activeQuestion(turns);
  const view: StudioView = d ? selectedView(d, focus) : 'portrait';
  const slot = d ? d.views[view] : null;
  const drawingNow = !!d && (d.activeView === view || d.stage === 'analyzing');
  // a picture is only put back while nothing is being drawn
  const idleNow = !!d && !d.activeView && d.stage === 'idle';

  /**
   * The draft carries what the answers say, once they are whole again.
   *
   * One place, one moment: the words reach the draft when there is nothing
   * left to ask, and what was already drawn from the old words is drawn again,
   * once. Nothing is drawn while a question is open, so a person half way
   * through changing their mind never spends a generation.
   */
  const ready = readyToDraw(state, ctx);
  const wordsWanted = compileDirection(state.answers);
  const keepWanted = compileKeep(state.answers);
  const refsWanted = compileRefs(state.answers);
  const synced =
    !d ||
    ((d.source !== 'synthetic' || (d.direction ?? '') === wordsWanted) &&
      (d.keep ?? '') === keepWanted &&
      sameRefs(d.detailRefs, refsWanted));
  const refsKey = JSON.stringify(refsWanted);
  useEffect(() => {
    if (!d || !ready || synced || s.busy || syncing.current) return;
    syncing.current = true;
    // what a picture was drawn from is what a redraw is worth: an empty view
    // is simply drawn when its turn comes
    const again =
      d.source === 'photos' ? (d.views.front.hash ? 'front' : null) : d.views.portrait.hash ? 'portrait' : null;
    void (async () => {
      await s.update({
        ...(d.source === 'synthetic' ? { direction: wordsWanted } : {}),
        keep: keepWanted,
        detailRefs: JSON.parse(refsKey) as Record<string, string[]>,
      });
      if (again) await s.redo(again);
    })().finally(() => {
      syncing.current = false;
    });
  }, [d, ready, synced, s.busy, s.update, s.redo, wordsWanted, keepWanted, refsKey]);

  // The next view is drawn with no click: the face first, then the set from
  // it, each landed view deciding itself; only the face waits for a person.
  // Nothing is drawn while an answer is open, or before the draft holds what
  // the answers say.
  useEffect(() => {
    if (!d || s.busy || !canDraw || s.err || !ready || !synced) return;
    const view = nextToDraw(d);
    if (!view) return;
    const key = `${view}:${d.views[view].attempts}:${d.generations}:${d.views[view].status}`;
    if (started.current === key) return;
    started.current = key;
    void s.generate(view, undefined, view === 'portrait' ? undefined : 'auto');
  }, [d, s.busy, s.generate, canDraw, s.err, ready, synced]);

  /** A sentence that answered nothing, kept where it was said. */
  const bounce = useCallback((said: string, reply: string, q: string | null) => {
    dispatch({ type: 'aside', aside: { said, reply, q, at: nowIso() } });
  }, []);

  const onAnswer = useCallback(
    (qid: string, a: Answer) => {
      setAskErr(null);
      const st = stateRef.current;
      if (isQid(qid)) {
        const patch = answerPatch(qid, a, st.answers);
        if (patch) {
          commitAnswer(patch);
          return;
        }
        if (qid === 'photos' && a.kind === 'photos') {
          const act = a.action;
          if (act.type === 'add') void addFiles(act.files);
          if (act.type === 'remove') dispatch({ type: 'remove-photo', hash: act.hash });
          if (act.type === 'attest') dispatch({ type: 'attest', checked: act.checked });
          if (act.type === 'reject') setAskErr('That was not an image. Drop a photo, or choose a file.');
          if (act.type === 'submit') void startPhotos();
          // the door opens again, and the photographs go with the one it was
          if (act.type === 'back') commitAnswer({ source: undefined });
        }
        return;
      }
      switch (qid) {
        case 'unsure': {
          if (a.kind !== 'confirm' || a.id !== 'use' || !st.unsure) return;
          const said = st.unsure.said;
          const at = st.unsure.q === 'describe' ? 'describe' : 'source';
          dispatch({ type: 'settle-unsure' });
          commitAnswer(
            at === 'describe' ? { describe: said } : { source: { door: 'scratch', via: 'typed' }, describe: said },
          );
          return;
        }
        case 'noengine':
          if (a.kind === 'confirm' && a.id === 'setup') openSetup();
          if (a.kind === 'confirm' && a.id === 'photos') commitAnswer({ source: { door: 'photos', via: 'taps' } });
          return;
        case 'agree': {
          if (a.kind !== 'confirm') return;
          // agreed: what was tapped is the person, and the face is drawn from it
          if (a.id === 'draw') void startScratch();
          // a detail the rows could not ask for, in their own words
          if (a.id === 'add') dispatch({ type: 'say', id: 'keep' });
          return;
        }
        case 'identity':
          if (a.kind !== 'confirm' || !d) return;
          if (a.id === 'use') {
            void s.approve('portrait');
            setFocus(null);
          }
          if (a.id === 'again') void s.generate('portrait');
          // changing the person is said in words: the composer takes it from here
          if (a.id === 'change') setChanging((n) => n + 1);
          return;
        case 'revision':
        case 'view-revision': {
          if (a.kind !== 'confirm' || !d) return;
          const v =
            qid === 'revision'
              ? 'portrait'
              : ((Object.keys(d.views) as StudioView[]).find((x) => d.views[x].status === 'candidate') ?? view);
          if (a.id === 'use') void s.approve(v);
          if (a.id === 'keep') void s.revert(v);
          if (a.id === 'again') void s.generate(v, d.views[v].adjustment, v === 'portrait' ? undefined : 'auto');
          setCompare(false);
          return;
        }
        case 'retry': {
          if (!d) {
            // the draft that never started is started again, from a clean slate
            autoStarted.current = -1;
            setAskErr(null);
            return;
          }
          if (s.err) {
            // the request that failed is drawn again by the auto-draw, from a clean count
            s.clearErr();
            started.current = '';
            return;
          }
          const failedView = (Object.keys(d.views) as StudioView[]).find((x) => !!d.views[x].error);
          if (failedView) {
            // drawn again as it was asked for, not from scratch
            void s.generate(failedView, d.views[failedView].adjustment, failedView === 'portrait' ? undefined : 'auto');
          }
          return;
        }
        case 'extras':
          if (a.kind !== 'confirm') return;
          if (a.id === 'add') void s.update({ extras: true });
          if (a.id === 'save') dispatch({ type: 'extras-declined' });
          return;
        case 'blind':
          if (a.kind !== 'confirm') return;
          if (a.id === 'save') void save();
          if (a.id === 'setup') openSetup();
          return;
        case 'save':
          void save();
          return;
      }
    },
    [commitAnswer, addFiles, startPhotos, startScratch, openSetup, d, s, view, save],
  );

  const onSend = useCallback(
    (raw: string): boolean => {
      const typed = raw.trim();
      const st = stateRef.current;
      const target = sentenceTarget(st, question);
      // A colour in the chip is an answer on its own. Words beside it are the
      // person's own words about that colour, so the two read as one answer in
      // the order they are seen: the chip's colour, then what was typed.
      const heldNow = st.saying && st.colour?.step === st.saying ? st.colour.hex : null;
      const step = st.saying && isLookQid(st.saying) ? (st.saying.slice('look-'.length) as LookStep) : null;
      const chosen = heldNow && step ? colourName(heldNow, colourRow(step), step) : '';
      // A picture of the thing is an answer of its own, the way a colour is.
      const shown =
        target && target !== 'keep' && target.startsWith('trait-')
          ? (st.answers[target as TraitQid]?.refs ?? []).length
          : 0;
      const sentence = typed || heldNow || '';
      if (!sentence && !shown) return false;
      setAskErr(null);
      const again = (q: string | null) => st.asides.some((x) => x.q === q);

      // A detail in their own words: it answers the open half of that trait,
      // and the placement question follows only if the words did not say it.
      if (target && target !== 'keep' && target.startsWith('trait-')) {
        const trait = traitOfQid(target);
        if (!trait) return false;
        // A picture and nothing else is an answer: the words say so, and the
        // picture it names rides with them.
        const held = trait.part === 'what' ? (st.answers[target as TraitQid]?.refs ?? []) : [];
        if (!typed && held.length) {
          commitAnswer({ [target]: { words: attachedWords(trait.id, held.length), refs: held } });
          return true;
        }
        const empty = answersNothing(typed, readsAsPerson);
        if (!typed || empty) {
          bounce(typed, asideReply(empty ?? 'vague', 'detail', again(target), typed), target);
          return true;
        }
        if (trait.part === 'where') commitAnswer({ [target]: typed });
        else {
          const had = st.answers[target as TraitQid];
          commitAnswer({ [target]: { words: typed, refs: had?.refs ?? [] } });
        }
        return true;
      }
      // What is said here is what stays true of them: a second detail joins
      // the first rather than replacing it.
      if (target === 'keep') {
        const keep = [st.answers.keep?.trim(), typed].filter(Boolean).join(', ');
        commitAnswer({ keep });
        return true;
      }
      // a step being answered in words takes the sentence, and nothing else does
      if (target && isLookQid(target) && step) {
        // words in place of a tap are still words: what says nothing is bounced
        // the way it is anywhere else, and the step stays open. A swatch says
        // what it is, so only typed words are read this way, chip or no chip.
        const empty = typed && !/^#[0-9a-f]{6}$/i.test(typed) ? answersNothing(typed, readsAsPerson) : null;
        if (empty) {
          bounce(typed, asideReply(empty, 'look', again(target), typed, step), target);
          return true;
        }
        commitAnswer({ [target]: chosen && typed ? `${chosen} ${typed}` : sentence });
        return true;
      }
      const open = question?.id ?? null;
      const qid = open === 'unsure' ? (st.unsure?.q ?? 'source') : open;
      const phase: AsidePhase =
        qid === 'source' ? 'source' : qid === 'describe' ? 'describe' : qid === 'name' ? 'name' : 'refine';
      const door = qid === 'source' ? sourceFromText(sentence) : null;
      // What answers nothing is answered with the question, in words for what
      // was said, and stays in the conversation. A word or two that describes
      // nobody can still be a name, or a change to a view.
      const kind = door ? null : answersNothing(sentence, readsAsPerson);
      if (kind && (phase === 'source' || phase === 'describe' || kind !== 'vague')) {
        bounce(sentence, asideReply(kind, phase, again(open), sentence), open);
        return true;
      }
      // Before a face exists, a sentence with nothing of a person in it is asked about, not drawn.
      if ((qid === 'source' || qid === 'describe') && !door && !readsAsPerson(sentence)) {
        dispatch({ type: 'unsure', unsure: { said: sentence, q: open, at: nowIso() } });
        return true;
      }
      if (qid === 'source' || qid === 'describe') dispatch({ type: 'settle-unsure' });
      if (qid === 'source') {
        if (door) {
          commitAnswer({ source: { door, via: 'taps' } });
          return true;
        }
        commitAnswer({ source: { door: 'scratch', via: 'typed' }, describe: sentence });
        return true;
      }
      if (qid === 'describe') {
        commitAnswer({ describe: sentence });
        return true;
      }
      // A bare name, typed before any name was asked (a fast engine lands the face
      // first), names them rather than redrawing the face from it.
      if (
        d &&
        !d.name?.trim() &&
        qid !== 'name' &&
        /^[A-Z][a-z]+(?:\s[A-Z][a-z]+)?$/.test(sentence) &&
        !readsAsPerson(sentence)
      ) {
        void s.update({ name: sentence.slice(0, 60) });
        dispatch({ type: 'text', text: '' });
        return true;
      }
      if (qid === 'name') {
        const name =
          sentence.replace(/^(?:(?:her|his|their|the|my)\s+name\s+is|call\s+(?:her|him|them)|name:)\s*/i, '').trim() ||
          sentence;
        if (d) void s.update({ name: name.slice(0, 60) });
        dispatch({ type: 'text', text: '' });
        return true;
      }
      if (!d) return false;
      if (qid === 'identity') {
        void s.generate('portrait', sentence);
        dispatch({ type: 'text', text: '' });
        return true;
      }
      const target2 = refineTarget(sentence, view, d);
      if ('blocked' in target2) {
        setAskErr(target2.blocked);
        return false;
      }
      setFocus(target2.view);
      setCompare(false);
      void s.generate(target2.view, sentence, target2.scope === 'view' ? 'auto' : undefined);
      dispatch({ type: 'text', text: '' });
      return true;
    },
    [question, commitAnswer, bounce, d, s, view],
  );

  /**
   * An answer opened again from its pencil. Before a draft it simply opens;
   * with one on the stage it is asked about first, because the face and the
   * set were drawn from the old answer. The door and the photographs cannot
   * change under a draft: those start over.
   */
  const onEdit = useCallback(
    (turnId: string) => {
      if (turnId === 'name') {
        dispatch({ type: 'edit', id: 'name' });
        return;
      }
      if (!isQid(turnId)) return;
      const cost = editCost(turnId, d);
      if (cost === 'start-over') {
        setConfirming('start-over');
        return;
      }
      if (cost === 'redraw') {
        setPendingEdit(turnId);
        setConfirming('redraw');
        return;
      }
      dispatch({ type: 'edit', id: turnId });
    },
    [d],
  );

  /** The redraw agreed to: the answer opens, and what is tapped next redraws. */
  const confirmEdit = useCallback(() => {
    setConfirming(null);
    if (pendingEdit) dispatch({ type: 'edit', id: pendingEdit });
    setPendingEdit(null);
  }, [pendingEdit]);

  const onSaveEdit = useCallback(
    (turnId: string, said: string) => {
      const text = said.trim();
      if (!text) return;
      if (turnId === 'name') {
        dispatch({ type: 'cancel-edit' });
        if (d) void s.update({ name: text.slice(0, 60) });
        return;
      }
      if (isQid(turnId) && TEXT_QIDS.has(turnId)) commitAnswer({ [turnId]: text });
    },
    [d, s.update, commitAnswer],
  );
  const onCancelEdit = useCallback(() => dispatch({ type: 'cancel-edit' }), []);

  /**
   * A tap question answered in words instead. The first row hands the whole
   * look to a sentence; any other hands the composer that one question, and
   * only that one.
   */
  const onDescribe = useCallback(() => {
    const st = stateRef.current;
    const id = st.editing && st.editing !== 'name' && !TEXT_QIDS.has(st.editing) ? st.editing : question?.id;
    if (!id || !isQid(id)) return;
    if (id === 'look-who') {
      commitAnswer({ source: { door: 'scratch', via: 'words' } });
      return;
    }
    dispatch({ type: 'say', id });
  }, [question?.id, commitAnswer]);

  const traitTarget = useCallback((): TraitQid | null => {
    const t = pictureFor(stateRef.current, ctx);
    return t ? (`trait-${t.id}` as TraitQid) : null;
  }, [ctx]);

  /**
   * A picture of the thing itself, chosen and there at once.
   *
   * The chip stands in the line from the moment the file is picked, drawn from
   * the file in the browser, and the upload happens behind it; when the store
   * has it the chip keeps its place and simply points at the stored picture.
   * Waiting on a round trip to show a thumbnail is a wait for nothing: the
   * browser already has the bytes.
   */
  const onAttachTrait = useCallback(
    (files: File[]) => {
      const id = traitTarget();
      if (!id) return;
      setAskErr(null);
      // the line takes the answer from here, so the chip has somewhere to stand
      if (stateRef.current.saying !== id) dispatch({ type: 'say', id });
      // one picture of a thing: a second one chosen takes the first one's place
      for (const f of files.slice(0, 1)) {
        const key = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const url = URL.createObjectURL(f);
        setCarrying((c) => [...c, { key, id, url }]);
        void uploadImage(f)
          .then((hash) => {
            // the same picture keeps its place: the chip never waits on a
            // thumbnail being made when the browser is holding the bytes
            refShots.current.set(hash, url);
            dispatch({ type: 'ref', id, hash });
            setCarrying((c) => c.filter((x) => x.key !== key));
          })
          .catch((e: any) => {
            setAskErr(String(e?.message ?? e));
            setCarrying((c) => c.filter((x) => x.key !== key));
            URL.revokeObjectURL(url);
          });
      }
    },
    [traitTarget],
  );

  /** A colour's own name, as the chip shows it. */
  const colourLabel = (hex: string, among: Swatch[], row?: string) => {
    const name = colourName(hex, among, row);
    return name.charAt(0).toUpperCase() + name.slice(1);
  };

  /** The same swatches as a palette, for the colour menu the app already has. */
  const colourPalette = (step: LookStep): PaletteSwatch[] =>
    colourRow(step).flatMap((sw) => {
      const hex = sw.color ? normalizeHex(sw.color) : null;
      return hex ? [{ hex, name: sw.label, slot: 'accent' as const }] : [];
    });

  /**
   * The pictures riding with the answer being written: the ones still on their
   * way, from the file itself, then the ones the store holds.
   */
  const sayingTrait = state.saying && traitOfQid(state.saying);
  const refTarget = sayingTrait && sayingTrait.part === 'what' ? (`trait-${sayingTrait.id}` as TraitQid) : null;
  const composerRefs = (() => {
    if (!refTarget || !sayingTrait) return undefined;
    const held = state.answers[refTarget]?.refs ?? [];
    const mine = carrying.filter((c) => c.id === refTarget);
    // a chip is named for what it is a picture of, the way every chip in the
    // app is; several of the same thing are numbered, the way a view is
    const name = traitOf(sayingTrait.id)?.label ?? 'Reference';
    const many = held.length + mine.length > 1;
    let n = 0;
    const label = () => (many ? `${name} ${++n}` : name);
    return [
      ...held.map((hash) => ({
        key: hash,
        src: refShots.current.get(hash) ?? thumbUrl(hash, 'micro'),
        label: label(),
        onRemove: () => dispatch({ type: 'ref', id: refTarget, hash, remove: true }),
      })),
      ...mine.map((c) => ({
        key: c.key,
        src: c.url,
        label: label(),
        busy: true,
        onRemove: () => setCarrying((x) => x.filter((y) => y.key !== c.key)),
      })),
    ];
  })();

  const composerBase = composerFor(question, state, d, view);
  /**
   * The card stands down while a question with things to tap owns the answer,
   * and everything in it stands down with it: a way in that still worked
   * inside a card that plainly cannot be typed into is the card saying two
   * things at once. Say it in your own words and the card comes back, with
   * both the words and the way in for a picture.
   */
  const composerOff = s.busy || busySetup || booting || !!composerBase.off;
  // The detail a picture belongs to, whether or not the card can take one yet:
  // the way in stays on screen and says why, rather than coming and going.
  const attachTarget = pictureFor(state, ctx);
  const sayingStep = state.saying && isLookQid(state.saying) ? (state.saying.slice('look-'.length) as LookStep) : null;
  /** The colours this step is answered with, when it is answered with one. */
  const colours = composerBase.color && sayingStep ? colourPalette(sayingStep) : null;
  /** The colour in the composer, only while the step it was picked on is open. */
  const held = state.saying && state.colour?.step === state.saying ? state.colour.hex : null;
  const scope =
    d && identityLocked(d) && !composerBase.off && !question?.id.match(/^(name|describe)$/)
      ? (() => {
          const st = composerState(state.text, view, d);
          const h = st.chip ? d.views[st.chip.view].hash : undefined;
          return {
            chip: st.chip ? { label: st.chip.label, thumb: h ? thumbUrl(h, 'micro') : undefined } : null,
            hint: st.hint,
            tone: st.tone,
          };
        })()
      : null;

  const items = d ? stripItems(d, view) : [];
  const stageHash = slot?.hash ?? (d?.stage === 'analyzing' ? d.sources[0] : undefined);
  const shownHash = compare && slot?.prior ? slot.prior : stageHash;

  return {
    booting,
    d,
    view,
    slot,
    facets,
    setFacets,
    presenterCategories,
    saving,
    saveErr,
    confirming,
    setConfirming,
    confirmEdit,
    pendingEdit,
    startOver,
    /** Anything answered, or drawn: something to start over from. */
    begun: Object.keys(state.answers).length > 0 || !!d,
    /** The answers as they stand, for what watches the flow. */
    revision: state.revision,
    open: question?.id ?? null,
    keepPrevious:
      slot && slot.status === 'approved' && slot.prior && !drawingNow && !d?.activeView && d?.stage === 'idle'
        ? () => void s.revert(view)
        : null,
    surface: {
      title: 'Create presenter',
      // one conversation per draft: a second person started in the same tab is
      // a new conversation and arrives line by line, not already said
      memoryKey: `presenter-create:${brand.id}:${d?.id ?? 'new'}`,
      resumed,
      turns,
      busy: s.busy || busySetup,
      // Truthful: only where something is actually being waited for. A question
      // the flow already has arrives without anyone pretending to think.
      working: d?.stage === 'analyzing' ? 'Reading the photos' : d?.activeView ? 'Drawing' : busySetup || s.busy,
      stage: d
        ? {
            hash: shownHash,
            alt: `${VIEW_LABEL[view]}${slot?.status === 'candidate' ? ', candidate' : ''}`,
            drawing: drawingNow,
            since: d.updatedAt,
            doing: doingLine(d),
            takes: takesOf(d, view),
            onTake: idleNow ? (hash: string) => void s.restore(view, hash) : undefined,
            items,
            onPick: (v: StudioView) => {
              setFocus(v);
              setCompare(false);
            },
            compare:
              slot && slot.status === 'candidate' && slot.prior
                ? { on: compare, toggle: () => setCompare((c) => !c) }
                : undefined,
          }
        : null,
      // The composer is always there: it is where a sentence goes. Off, with the
      // reason under the card, while a sentence cannot be the answer.
      composer: {
        placeholder: composerBase.placeholder,
        label: composerBase.label,
        action: composerBase.action,
        scope,
        hint: null,
        why: composerBase.off ?? undefined,
        error: askErr ?? saveErr,
        disabled: composerOff,
        working: !!d && !!d.activeView && question?.id !== 'name',
        onStop: d?.activeView ? () => void s.stop() : undefined,
        focusKey: question ? `${question.id}:${d?.id ?? 'setup'}:${changing}:${state.saying ?? ''}` : undefined,
        // The way in for a picture is where it always is: beside the pill. At
        // the door it opens the photographs; on a detail it takes a picture of
        // the thing itself, the same as the way in on the question above.
        onAttach:
          !attachTarget && !d && question?.id === 'source'
            ? () => commitAnswer({ source: { door: 'photos', via: 'taps' } })
            : undefined,
        onAttachFiles: attachTarget ? onAttachTrait : undefined,
        // the tooltip and the name a reader hears are the same words, short
        attachLabel: attachTarget
          ? `${state.answers[`trait-${attachTarget.id}`]?.refs.length ? 'Replace' : 'Add'} the picture of the ${(
              traitOf(attachTarget.id)?.label ?? 'detail'
            ).toLowerCase()}`
          : 'Add photos',
        // A colour step takes a swatch as readily as it takes words, and the
        // colour rides in the chip the rest of the app already uses for one.
        refs: composerRefs,
        colour:
          colours && sayingStep
            ? {
                hex: held,
                label: held ? colourLabel(held, colourRow(sayingStep), sayingStep) : 'Pick a colour',
                // a colour of one's own starts from the middle of this step's own
                // row: a green is no way to begin picking skin
                seed: colours[Math.floor(colours.length / 2)]?.hex,
                onPick: (hex: string) => dispatch({ type: 'colour', hex }),
                onClear: () => dispatch({ type: 'colour', hex: null }),
              }
            : null,
      },
      text: state.text,
      onText: (text: string) => dispatch({ type: 'text', text }),
      onSend,
      onAnswer,
      onRestore: (view: string, hash: string) => void s.restore(view as StudioView, hash),
      onEdit,
      onSaveEdit,
      onCancelEdit,
      onDescribe,
      onAttachTrait,
      // A chip is a way to start saying something: it opens the composer on the
      // question it belongs to and leaves the words there to be finished. It
      // never answers, because "tattoo, yes" is not an answer to anything.
      onStarter: (text: string) => {
        if (question?.id === 'agree') dispatch({ type: 'say', id: 'keep' });
        dispatch({ type: 'text', text });
      },
      footnote: capsNote(''),
      onPaste: !d ? (files: File[]) => void addFiles(files) : undefined,
    },
  };
}

export type CreationFlow = ReturnType<typeof useCreationFlow>;
export type { PresenterDraft };
