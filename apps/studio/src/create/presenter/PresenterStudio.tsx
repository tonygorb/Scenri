import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { ArrowsCounterClockwise, CaretLeft, Copy, X } from '@phosphor-icons/react';
import { Spinner } from '@radix-ui/themes';
import { api, thumbUrl, uploadImage, type PresenterDraft } from '../../api.js';
import { useAppData, useDialogParam } from '../../app/AppShell.js';
import { useBrand } from '../../app/BrandLayout.js';
import { useOpenSetup } from '../../app/dialogs.js';
import { Confirm } from '../../Confirm.js';
import { DialogSheet, SheetClose, SheetTitle } from '../../layout/DialogSheet.js';
import { ScenriLockup } from '../../layout/ScenriMark.js';
import type { FlowProps } from '../flow.js';
import { RefineComposer } from './RefineComposer.js';
import { DetailsFields, type Mode, ModeSwitch, SetupForm } from './StudioSetup.js';
import { StagePreview, StudioStage } from './StudioStage.js';
import {
  type Action,
  MAX_PHOTOS,
  NO_TRAITS,
  type Traits,
  VIEWS,
  VIEW_LABEL,
  castSentence,
  composerPlaceholder,
  whoHint,
  composerState,
  coverageLine,
  emptySlot,
  nextToDraw,
  phaseOf,
  railCopy,
  refineTarget,
  requestLine,
  resumable,
  saveBlocker,
  seedCategories,
  selectedView,
  stripItems,
  type StudioView,
  worthKeeping,
} from './presenterStudioRules.js';
import { usePresenterDraft } from './usePresenterDraft.js';

/**
 * The presenter studio, in the create dialog, laid out as the Figma frames
 * draw it.
 *
 * A wide stage on the left and a 500 rail on the right. Setup is a form:
 * two ways to start as tabs, then who they are, their age, their skin and
 * the sentence, or four photo places, then Create presenter. Then one
 * identity: the face, drawn and decided; then the front, left, back and
 * right views, each drawn from the approved views before it and decided in
 * turn, the strip under the stage keeping the count. The rail reads as a
 * transcript, You and Scenri, with no model ever asked for words: Scenri's
 * lines are the build's own status. A sentence in the composer changes the
 * person (the face is redrawn and the other views follow) or one view.
 *
 * The draft lives on the server. Closing keeps it and reopening resumes it;
 * Start over is the only way to throw it away. The host's discard-and-undo
 * toast is not used here, because closing is not discarding.
 *
 * On a phone the same pieces stack: head, stage, strip, transcript, and a
 * bottom that stays put with the composer and the one decision in it.
 */
const pointerKey = (brandId: string) => `scenri:presenter-draft:${brandId}`;
const readPointer = (brandId: string) => {
  try {
    return sessionStorage.getItem(pointerKey(brandId));
  } catch {
    return null;
  }
};
const writePointer = (brandId: string, id: string) => {
  try {
    sessionStorage.setItem(pointerKey(brandId), id);
  } catch {
    /* private mode */
  }
};
const clearPointer = (brandId: string) => {
  try {
    sessionStorage.removeItem(pointerKey(brandId));
  } catch {
    /* private mode */
  }
};

