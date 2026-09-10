import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, thumbUrl } from '../../api.js';
import { useAppData } from '../../app/AppShell.js';
import { useBrand } from '../../app/BrandLayout.js';
import { useOpenSetup } from '../../app/dialogs.js';
import { type Answer, answersNothing, nowIso } from '../../conversation/question.js';
import { forgetSaid } from '../../conversation/Transcript.js';
import type { FlowProps } from '../flow.js';
import { activeQuestion } from './presenterFlowRules.js';
import {
  EMPTY_EDIT_UI,
  editAsideReply,
  OUT_OF_SCOPE_LINE,
  PROMPT_EDIT,
  type EditBase,
  type EditUi,
  editComposerState,
  editIntent,
  isDirty,
  turnsForEdit,
} from './presenterEditRules.js';
import {
  autoFor,
  doingLine,
  nextToDraw,
  readsAsPerson,
  selectedView,
  stripItems,
  takesOf,
  type StudioView,
  VIEW_LABEL,
  VIEW_NAME,
} from './presenterStudioRules.js';
import { usePresenterDraft } from './usePresenterDraft.js';

/**
 * The editing flow: a saved presenter opened as a session seeded from its
 * record. Accepted candidates change the session; the record changes only on
 * Save changes, as a new revision when a picture or the person changed and
 * in place when only words did. Nothing in the library, a picker or a chip
 * sees the session until then.
 */
export interface EditingFlowArgs extends Pick<FlowProps, 'caps' | 'capsNote'> {
  presenterId: string;
  /** Leave the editor for a presenter's page: the one edited, or the head a save produced. */
  onLeave: (presenterId: string) => void;
}

