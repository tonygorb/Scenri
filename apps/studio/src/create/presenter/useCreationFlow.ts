import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, type PresenterDraft, thumbUrl, uploadImage } from '../../api.js';
import { useAppData } from '../../app/AppShell.js';
import { useBrand } from '../../app/BrandLayout.js';
import { useOpenSetup } from '../../app/dialogs.js';
import type { Answer } from '../../conversation/question.js';
import type { FlowProps } from '../flow.js';
import {
  EMPTY_SETUP,
  type FlowUi,
  type Setup,
  activeQuestion,
  composerFor,
  directionFrom,
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
  identityLocked,
  nextToDraw,
  refineTarget,
  saveBlocker,
  seedCategories,
  selectedView,
  stripItems,
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
  const [ui, setUi] = useState<FlowUi>({ collapsed: false, extrasDeclined: false, reasking: null });
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
  const clearSetup = useCallback(() => {
    session.remove(setupKey(brand.id));
    setSetupState(EMPTY_SETUP);
  }, [brand.id]);

  const s = usePresenterDraft(brand.id, draftId);
  const d = s.draft;

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
      clearSetup();
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
    clearSetup();
    setUi({ collapsed: false, extrasDeclined: false, reasking: null });
    setText(keep);
    setConfirming(null);
    onLeaveDraft();
  }, [setup.description, d, brand.id, clearSetup, onLeaveDraft]);

  const turns = useMemo(() => turnsFor({ setup, draft: d, canGenerate: canDraw, ui }), [setup, d, canDraw, ui]);
  const question = activeQuestion(turns);
  const view: StudioView = d ? selectedView(d, focus) : 'portrait';
  const slot = d ? d.views[view] : null;
  const drawingNow = !!d && (d.activeView === view || d.stage === 'analyzing');

  const onAnswer = useCallback(
    (qid: string, a: Answer) => {
      setAskErr(null);
      switch (qid) {
        case 'source':
          if (a.kind === 'choice') setSetup({ source: a.id as Setup['source'] });
          return;
        case 'noengine':
          if (a.kind === 'confirm' && a.id === 'setup') openSetup();
          if (a.kind === 'confirm' && a.id === 'photos') setSetup({ source: 'photos' });
          return;
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
          const failed = (Object.keys(d.views) as StudioView[]).find((x) => !!d.views[x].error);
          if (failed) void s.generate(failed, undefined, failed === 'portrait' ? undefined : 'auto');
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
    [setup, setSetup, openSetup, startScratch, addFiles, startPhotos, d, s, view, save],
  );

  const onSend = useCallback(
    (raw: string): boolean => {
      const sentence = raw.trim();
      if (!sentence) return false;
      setAskErr(null);
      const qid = ui.reasking ?? question?.id;
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
      if (qid === 'describe') {
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
      if (qid === 'name') {
        if (d) void s.update({ name: sentence.slice(0, 60) });
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
    [ui.reasking, question?.id, canDraw, setSetup, describe, d, s, view],
  );

  const onEdit = useCallback(
    (turnId: string) => {
      const effect = editEffect(turnId, !!d);
      if (turnId === 'name') {
        setText(d?.name ?? '');
        setUi((u) => ({ ...u, reasking: 'name' }));
        return;
      }
      if (effect === 'plain') {
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
    [d, setup.description, setSetup],
  );

  const composerBase = composerFor(question, d, view);
  const scope =
    d && identityLocked(d) && !question?.id.match(/^(name|describe)$/)
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
    keepPrevious: slot && slot.status === 'approved' && slot.prior && !drawingNow ? () => void s.revert(view) : null,
    surface: {
      title: 'Create presenter',
      turns,
      busy: s.busy || busySetup,
      stage: d
        ? {
            hash: shownHash,
            alt: `${VIEW_LABEL[view]}${slot?.status === 'candidate' ? ', candidate' : ''}`,
            drawing: drawingNow,
            since: d.updatedAt,
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
      composer: composerBase
        ? {
            ...composerBase,
            scope,
            hint: askErr ? null : undefined,
            error: askErr ?? saveErr,
            disabled: s.busy || busySetup || booting,
            working: !!d && drawingNow && !(question?.id === 'name'),
            focusKey: question ? `${question.id}:${d?.id ?? 'setup'}` : undefined,
            onAttach: !d && question?.id === 'source' ? () => setSetup({ source: 'photos' }) : undefined,
          }
        : null,
      text,
      onText: setText,
      onSend,
      onAnswer,
      onEdit,
      onExpand: () => setUi((u) => ({ ...u, collapsed: false })),
      footnote: capsNote(
        !canDraw
          ? 'Saved from the photos you add.'
          : caps?.free
            ? 'Nothing billed through Scenri.'
            : 'Each view is a generation.',
      ),
      onPaste: !d ? (files: File[]) => void addFiles(files) : undefined,
    },
  };
}

export type CreationFlow = ReturnType<typeof useCreationFlow>;
export type { PresenterDraft };