export function PresenterStudio({ onBack, onStarted, caps }: FlowProps) {
  const { brand } = useBrand();
  const { close } = useDialogParam('new');
  const openSetup = useOpenSetup();
  const [draftId, setDraftId] = useState<string | null>(null);
  const [resume, setResume] = useState<PresenterDraft | null>(null);
  const [boot, setBoot] = useState(true);
  const [mode, setMode] = useState<Mode>('scratch');
  const [name, setName] = useState('');
  const [traits, setTraits] = useState<Traits>(NO_TRAITS);
  const [direction, setDirection] = useState('');
  const [hashes, setHashes] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [attested, setAttested] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const canDraw = !!caps?.canGenerate;
  const engineOff = !!caps && !caps.canGenerate;

  useEffect(() => {
    let alive = true;
    const pointed = readPointer(brand.id);
    void api
      .presenterDrafts(brand.id)
      .then((r) => {
        if (!alive) return;
        const found = pointed ? r.drafts.find((d) => d.id === pointed) : undefined;
        if (found) {
          setDraftId(found.id);
          return;
        }
        if (pointed) clearPointer(brand.id);
        setResume(r.drafts.find((d) => resumable(d)) ?? null);
      })
      .catch(() => undefined)
      .finally(() => {
        if (alive) setBoot(false);
      });
    return () => {
      alive = false;
    };
  }, [brand.id]);

  const openDraft = useCallback(
    (id: string) => {
      writePointer(brand.id, id);
      setDraftId(id);
    },
    [brand.id],
  );

  const leaveDraft = useCallback((keepDirection?: string) => {
    setDraftId(null);
    setResume(null);
    if (keepDirection !== undefined) setDirection(keepDirection);
  }, []);

  const addFiles = useCallback(async (files: File[]) => {
    setErr(null);
    setUploading(true);
    try {
      for (const f of files) {
        const h = await uploadImage(f);
        setHashes((cur) => (cur.includes(h) || cur.length >= MAX_PHOTOS ? cur : [...cur, h]));
      }
    } catch (e: any) {
      setErr(String(e?.message ?? e));
    } finally {
      setUploading(false);
    }
  }, []);

  /** The sentence the engine gets: the traits lead it unless it already says them. */
  const sentence = (text: string) => castSentence(traits, text);

  const startScratch = async (text: string) => {
    if (!text.trim()) {
      setErr('Describe the presenter, then create them.');
      return false;
    }
    if (!canDraw || busy) return false;
    setBusy(true);
    setErr(null);
    try {
      const draft = await api.createPresenterDraft(brand.id, {
        source: 'synthetic',
        direction: sentence(text),
        name: name.trim() || undefined,
      });
      openDraft(draft.id);
    } catch (e: any) {
      setErr(String(e?.message ?? e));
    } finally {
      setBusy(false);
    }
    return true;
  };

  const startPhotos = async (text: string) => {
    if (!hashes.length || !attested || busy) return false;
    setBusy(true);
    setErr(null);
    try {
      const draft = await api.createPresenterDraft(brand.id, {
        source: 'photos',
        imageHashes: hashes,
        attestation: true,
        name: name.trim() || undefined,
        // what matters in these photographs, handed to the analyzer as it reads them
        direction: text.trim() || undefined,
      });
      openDraft(draft.id);
    } catch (e: any) {
      setErr(String(e?.message ?? e));
    } finally {
      setBusy(false);
    }
    return true;
  };

  // The pill's own emptiness covers the missing sentence; this is everything else.
  const primaryOff =
    mode === 'scratch' ? busy || boot || !caps : !hashes.length || !attested || busy || boot || uploading;
  // Why it cannot be pressed, said under the card rather than hidden in a tooltip.
  const blocked =
    mode === 'photos'
      ? !hashes.length
        ? 'Add a photo of them first.'
        : !attested
          ? 'Confirm you have permission to use their likeness.'
          : null
      : null;

  return (
    <DialogSheet
      className="sc-pstudio"
      onDismiss={close}
      onPaste={(e) => {
        if (draftId || mode !== 'photos') return;
        const files = Array.from(e.clipboardData?.files ?? []).filter((f) => f.type.startsWith('image/'));
        if (!files.length) return;
        e.preventDefault();
        void addFiles(files);
      }}
    >
      <div className="sc-pstudio-grid" data-phase={draftId ? undefined : 'setup'}>
        {/* the close sits on the stage, top left, as the frame has it; the head's own close is the phone's */}
        <SheetClose>
          <button type="button" className="sc-pstudio-close" aria-label="Close">
            <X size={13} />
          </button>
        </SheetClose>
        {draftId ? (
          <Draft
            key={draftId}
            draftId={draftId}
            canDraw={canDraw}
            onBack={onBack}
            onStarted={onStarted}
            onGone={() => {
              clearPointer(brand.id);
              leaveDraft();
            }}
            onReset={(dir) => leaveDraft(dir)}
          />
        ) : (
          <>
            <Head onBack={onBack} />
            <div className="sc-pstudio-tabs">
              <ModeSwitch
                mode={mode}
                onMode={(next) => {
                  setErr(null);
                  setMode(next);
                }}
              />
            </div>
            <div className="sc-pstudio-scroll">
              {mode === 'photos' && hashes.length ? (
                <StudioStage hash={hashes[0]} alt="The first one you added" drawing={false} now={0} items={[]} />
              ) : (
                <StagePreview views={VIEWS.map((v) => ({ view: v, label: VIEW_LABEL[v] }))} />
              )}
              <div className="sc-pstudio-body">
                {resume && !boot && (
                  <button type="button" className="sc-pstudio-resume" onClick={() => openDraft(resume.id)}>
                    <ResumeFace draft={resume} />
                    <span>
                      Continue with the person you started
                      <small>
                        {resume.name.trim()
                          ? resume.name
                          : resume.source === 'synthetic'
                            ? 'from your description'
                            : 'from your photos'}
                      </small>
                    </span>
                  </button>
                )}
                <SetupForm
                  mode={mode}
                  canDraw={canDraw}
                  engineOff={engineOff}
                  name={name}
                  onName={setName}
                  traits={traits}
                  onTraits={(patch) => setTraits((t) => ({ ...t, ...patch }))}
                  hashes={hashes}
                  uploading={uploading}
                  attested={attested}
                  onAdd={(files) => void addFiles(files)}
                  onRemove={(h) => setHashes((cur) => cur.filter((x) => x !== h))}
                  onReject={() => setErr('Drop an image file.')}
                  onAttested={setAttested}
                  onSetup={() => openSetup()}
                  error={err}
                />
              </div>
            </div>
            <div className="sc-pstudio-foot">
              {!(mode === 'scratch' && engineOff) && (
                <RefineComposer
                  label={mode === 'photos' ? 'What matters in these photos' : 'Describe the presenter'}
                  placeholder={mode === 'photos' ? 'What matters in these photos' : 'Describe the presenter'}
                  action={mode === 'photos' && !canDraw ? 'Save' : 'Create'}
                  hint={blocked ?? (mode === 'photos' ? null : whoHint(traits, direction))}
                  value={direction}
                  onValue={(next) => {
                    setErr(null);
                    setDirection(next);
                  }}
                  allowEmpty={mode === 'photos'}
                  disabled={primaryOff}
                  working={busy}
                  error={err}
                  onSend={(text) => {
                    void (mode === 'scratch' ? startScratch(text) : startPhotos(text));
                    return false;
                  }}
                />
              )}
            </div>
          </>
        )}
      </div>
    </DialogSheet>
  );
}