export function useEditingFlow({ presenterId, onLeave, caps, capsNote }: EditingFlowArgs) {
  const { brand } = useBrand();
  const { applyBrand } = useAppData();
  const openSetup = useOpenSetup();
  const canDraw = !!caps?.canGenerate;

  const [draftId, setDraftId] = useState<string | null>(null);
  const [openErr, setOpenErr] = useState<string | null>(null);
  const [ui, setUi] = useState<EditUi>(EMPTY_EDIT_UI);
  const [text, setText] = useState('');
  const [focus, setFocus] = useState<StudioView | null>(null);
  const [compare, setCompare] = useState(false);
  const [askErr, setAskErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const started = useRef('');

  // The record, raw, for the session's base and the words on the page.
  const record = ((brand.json?.characters ?? []) as any[]).find((c) => c.id === presenterId) as
    | {
        id: string;
        name: string;
        shots?: { file: string; angle?: string }[];
        identityEdits?: string[];
        revisionOf?: string;
      }
    | undefined;
  const name = record?.name?.trim() || 'them';
  const base: EditBase | null = record
    ? { shots: record.shots ?? [], identityEdits: record.identityEdits ?? [] }
    : null;

  // Open: the session under way for this presenter, or a fresh one seeded from the record.
  useEffect(() => {
    let alive = true;
    setDraftId(null);
    setOpenErr(null);
    void api
      .editPresenter(brand.id, presenterId)
      .then((d) => {
        if (alive) setDraftId(d.id);
      })
      .catch((e: any) => {
        if (alive) setOpenErr(String(e?.message ?? e));
      });
    return () => {
      alive = false;
    };
  }, [brand.id, presenterId]);

  const s = usePresenterDraft(brand.id, draftId);
  const d = s.draft;
  // one conversation per edit session, so a second visit to the same person
  // arrives line by line rather than already said
  const memoryKey = `presenter-edit:${brand.id}:${presenterId}:${d?.id ?? 'new'}`;
  const [resumed] = useState(!!s.draft);

  // Only a stale view, or a missing one once Build them was chosen, is drawn
  // without a click: opening the editor never spends a generation.
  useEffect(() => {
    if (!d || s.busy || !canDraw || s.err) return;
    const view = nextToDraw(d);
    if (!view) return;
    if (d.views[view].status === 'empty' && !ui.building) return;
    const key = `${view}:${d.views[view].attempts}:${d.generations}:${d.views[view].status}`;
    if (started.current === key) return;
    started.current = key;
    void s.generate(view, undefined, autoFor(view));
  }, [d, s.busy, s.generate, canDraw, s.err, ui.building]);

  const view: StudioView = d ? selectedView(d, focus) : 'portrait';
  const slot = d ? d.views[view] : null;
  const drawingNow = !!d && (d.activeView === view || d.stage === 'analyzing');
  // a picture is only put back while nothing is being drawn
  const idleNow = !!d && !d.activeView && d.stage === 'idle';
  const failed = s.err && d && !d.activeView ? s.err : null;

  const turns = useMemo(
    () => turnsForEdit({ draft: d, base, name, selected: view, canGenerate: canDraw, ui: { ...ui, failed } }),
    [d, base, name, view, canDraw, ui, failed],
  );
  const question = activeQuestion(turns);
  const dirty = !!d && !!base && isDirty(d, base);

  const leave = useCallback(
    (to: string) => {
      forgetSaid(memoryKey);
      onLeave(to);
    },
    [memoryKey, onLeave],
  );

  const save = useCallback(async () => {
    if (!d || saving) return;
    setSaving(true);
    setAskErr(null);
    try {
      const r = await api.savePresenterDraft(brand.id, d.id);
      // leave first: once the brand carries the new head, this route would
      // redirect the superseded id into a fresh editor before the move
      leave(r.presenter.id);
      applyBrand(r.brand);
    } catch (e: any) {
      setSaving(false);
      const msg = String(e?.message ?? e);
      if (/changed elsewhere|HTTP 409/i.test(msg)) setUi((u) => ({ ...u, conflict: msg }));
      else setAskErr(msg);
    }
  }, [d, saving, brand.id, applyBrand, leave]);

  const discard = useCallback(async () => {
    setLeaving(true);
    try {
      if (d) await api.deletePresenterDraft(brand.id, d.id);
    } catch {
      /* a session that is already gone is what we wanted */
    }
    leave(presenterId);
  }, [d, brand.id, presenterId, leave]);

  const revert = useCallback(async () => {
    setLeaving(true);
    try {
      const r = await api.revertPresenter(brand.id, presenterId);
      if (d) await api.deletePresenterDraft(brand.id, d.id).catch(() => undefined);
      leave(r.presenter.id);
      applyBrand(r.brand);
    } catch (e: any) {
      setLeaving(false);
      setAskErr(String(e?.message ?? e));
    }
  }, [brand.id, presenterId, d, applyBrand, leave]);

  const onAnswer = useCallback(
    (qid: string, a: Answer) => {
      setAskErr(null);
      if (!d) return;
      switch (qid) {
        case 'legacy':
          if (a.kind !== 'confirm') return;
          setUi((u) => ({ ...u, building: a.id === 'build', buildDeclined: a.id !== 'build' }));
          return;
        case 'scope': {
          if (a.kind !== 'choice') return;
          const sentence = ui.scopeAsk?.said ?? '';
          setUi((u) => ({ ...u, scopeAsk: null }));
          if (a.id === 'identity') void s.generate('portrait', sentence);
          else void s.generate(view, sentence, 'auto');
          setFocus(a.id === 'identity' ? 'portrait' : view);
          return;
        }
        case 'revision':
        case 'view-revision': {
          if (a.kind !== 'confirm') return;
          const v = (Object.keys(d.views) as StudioView[]).find((x) => d.views[x].status === 'candidate') ?? view;
          if (a.id === 'use') void s.approve(v);
          if (a.id === 'keep') void s.revert(v);
          if (a.id === 'again') void s.generate(v, d.views[v].adjustment, autoFor(v));
          setCompare(false);
          return;
        }
        case 'retry': {
          if (s.err) {
            s.clearErr();
            started.current = '';
            return;
          }
          const failedView = (Object.keys(d.views) as StudioView[]).find((x) => !!d.views[x].error);
          if (failedView) {
            // drawn again as it was asked for, not from scratch
            void s.generate(failedView, d.views[failedView].adjustment, autoFor(failedView));
          }
          return;
        }
        case 'conflict':
          window.location.reload();
          return;
        case 'save':
          void save();
          return;
      }
    },
    [d, ui.scopeAsk, s, view, save],
  );

  const onSend = useCallback(
    (raw: string): boolean => {
      const sentence = raw.trim();
      if (!sentence || !d) return false;
      setAskErr(null);
      const q = question?.id ?? null;
      const at = nowIso();
      // What answered nothing stays in the conversation where it was said.
      const said = (u: EditUi, reply: string): EditUi => ({
        ...u,
        asides: [...(u.asides ?? []), { said: sentence, reply, q, at }],
      });
      // A sentence that read both ways waits for its answer; a new sentence leaves it in the record as asked.
      const leaveScope = (u: EditUi): EditUi =>
        u.scopeAsk
          ? {
              ...u,
              scopeAsk: null,
              asides: [
                ...(u.asides ?? []),
                { said: u.scopeAsk.said, reply: PROMPT_EDIT.scope, q: 'scope', at: u.scopeAsk.at },
              ],
            }
          : u;
      const kind = answersNothing(sentence, readsAsPerson);
      if (kind && kind !== 'vague') {
        setUi((u) =>
          said(
            u,
            editAsideReply(
              kind,
              name,
              (u.asides ?? []).some((a) => a.q === q),
            ),
          ),
        );
        setText('');
        return true;
      }
      if (!canDraw) {
        setAskErr('Image generation is not set up, so nothing can be redrawn yet.');
        return false;
      }
      const i = editIntent(sentence, view, d);
      if ('blocked' in i) {
        setAskErr(i.blocked);
        return false;
      }
      if (i.scope === 'out-of-scope') {
        setUi((u) => said(leaveScope(u), OUT_OF_SCOPE_LINE(name)));
        setText('');
        return true;
      }
      if (i.scope === 'ambiguous') {
        setUi((u) => ({ ...leaveScope(u), scopeAsk: { said: sentence, at } }));
        setText('');
        return true;
      }
      setUi((u) => leaveScope(u));
      setFocus(i.view);
      setCompare(false);
      void s.generate(i.view, sentence, i.scope === 'view' ? autoFor(i.view) : undefined);
      setText('');
      return true;
    },
    [d, canDraw, view, s, question?.id, name],
  );

  const scopeState = d ? editComposerState(text, view, d, name) : null;
  const scope = scopeState
    ? {
        chip: scopeState.chip
          ? {
              label: scopeState.chip.label,
              thumb: d?.views[scopeState.chip.view].hash
                ? thumbUrl(d.views[scopeState.chip.view].hash as string, 'micro')
                : undefined,
            }
          : null,
        hint: scopeState.hint,
        tone: scopeState.tone,
      }
    : null;
  const stageHash = compare && slot?.prior ? slot.prior : slot?.hash;
  // The composer is always there once the session is open. While a sentence
  // cannot be the answer it is off, with the reason under the card.
  const off = !d
    ? null
    : question?.id === 'legacy'
      ? 'Decide above.'
      : question?.id === 'conflict'
        ? 'Reload to continue.'
        : question?.id === 'scope'
          ? 'Pick above.'
          : question?.id === 'retry'
            ? 'Retry above.'
            : d.stage === 'analyzing'
              ? 'Reading the photos.'
              : // the stage says what is being drawn; the composer does not say it again
                d.activeView
                ? ''
                : null;
  const composerOn = !!d;

  return {
    d,
    record,
    name,
    view,
    slot,
    dirty,
    saving,
    leaving,
    openErr,
    canRevert: !!record?.revisionOf,
    discard,
    revert,
    keepPrevious:
      slot && slot.status === 'approved' && slot.prior && !drawingNow && !d?.activeView && d?.stage === 'idle'
        ? () => void s.revert(view)
        : null,
    surface: {
      title: 'Edit presenter',
      memoryKey,
      // an edit session is resumed whenever a draft for this person was already open
      resumed,
      turns,
      busy: s.busy || saving || leaving,
      stage: d
        ? {
            hash: stageHash,
            alt: `${VIEW_LABEL[view]}${slot?.status === 'candidate' ? ', candidate' : ''}`,
            drawing: drawingNow,
            since: d.updatedAt,
            doing: doingLine(d),
            takes: takesOf(d, view),
            onTake: idleNow ? (hash: string) => void s.restore(view, hash) : undefined,
            items: stripItems(d, view),
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
      composer: composerOn
        ? {
            placeholder:
              view === 'portrait' ? `What should change about ${name}?` : `Change this view: ${VIEW_NAME[view]}`,
            label: 'What should change',
            action: 'Refine',
            scope: off ? null : scope,
            hint: null,
            why: off ?? undefined,
            error: askErr,
            disabled: s.busy || saving || leaving || !!off,
            working: !!d?.activeView,
            onStop: d?.activeView ? () => void s.stop() : undefined,
            focusKey: `${question?.id ?? 'open'}:${d?.id ?? ''}`,
          }
        : null,
      text,
      onText: setText,
      onSend,
      onAnswer,
      onRestore: (view: string, hash: string) => void s.restore(view as StudioView, hash),
      footnote: capsNote(''),
    },
    setupNeeded: !canDraw ? openSetup : null,
  };
}

export type EditingFlow = ReturnType<typeof useEditingFlow>;
