import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, type PresenterDraft, thumbUrl, uploadImage } from '../../api.js';
import { useAppData } from '../../app/AppShell.js';
import { useBrand } from '../../app/BrandLayout.js';
import { useOpenSetup } from '../../app/dialogs.js';
import { type Answer, answersNothing, nowIso } from '../../conversation/question.js';
import { forgetSaid } from '../../conversation/Transcript.js';
import type { FlowProps } from '../flow.js';
import {
  type AsidePhase,
  asideReply,
  settleUnsure,
  EMPTY_SETUP,
  type FlowUi,
  type Setup,
  activeQuestion,
  composerFor,
  directionFrom,
  lastLookStep,
  LOOK_STEPS,
  nextLookStep,
  rewindAsides,
  rewindSetup,
  PASSED,
  editEffect,
  needsFollowUp,
  sourceFromText,
  turnsFor,
} from './presenterFlowRules.js';
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
 * Before a draft exists the answers live in `setup`, mirrored to session
 * storage so a reload lands where it left off; from the first generation on
 * the server draft is the only state. The transcript is computed from both
 * on every render (`turnsFor`), never stored.
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

function readSetup(brandId: string): Setup {
  const raw = session.read(setupKey(brandId));
  if (!raw) return EMPTY_SETUP;
  try {
    const s = JSON.parse(raw) as Partial<Setup>;
    return { ...EMPTY_SETUP, ...s, uploading: false };
  } catch {
    return EMPTY_SETUP;
  }
}

export interface CreationFlowArgs extends Pick<FlowProps, 'onStarted' | 'caps' | 'capsNote'> {
  draftId: string | null;
  onOpenDraft: (id: string, replace?: boolean) => void;
  onLeaveDraft: () => void;
}