function ResumeFace({ draft }: { draft: PresenterDraft }) {
  const face = VIEWS.map((v) => draft.views[v].hash).find(Boolean) ?? draft.sources?.[0];
  return face ? <img src={thumbUrl(face, 'micro')} alt="" /> : <span className="sc-pstudio-resume-blank" />;
}

/** The title is the Figma's: Create presenter until the set is complete, Refine presenter after. */
function Head({
  onBack,
  title = 'Create presenter',
  children,
}: {
  onBack?: () => void;
  title?: string;
  children?: ReactNode;
}) {
  return (
    <div className="sc-pstudio-head sc-newdlg-head">
      {onBack && (
        <button type="button" className="sc-newdlg-back" onClick={onBack} aria-label="Back">
          <CaretLeft size={15} />
        </button>
      )}
      <SheetTitle className="sc-newdlg-title">{title}</SheetTitle>
      {children}
      <SheetClose>
        <button type="button" className="sc-set-close sc-newdlg-close" aria-label="Close">
          <X size={16} />
        </button>
      </SheetClose>
    </div>
  );
}

const ACTION_LABEL: Record<Action, string> = {
  'try-again': 'Try again',
  'use-person': 'Use this person',
  use: 'Use',
  'keep-previous': 'Keep previous',
  retry: 'Retry',
  save: 'Save presenter',
};
const PRIMARY: ReadonlySet<Action> = new Set(['use-person', 'use', 'retry', 'save']);

