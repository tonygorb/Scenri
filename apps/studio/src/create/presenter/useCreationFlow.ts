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
  nextLookStep,
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
          // or the last step comes back, to be tapped again
          if (a.id === 'change') onEditRef.current?.('look');
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
      // a look answer goes back one step, so it can be tapped again
      if (turnId === 'look') {
        const back = lastLookStep(setup.look ?? null);
        if (!back) return;
        const rest = { ...(setup.look && setup.look !== 'skipped' ? setup.look : {}) };
        delete rest[back];
        setSetup({ look: Object.keys(rest).length ? rest : null });
        return;
      }
      const effect = editEffect(turnId, !!d);
      if (turnId === 'name') {
        setText(d?.name ?? '');
        setUi((u) => ({ ...u, reasking: 'name' }));
        return;
      }
      if (effect === 'plain') {
        // what was said under the answers that go, goes with them
        const under = turnId === 'source' || turnId === 'photos' ? ['source'] : ['source', 'describe'];
        setUi((u) => ({
          ...u,
          unsure: null,
          asides: (u.asides ?? []).filter((a) => a.q === null || under.includes(a.q)),
        }));
        if (turnId === 'describe' || turnId === 'gaps') {
          setText(setup.description);
          setSetup({ description: '', gaps: null, gapsAsked: false });
        }
        if (turnId === 'source' || turnId === 'photos') setSetup({ source: null });
        return;
      }
      if (effect === 'redraw-identity') setConfirming('redescribe');
      if (effect === 'start-over') setConfirming('start-over');
    },
    // setup.look too: taking an answer back reads what has been given so far
    [d, setup.description, setup.look, setSetup],
  );
  onEditRef.current = onEdit;

  const composerBase = composerFor(question, d, view);
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
        focusKey: question ? `${question.id}:${d?.id ?? 'setup'}` : undefined,
        onAttach: !d && question?.id === 'source' ? () => setSetup({ source: 'photos' }) : undefined,
      },
      text,
      onText: setText,
      onSend,
      onAnswer,
      onRestore: (view: string, hash: string) => void s.restore(view as StudioView, hash),
      onEdit,
      onExpand: () => setUi((u) => ({ ...u, collapsed: false })),
      footnote: capsNote(''),
      onPaste: !d ? (files: File[]) => void addFiles(files) : undefined,
    },
  };
}

export type CreationFlow = ReturnType<typeof useCreationFlow>;
export type { PresenterDraft };