export function useCreationFlow({ draftId, onOpenDraft, onLeaveDraft, onStarted, caps, capsNote }: CreationFlowArgs) {
  const { brand } = useBrand();
  const { presenterCategories } = useAppData();
  const openSetup = useOpenSetup();
  const canDraw = !!caps?.canGenerate;

  const [setup, setSetupState] = useState<Setup>(() => readSetup(brand.id));
  const [ui, setUi] = useState<FlowUi>({
    collapsed: false,
    extrasDeclined: false,
    reasking: null,
    failed: null,
    asides: [],
    unsure: null,
  });
  const [text, setText] = useState('');
  const [focus, setFocus] = useState<StudioView | null>(null);
  const [compare, setCompare] = useState(false);
  const [askErr, setAskErr] = useState<string | null>(null);
  const [facets, setFacets] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [busySetup, setBusySetup] = useState(false);
  const [confirming, setConfirming] = useState<'start-over' | 'redescribe' | null>(null);
  // the words said again, waiting on the question about the face drawn from the old ones
  const [said, setSaid] = useState<string | null>(null);
  // pressed "Change something": the composer takes the focus, nothing else moves
  const [changing, setChanging] = useState(0);
  const [booting, setBooting] = useState(!draftId);
  // the page opened on a draft: its conversation was had before this page
  const [resumed] = useState(!!draftId);
  const catsSeeded = useRef(false);
  const started = useRef('');

  const setSetup = useCallback(
    (patch: Partial<Setup> | ((s: Setup) => Setup)) => {
      setSetupState((cur) => {
        const next = typeof patch === 'function' ? patch(cur) : { ...cur, ...patch };
        session.write(setupKey(brand.id), JSON.stringify({ ...next, uploading: false }));
        return next;
      });
    },
    [brand.id],
  );
  const clearSetup = useCallback(
    (draftId?: string) => {
      session.remove(setupKey(brand.id));
      forgetSaid(`presenter-create:${brand.id}:new`);
      if (draftId) forgetSaid(`presenter-create:${brand.id}:${draftId}`);
      setSetupState(EMPTY_SETUP);
    },
    [brand.id],
  );

  const s = usePresenterDraft(brand.id, draftId);
  const d = s.draft;

  // A new draft starts its own count of what was drawn without a click.
  useEffect(() => {
    started.current = '';
    catsSeeded.current = false;
    setFacets([]);
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

  // The next view is drawn with no click: the face first, then the set from
  // it, each landed view deciding itself; only the face waits for a person.
  useEffect(() => {
    if (!d || s.busy || !canDraw || s.err) return;
    const view = nextToDraw(d);
    if (!view) return;
    const key = `${view}:${d.views[view].attempts}:${d.generations}:${d.views[view].status}`;
    if (started.current === key) return;
    started.current = key;
    void s.generate(view, undefined, view === 'portrait' ? undefined : 'auto');
  }, [d, s.busy, s.generate, canDraw, s.err]);

  const openDraft = useCallback(
    (id: string) => {
      session.write(pointerKey(brand.id), id);
      onOpenDraft(id);
    },
    [brand.id, onOpenDraft],
  );

  const startScratch = useCallback(
    async (next: Setup) => {
      if (!canDraw || busySetup) return;
      setBusySetup(true);
      setAskErr(null);
      try {
        const draft = await api.createPresenterDraft(brand.id, { source: 'synthetic', direction: directionFrom(next) });
        openDraft(draft.id);
      } catch (e: any) {
        setAskErr(String(e?.message ?? e));
      } finally {
        setBusySetup(false);
      }
    },
    [brand.id, canDraw, busySetup, openDraft],
  );

  const startPhotos = useCallback(async () => {
    if (!setup.photoHashes.length || !setup.attested || busySetup) return;
    setBusySetup(true);
    setAskErr(null);
    try {
      const draft = await api.createPresenterDraft(brand.id, {
        source: 'photos',
        imageHashes: setup.photoHashes,
        attestation: true,
      });
      openDraft(draft.id);
    } catch (e: any) {
      setAskErr(String(e?.message ?? e));
    } finally {
      setBusySetup(false);
    }
  }, [brand.id, setup.photoHashes, setup.attested, busySetup, openDraft]);

  const addFiles = useCallback(
    async (files: File[]) => {
      setAskErr(null);
      setSetup({ uploading: true, source: 'photos' });
      try {
        for (const f of files) {
          const h = await uploadImage(f);
          setSetup((cur) => ({
            ...cur,
            photoHashes:
              cur.photoHashes.includes(h) || cur.photoHashes.length >= MAX_PHOTOS
                ? cur.photoHashes
                : [...cur.photoHashes, h],
          }));
        }
      } catch (e: any) {
        setAskErr(String(e?.message ?? e));
      } finally {
        setSetup({ uploading: false });
      }
    },
    [setSetup],
  );

  const describe = useCallback(
    (sentence: string) => {
      const next: Setup = {
        ...setup,
        source: 'scratch',
        typed: setup.source === null,
        description: sentence.trim(),
        gaps: null,
        gapsAsked: false,
      };
      if (needsFollowUp(next.description)) {
        setSetup({ ...next, gapsAsked: true });
        return;
      }
      setSetup(next);
      void startScratch(next);
    },
    [setup, setSetup, startScratch],
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
      onStarted({ kind: 'presenter', id: r.presenter.id, name: r.presenter.name });
    } catch (e: any) {
      setSaving(false);
      setSaveErr(String(e?.message ?? e));
    }
  }, [d, saving, canDraw, brand.id, facets, clearSetup, onStarted]);

  const startOver = useCallback(async () => {
    const keep = setup.description || d?.direction || '';
    if (d) {
      try {
        await api.deletePresenterDraft(brand.id, d.id);
      } catch {
        /* a draft that is already gone is what we wanted */
      }
    }
    session.remove(pointerKey(brand.id));
    clearSetup(d?.id);
    setUi({ collapsed: false, extrasDeclined: false, reasking: null, failed: null, asides: [], unsure: null });
    setText(keep);
    setConfirming(null);
    onLeaveDraft();
  }, [setup.description, d, brand.id, clearSetup, onLeaveDraft]);

  // A request the engine never saw is said the way a failed draw is: once, with a Retry.
  const failed = s.err && d && !isDrawing(d) ? s.err : null;
  const turns = useMemo(
    () => turnsFor({ setup, draft: d, canGenerate: canDraw, ui: { ...ui, failed } }),
    [setup, d, canDraw, ui, failed],
  );
  const question = activeQuestion(turns);
  const view: StudioView = d ? selectedView(d, focus) : 'portrait';
  const slot = d ? d.views[view] : null;
  const drawingNow = !!d && (d.activeView === view || d.stage === 'analyzing');
  // a picture is only put back while nothing is being drawn
  const idleNow = !!d && !d.activeView && d.stage === 'idle';

  const onAnswer = useCallback(
    (qid: string, a: Answer) => {
      setAskErr(null);
      // anything else answered settles the sentence that was waiting
      if (qid !== 'unsure') setUi(settleUnsure);
      switch (qid) {
        case 'unsure': {
          if (a.kind !== 'confirm' || a.id !== 'use' || !ui.unsure) return;
          const said = ui.unsure.said;
          setUi((u) => ({ ...u, unsure: null }));
          describe(said);
          return;
        }
        case 'source':
          if (a.kind === 'choice') setSetup({ source: a.id as Setup['source'] });
          return;
        case 'noengine':
          if (a.kind === 'confirm' && a.id === 'setup') openSetup();
          if (a.kind === 'confirm' && a.id === 'photos') setSetup({ source: 'photos' });
          return;
        case 'agree': {
          if (a.kind !== 'confirm') return;
          // agreed: what was tapped is the person, and the face is drawn from it
          if (a.id === 'draw') void startScratch(setup);
          // a detail the steps could not ask for, in their own words
          if (a.id === 'add') setUi((u) => ({ ...u, saying: 'agree' }));
          // or the last step comes back, to be tapped again
          if (a.id === 'change') onEditRef.current?.(`look-${lastLookStep(setup.look ?? null) ?? 'who'}`);
          return;
        }
        case 'look-who':
        case 'look-age':
        case 'look-hair':
        case 'look-length':
        case 'look-skin':
        case 'look-build': {
          const step = nextLookStep(setup.look ?? null);
          if (!step) return;
          const had = setup.look && setup.look !== 'skipped' ? setup.look : {};
          const picks = a.kind === 'swatches' ? a.picks : a.kind === 'skip' ? { [step.row.id]: PASSED } : null;
          if (!picks) return;
          // one tap answers one step; nothing is drawn until it is all agreed to
          setSetup({ ...setup, look: { ...had, ...picks } });
          return;
        }
        case 'gaps': {
          if (a.kind === 'choices') {
            const next = { ...setup, gaps: a.picks };
            setSetup(next);
            void startScratch(next);
          }
          if (a.kind === 'skip') {
            const next = { ...setup, gaps: 'skipped' as const };
            setSetup(next);
            void startScratch(next);
          }
          return;
        }
        case 'photos': {
          if (a.kind !== 'photos') return;
          const act = a.action;
          if (act.type === 'add') void addFiles(act.files);
          if (act.type === 'remove')
            setSetup((cur) => ({ ...cur, photoHashes: cur.photoHashes.filter((h) => h !== act.hash) }));
          if (act.type === 'attest') setSetup({ attested: act.checked });
          if (act.type === 'reject') setAskErr('That was not an image. Drop a photo, or choose a file.');
          if (act.type === 'submit') void startPhotos();
          if (act.type === 'back') setSetup({ source: null });
          return;
        }
        case 'identity':
          if (a.kind !== 'confirm' || !d) return;
          if (a.id === 'use') {
            void s.approve('portrait');
            setFocus(null);
            setUi((u) => ({ ...u, collapsed: true }));
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
          if (!d) return;
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
          if (a.id === 'save') setUi((u) => ({ ...u, extrasDeclined: true }));
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
    [setup, setSetup, openSetup, startScratch, addFiles, startPhotos, d, s, view, save, ui.unsure, describe],
  );

  const onSend = useCallback(
    (raw: string): boolean => {
      const sentence = raw.trim();
      if (!sentence) return false;
      setAskErr(null);
      const open = question?.id;
      // a step being answered in words takes the sentence, and nothing else does
      if (ui.saying === 'agree') {
        setUi((u) => ({ ...u, saying: null }));
        const next = { ...setup, description: sentence };
        setSetup(next);
        setText('');
        void startScratch(next);
        return true;
      }
      if (ui.saying) {
        const step = ui.saying;
        // words in place of a tap are still words: what says nothing is bounced
        // the way it is anywhere else, and the step stays open
        // a swatch says what it is: a hex is the answer itself, not a sentence
        const empty = /^#[0-9a-f]{6}$/i.test(sentence) ? null : answersNothing(sentence, readsAsPerson);
        if (empty) {
          setUi((u) => ({
            ...u,
            asides: [
              ...(u.asides ?? []),
              {
                said: sentence,
                reply: asideReply(empty, 'describe', false, sentence),
                q: `look-${step}`,
                at: nowIso(),
              },
            ],
          }));
          setText('');
          return true;
        }
        const had = setup.look && setup.look !== 'skipped' ? setup.look : {};
        setUi((u) => ({ ...u, saying: null }));
        setSetup({ look: { ...had, [step]: sentence } });
        setText('');
        return true;
      }
      const qid = ui.reasking ?? (open === 'unsure' ? (ui.unsure?.q ?? 'source') : open);
      const phase: AsidePhase =
        qid === 'source'
          ? 'source'
          : qid === 'describe' || qid?.startsWith('look')
            ? 'describe'
            : qid === 'name'
              ? 'name'
              : 'refine';
      const door = qid === 'source' ? sourceFromText(sentence) : null;
      // What answers nothing is answered with the question, in words for what
      // was said, and stays in the conversation. A word or two that describes
      // nobody can still be a name, or a change to a view.
      const kind = door ? null : answersNothing(sentence, readsAsPerson);
      if (kind && (phase === 'source' || phase === 'describe' || kind !== 'vague')) {
        const again = (ui.asides ?? []).some((a) => a.q === (open ?? null));
        const aside = {
          said: sentence,
          reply: asideReply(kind, phase, again, sentence),
          q: open ?? null,
          at: nowIso(),
        };
        setUi((u) => ({ ...u, asides: [...(u.asides ?? []), aside] }));
        setText('');
        return true;
      }
      // Before a face exists, a sentence with nothing of a person in it is asked about, not drawn.
      if (
        (qid === 'source' || qid === 'describe' || qid === 'look') &&
        !door &&
        !ui.reasking &&
        !readsAsPerson(sentence)
      ) {
        const unsure = { said: sentence, q: open ?? null, at: nowIso() };
        setUi((u) => ({ ...settleUnsure(u), unsure }));
        setText('');
        return true;
      }
      if (qid === 'source' || qid === 'describe' || qid?.startsWith('look')) setUi(settleUnsure);
      if (qid === 'source') {
        const door = sourceFromText(sentence);
        if (door) {
          setSetup({ source: door });
          setText('');
          return true;
        }
        if (!canDraw) {
          setSetup({ source: 'scratch', description: sentence });
          setText('');
          return true;
        }
        describe(sentence);
        setText('');
        return true;
      }
      if (qid === 'describe' || qid?.startsWith('look')) {
        if (d && ui.reasking === 'describe') {
          void (async () => {
            await s.update({ direction: sentence });
            await s.redo('portrait');
          })();
          setUi((u) => ({ ...u, reasking: null, collapsed: false }));
          setSetup({ description: sentence });
          setText('');
          return true;
        }
        describe(sentence);
        setText('');
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
        setText('');
        return true;
      }
      if (qid === 'name') {
        const name =
          sentence.replace(/^(?:(?:her|his|their|the|my)\s+name\s+is|call\s+(?:her|him|them)|name:)\s*/i, '').trim() ||
          sentence;
        if (d) void s.update({ name: name.slice(0, 60) });
        setUi((u) => ({ ...u, reasking: null }));
        setText('');
        return true;
      }
      if (!d) return false;
      if (qid === 'identity') {
        void s.generate('portrait', sentence);
        setText('');
        return true;
      }
      const target = refineTarget(sentence, view, d);
      if ('blocked' in target) {
        setAskErr(target.blocked);
        return false;
      }
      setFocus(target.view);
      setCompare(false);
      void s.generate(target.view, sentence, target.scope === 'view' ? 'auto' : undefined);
      setText('');
      return true;
    },
    [ui.reasking, ui.asides, ui.unsure, question?.id, canDraw, setSetup, describe, d, s, view],
  );

  // onAnswer can need what the pencil does, and is declared before it
  const onEditRef = useRef<((turnId: string) => void) | null>(null);
  const onEdit = useCallback(
    (turnId: string) => {
      // a text answer is said again where it stands, not somewhere else
      if (turnId === 'describe' || turnId === 'name') {
        setUi((u) => ({ ...u, editing: turnId }));
        return;
      }
      // a step's own pencil takes that step back, and everything asked after it
      if (turnId.startsWith('look-')) {
        const id = turnId.slice('look-'.length);
        const had = setup.look && setup.look !== 'skipped' ? setup.look : {};
        const kept: Record<string, string> = {};
        for (const st of LOOK_STEPS) {
          if (st.row.id === id) break;
          if (had[st.row.id]) kept[st.row.id] = had[st.row.id];
        }
        setUi((u) => ({ ...u, asides: rewindAsides(u.asides ?? [], 'look') }));
        setSetup({ look: Object.keys(kept).length ? kept : null });
        return;
      }
      const effect = editEffect(turnId, !!d);
      if (turnId === 'name') {
        setText(d?.name ?? '');
        setUi((u) => ({ ...u, reasking: 'name' }));
        return;
      }
      if (effect === 'plain') {
        // One rule for taking an answer back, wherever the pencil is: this
        // answer goes, everything the flow asked after it goes with it, and
        // nothing before it moves. The door used to clear only itself, so
        // choosing it again brought back every answer that had followed it.
        const at = turnId === 'photos' ? 'source' : turnId;
        setUi((u) => ({ ...u, unsure: null, saying: null, asides: rewindAsides(u.asides ?? [], at) }));
        if (turnId === 'describe' || turnId === 'gaps') setText(setup.description);
        setSetup({ ...rewindSetup(setup, at), ...(at === 'source' ? { source: null, typed: false } : {}) });
        return;
      }
      if (effect === 'redraw-identity') setConfirming('redescribe');
      if (effect === 'start-over') setConfirming('start-over');
    },
    // setup.look too: taking an answer back reads what has been given so far
    [d, setup.description, setup.look, setSetup],
  );
  onEditRef.current = onEdit;

  /**
   * An answer said again. Everything the flow asked after it is taken back, in
   * the transcript and in what is drawn from, because the future it belonged to
   * is gone; nothing before it is touched.
   */
  const onSaveEdit = useCallback(
    (turnId: string, said: string) => {
      const text = said.trim();
      if (!text) return;
      setUi((u) => ({ ...u, editing: null, asides: rewindAsides(u.asides ?? [], turnId), unsure: null }));
      if (turnId === 'name') {
        if (d) void s.update({ name: text });
        return;
      }
      if (turnId === 'describe') {
        // a face already drawn from the old words is asked about, never quietly
        // replaced; before there is one, the new words simply stand
        if (d) {
          setSaid(text);
          setConfirming('redescribe');
          return;
        }
        setSetup({ ...rewindSetup(setup, 'describe'), description: text });
      }
    },
    [d, s.update, setSetup, setup],
  );

  /** The words said again, once the face drawn from the old ones is agreed to go. */
  const redrawFromSaid = useCallback(() => {
    if (!said) return;
    setConfirming(null);
    setSetup({ ...rewindSetup(setup, 'describe'), description: said });
    void (async () => {
      await s.update({ direction: said });
      await s.redo('portrait');
    })();
    setSaid(null);
  }, [said, s.update, s.redo, setSetup, setup]);
  const onCancelEdit = useCallback(() => setUi((u) => ({ ...u, editing: null })), []);

  /**
   * A step answered in words. The first step hands the whole look to a sentence;
   * any other hands the composer that one step, and only that one.
   */
  const onDescribe = useCallback(() => {
    const step = nextLookStep(setup.look ?? null);
    if (!step || step.row.id === 'who') {
      setSetup({ look: 'skipped' });
      return;
    }
    setUi((u) => ({ ...u, saying: step.row.id }));
  }, [setSetup, setup.look]);

  const composerBase = composerFor(question, d, view, ui.saying ?? null);
  const scope =
    d && identityLocked(d) && !composerBase.off && !question?.id.match(/^(name|describe)$/)
      ? (() => {
          const st = composerState(text, view, d);
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
    redrawFromSaid,
    setConfirming,
    startOver,
    redescribe: () => {
      setConfirming(null);
      setText(d?.direction ?? setup.description);
      setUi((u) => ({ ...u, reasking: 'describe' }));
    },
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
        // nothing is said under the composer: what cannot be answered there is
        // plain from the question above it, and the pill carries the reason
        hint: null,
        why: composerBase.off ?? undefined,
        error: askErr ?? saveErr,
        disabled: s.busy || busySetup || booting || !!composerBase.off,
        working: !!d && !!d.activeView && question?.id !== 'name',
        onStop: d?.activeView ? () => void s.stop() : undefined,
        focusKey: question ? `${question.id}:${d?.id ?? 'setup'}:${changing}` : undefined,
        onAttach: !d && question?.id === 'source' ? () => setSetup({ source: 'photos' }) : undefined,
        // a colour step takes a swatch as readily as it takes words
        onColor: composerBase.color ? (hex: string) => setText(hex) : undefined,
        colorValue: composerBase.color && /^#[0-9a-f]{6}$/i.test(text) ? text : null,
      },
      text,
      onText: setText,
      onSend,
      onAnswer,
      onRestore: (view: string, hash: string) => void s.restore(view as StudioView, hash),
      onEdit,
      onSaveEdit,
      onCancelEdit,
      onDescribe,
      onExpand: () => setUi((u) => ({ ...u, collapsed: false })),
      footnote: capsNote(''),
      onPaste: !d ? (files: File[]) => void addFiles(files) : undefined,
    },
  };
}

export type CreationFlow = ReturnType<typeof useCreationFlow>;
export type { PresenterDraft };