/** A draft on the stage: the face, the build, the review, all one composition. */
function Draft({
  draftId,
  canDraw,
  onBack,
  onStarted,
  onGone,
  onReset,
}: {
  draftId: string;
  canDraw: boolean;
  onBack?: () => void;
  onStarted: FlowProps['onStarted'];
  onGone: () => void;
  onReset: (direction: string) => void;
}) {
  const { brand } = useBrand();
  const { presenterCategories } = useAppData();
  const s = usePresenterDraft(brand.id, draftId);
  const d = s.draft;
  const [focus, setFocus] = useState<StudioView | null>(null);
  const [name, setName] = useState('');
  const [facets, setFacets] = useState<string[]>([]);
  const [details, setDetails] = useState(false);
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [askErr, setAskErr] = useState<string | null>(null);
  const [discarding, setDiscarding] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const seeded = useRef(false);
  const catsSeeded = useRef(false);
  const started = useRef('');
  const nameTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    if (!d || seeded.current) return;
    seeded.current = true;
    setName(d.name);
    setFacets(d.facets);
  }, [d]);

  // The engine's own reading fills the line the first time it lands, so what
  // the user meets is an answer to correct rather than an empty field. It is
  // held here and not written to the draft: an untouched line stays the
  // server's fallback, which is the same words.
  useEffect(() => {
    if (catsSeeded.current || !d) return;
    const read = seedCategories(d, facets);
    if (!read) return;
    catsSeeded.current = true;
    setFacets(read);
  }, [d, facets]);

  useEffect(() => {
    if (s.gone) onGone();
  }, [s.gone, onGone]);

  useEffect(() => {
    if (!s.drawing) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [s.drawing]);

  // The next view is drawn with no click: an approval is the only decision
  // between one generation and the next. A stale view is drawn again the
  // same way, because the change that staled it was already decided.
  useEffect(() => {
    if (!d || s.busy || !canDraw || s.err) return;
    const view = nextToDraw(d);
    if (!view) return;
    const key = `${view}:${d.views[view].attempts}:${d.generations}:${d.views[view].status}`;
    if (started.current === key) return;
    started.current = key;
    void s.generate(view);
  }, [d, s.busy, s.generate, canDraw, s.err]);

  const view: StudioView = d ? selectedView(d, focus) : 'portrait';
  const slot = d ? d.views[view] : emptySlot();
  const phase = d ? phaseOf(d, canDraw) : 'identity';
  const isDrawing = !!d && (d.activeView === view || d.stage === 'analyzing');
  // A request that never reached the engine is said the same way a failed
  // draw is: on the stage, with Retry, and nothing approved touched.
  const copy = !d
    ? null
    : s.err && !isDrawing
      ? { status: `${s.err}. Nothing approved was touched.`, tone: 'alert' as const, actions: ['retry' as Action] }
      : railCopy(d, view, canDraw);

  // The words are asked for once the person stands, unless they were given at the start.
  useEffect(() => {
    if (phase === 'review' && !name.trim()) setDetails(true);
  }, [phase, name]);

  const act = useCallback(
    (a: Action) => {
      if (!d) return;
      switch (a) {
        case 'try-again':
        case 'retry':
          void s.generate(view);
          return;
        case 'use-person':
        case 'use':
          void s.approve(view);
          setFocus(null);
          return;
        case 'keep-previous':
          void s.revert(view);
          return;
        case 'save':
          return;
      }
    },
    [d, s, view],
  );

  // Enter decides the candidate on the stage when no field has the keyboard.
  useEffect(() => {
    if (!d || !copy) return;
    const decide = copy.actions.find((a) => a === 'use' || a === 'use-person');
    if (!decide || isDrawing || s.busy) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Enter' || e.shiftKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      e.preventDefault();
      act(decide);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [d, copy, isDrawing, s.busy, act]);

  const setNameLater = (next: string) => {
    setName(next);
    if (nameTimer.current) clearTimeout(nameTimer.current);
    nameTimer.current = setTimeout(() => void s.update({ name: next }), 500);
  };

  const save = async () => {
    if (!d) return;
    const blocker = saveBlocker(d, name, canDraw);
    if (blocker || saving) return;
    setSaving(true);
    setSaveErr(null);
    try {
      if (nameTimer.current) clearTimeout(nameTimer.current);
      await api.updatePresenterDraft(brand.id, d.id, { name, facets });
      const r = await api.savePresenterDraft(brand.id, d.id);
      clearPointer(brand.id);
      onStarted({ kind: 'presenter', id: r.presenter.id, name: r.presenter.name });
    } catch (e: any) {
      setSaving(false);
      setSaveErr(String(e?.message ?? e));
    }
  };

  const startOver = async () => {
    setDiscarding(true);
    try {
      await api.deletePresenterDraft(brand.id, draftId);
      clearPointer(brand.id);
      onReset(d?.direction ?? '');
    } catch {
      setDiscarding(false);
    }
  };

  const ask = (text: string) => {
    if (!d) return false;
    const target = refineTarget(text, view, d);
    if ('blocked' in target) {
      setAskErr(target.blocked);
      return false;
    }
    setAskErr(null);
    setFocus(target.view);
    void s.generate(target.view, text.trim());
    return true;
  };

  const copyStatus = async () => {
    if (!copy) return;
    try {
      await navigator.clipboard.writeText(copy.status);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* the clipboard is closed to this page */
    }
  };

  if (!d) {
    return (
      <>
        <Head onBack={onBack} />
        <div className="sc-pstudio-scroll">
          <div className="sc-pstudio-stage">
            <div className="sc-pstudio-wrap">
              <div className="sc-pstudio-well sc-shimmer" aria-hidden />
            </div>
          </div>
          <div className="sc-pstudio-body" />
        </div>
        <div className="sc-pstudio-foot"></div>
      </>
    );
  }

  const stageHash = slot.hash ?? (d.stage === 'analyzing' ? d.sources[0] : undefined);
  const face = d.views.portrait.hash ?? d.sources[0];
  const blocker = saveBlocker(d, name, canDraw);
  const coverage = coverageLine(d, canDraw);
  const composerOn = canDraw && (d.views.portrait.hash || d.views.portrait.status !== 'empty');
  const errorLine = saveErr ?? s.err;
  const canRedraw = !!copy && !isDrawing && !s.busy && copy.actions.some((a) => a === 'try-again' || a === 'retry');

  return (
    <>
      <Head onBack={onBack} title={phase === 'review' ? 'Refine presenter' : 'Create presenter'}>
        {worthKeeping(d) ? (
          <Confirm
            label="Start over"
            tone="quiet"
            title="Start over?"
            body="The views drawn so far are thrown away. Nothing was saved to the library."
            busy={discarding}
            onConfirm={() => void startOver()}
          />
        ) : (
          <button type="button" className="sc-btn sc-btn-ghost" disabled={discarding} onClick={() => void startOver()}>
            Start over
          </button>
        )}
      </Head>
      <div className="sc-pstudio-scroll">
        <StudioStage
          hash={stageHash}
          alt={`${VIEW_LABEL[view]}${slot.status === 'approved' ? ', approved' : slot.status === 'candidate' ? ', candidate' : ''}`}
          drawing={isDrawing}
          since={d.updatedAt}
          now={now}
          items={stripItems(d, view)}
          onPick={(v) => setFocus(v === (drawingView(d) ?? null) ? null : v)}
        />
        <div className="sc-pstudio-body" data-end>
          <div className="sc-pstudio-chat">
            <div className="sc-pstudio-msg" data-role="you">
              <span className="sc-pstudio-msg-who">You</span>
              <div className="sc-pstudio-bubble">
                <p>{requestLine(d)}</p>
                {d.source === 'photos' && d.sources.length > 0 && (
                  <div className="sc-pstudio-bubble-photos">
                    {d.sources.map((h, i) => (
                      <img key={h} src={thumbUrl(h, 'micro')} alt={`Yours, ${i + 1} of ${d.sources.length}`} />
                    ))}
                  </div>
                )}
              </div>
            </div>
            <div className="sc-pstudio-msg" data-role="scenri">
              <span className="sc-pstudio-msg-who">
                <ScenriLockup className="sc-pstudio-msg-mark" aria-hidden />
              </span>
              {coverage && (
                <p className="sc-pstudio-line" data-tone={coverage.tone}>
                  {coverage.text}
                </p>
              )}
              <p className="sc-pstudio-status" role="status" aria-live="polite" data-tone={copy?.tone}>
                {copy?.status}
              </p>
              {errorLine && (
                <p className="sc-newdlg-err" role="alert">
                  {errorLine}
                </p>
              )}
              <div className="sc-pstudio-msg-tools">
                <button
                  type="button"
                  className="sc-pstudio-tool"
                  aria-label={copied ? 'Copied' : 'Copy'}
                  title={copied ? 'Copied' : 'Copy'}
                  onClick={() => void copyStatus()}
                >
                  <Copy size={20} />
                </button>
                <button
                  type="button"
                  className="sc-pstudio-tool"
                  aria-label="Draw again"
                  title="Draw again"
                  disabled={!canRedraw}
                  onClick={() => act('try-again')}
                >
                  <ArrowsCounterClockwise size={20} />
                </button>
              </div>
            </div>
            {details && (
              <DetailsFields
                name={name}
                onName={setNameLater}
                facets={facets}
                onFacets={(next) => {
                  setFacets(next);
                  void s.update({ facets: next });
                }}
                categories={presenterCategories}
                onEnter={() => void save()}
              />
            )}
          </div>
        </div>
      </div>
      <div className="sc-pstudio-foot">
        {composerOn && (
          <div className="sc-pstudio-dock">
            <div className="sc-pstudio-who">
              <span className="sc-pstudio-who-chip">
                {face ? <img src={thumbUrl(face, 'micro')} alt="" /> : <span className="sc-pstudio-who-blank" />}
                {name.trim() || 'Unnamed'}
              </span>
              <button
                type="button"
                className="sc-btn sc-btn-ghost"
                aria-expanded={details}
                aria-controls="sc-pstudio-details"
                onClick={() => setDetails((v) => !v)}
              >
                {details ? 'Done' : 'Change'}
              </button>
            </div>
            <RefineComposer
              label="What should change"
              placeholder={composerPlaceholder(view, d)}
              describe={(text) => {
                const st = composerState(text, view, d);
                return { ...st, hash: st.chip ? d.views[st.chip.view].hash : undefined };
              }}
              disabled={s.busy}
              working={isDrawing}
              error={askErr}
              onSend={ask}
            />
          </div>
        )}
        {copy && copy.actions.length > 0 && (
          <div className="sc-pstudio-actions">
            {copy.actions.map((a) =>
              a === 'save' ? (
                <button
                  key={a}
                  type="button"
                  className="sc-btn sc-btn-primary"
                  aria-disabled={!!blocker || saving || undefined}
                  title={blocker ?? undefined}
                  onClick={() => void save()}
                >
                  {saving ? <Spinner size="1" /> : null}
                  {ACTION_LABEL[a]}
                </button>
              ) : (
                <button
                  key={a}
                  type="button"
                  className={`sc-btn ${PRIMARY.has(a) ? 'sc-btn-primary' : 'sc-btn-ghost'}`}
                  disabled={s.busy || isDrawing}
                  onClick={() => act(a)}
                >
                  {ACTION_LABEL[a]}
                </button>
              ),
            )}
          </div>
        )}
      </div>
    </>
  );
}

const drawingView = (d: PresenterDraft): StudioView | null => (d.activeView as StudioView | null) ?? null;
