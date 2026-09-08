import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { ArrowRight, CaretLeft, X } from '@phosphor-icons/react';
import { Spinner } from '@radix-ui/themes';
import { api, thumbUrl, uploadImage, type PresenterDraft } from '../../api.js';
import { useAppData, useDialogParam } from '../../app/AppShell.js';
import { useBrand } from '../../app/BrandLayout.js';
import { useOpenSetup } from '../../app/dialogs.js';
import { Confirm } from '../../Confirm.js';
import { DialogSheet, SheetClose, SheetTitle } from '../../layout/DialogSheet.js';
import { VerticalsTabs } from '../../layout/VerticalsTabs.js';
import type { FlowProps } from '../flow.js';
import { RefineComposer } from './RefineComposer.js';
import { PhotosPanel, ReviewFields, ScratchPanel, SetupCard } from './StudioSetup.js';
import { StudioStage } from './StudioStage.js';
import {
  type Action,
  MAX_PHOTOS,
  VIEWS,
  VIEW_LABEL,
  composerPlaceholder,
  coverageLine,
  emptySlot,
  nextToDraw,
  phaseOf,
  railCopy,
  refineHint,
  refineTarget,
  resumable,
  saveBlocker,
  selectedView,
  stripItems,
  type StudioView,
  worthKeeping,
} from './presenterStudioRules.js';
import { usePresenterDraft } from './usePresenterDraft.js';

/**
 * The presenter studio, in the create dialog.
 *
 * A wide stage on the left and a narrow rail on the right. Two ways to
 * start, as tabs: a sentence, or one to four photos. Then one identity: the
 * face, drawn and decided; then the full body and the three-quarter view,
 * each drawn from the approved views before it and decided in turn. A
 * sentence in the composer changes the person (the face is redrawn and the
 * other views follow) or one view (that view alone). The name comes last.
 *
 * The draft lives on the server. Closing keeps it and reopening resumes it;
 * Start over is the only way to throw it away. The host's discard-and-undo
 * toast is not used here, because closing is not discarding.
 *
 * On a phone the same pieces stack: head, tabs, stage, strip, words, and a
 * bottom that stays put with the composer and the one decision in it.
 */
type Mode = 'scratch' | 'photos';

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

const MODES = [
  { value: 'scratch', label: 'From scratch' },
  { value: 'photos', label: 'From photos' },
];

export function PresenterStudio({ onBack, onStarted, caps, capsNote }: FlowProps) {
  const { brand } = useBrand();
  const { close } = useDialogParam('new');
  const openSetup = useOpenSetup();
  const [draftId, setDraftId] = useState<string | null>(null);
  const [resume, setResume] = useState<PresenterDraft | null>(null);
  const [boot, setBoot] = useState(true);
  const [mode, setMode] = useState<Mode>('scratch');
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

  const startScratch = async () => {
    if (!direction.trim()) {
      setErr('Describe the person, then create them.');
      return;
    }
    if (!canDraw || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const draft = await api.createPresenterDraft(brand.id, { source: 'synthetic', direction: direction.trim() });
      openDraft(draft.id);
    } catch (e: any) {
      setErr(String(e?.message ?? e));
    } finally {
      setBusy(false);
    }
  };

  const startPhotos = async () => {
    if (!hashes.length || !attested || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const draft = await api.createPresenterDraft(brand.id, {
        source: 'photos',
        imageHashes: hashes,
        attestation: true,
      });
      openDraft(draft.id);
    } catch (e: any) {
      setErr(String(e?.message ?? e));
    } finally {
      setBusy(false);
    }
  };

  const footnote = capsNote(
    engineOff
      ? 'Saved from the photos you add.'
      : caps?.free
        ? 'Three views, one at a time. Nothing billed through Scenri.'
        : 'Three views, one at a time, each a generation.',
  );

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
            footnote={footnote}
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
              <VerticalsTabs
                aria-label="How to start"
                activeKey={mode}
                items={MODES}
                onSelect={(v) => {
                  setErr(null);
                  setMode(v === 'photos' ? 'photos' : 'scratch');
                }}
              />
            </div>
            <div className="sc-pstudio-scroll">
              <StudioStage
                hash={mode === 'photos' ? hashes[0] : undefined}
                alt={mode === 'photos' && hashes.length ? 'The first one you added' : ''}
                drawing={false}
                now={0}
                items={[]}
              />
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
                {mode === 'scratch' ? (
                  engineOff ? (
                    <SetupCard onSetup={() => openSetup()} />
                  ) : (
                    <ScratchPanel
                      direction={direction}
                      onDirection={(next) => {
                        setErr(null);
                        setDirection(next);
                      }}
                      onCreate={() => void startScratch()}
                      error={err}
                    />
                  )
                ) : (
                  <PhotosPanel
                    hashes={hashes}
                    uploading={uploading}
                    attested={attested}
                    canDraw={canDraw}
                    error={err}
                    onAdd={(files) => void addFiles(files)}
                    onRemove={(h) => setHashes((cur) => cur.filter((x) => x !== h))}
                    onReject={() => setErr('Drop an image file.')}
                    onAttested={setAttested}
                  />
                )}
              </div>
            </div>
            <div className="sc-pstudio-foot">
              {mode === 'scratch' ? (
                !engineOff && (
                  <div className="sc-pstudio-actions">
                    <SheetClose>
                      <button type="button" className="sc-btn sc-btn-ghost">
                        Cancel
                      </button>
                    </SheetClose>
                    <button
                      type="button"
                      className="sc-btn sc-btn-primary"
                      aria-disabled={!direction.trim() || busy || boot || !caps || undefined}
                      title={!direction.trim() ? 'Describe the person' : undefined}
                      onClick={() => void startScratch()}
                    >
                      {busy ? <Spinner size="1" /> : null}
                      Create person
                      <ArrowRight size={18} />
                    </button>
                  </div>
                )
              ) : (
                <div className="sc-pstudio-actions">
                  <SheetClose>
                    <button type="button" className="sc-btn sc-btn-ghost">
                      Cancel
                    </button>
                  </SheetClose>
                  <button
                    type="button"
                    className="sc-btn sc-btn-primary"
                    aria-disabled={!hashes.length || !attested || busy || boot || uploading || undefined}
                    title={
                      !hashes.length
                        ? 'Add a photo'
                        : !attested
                          ? 'Confirm you have permission to use their likeness'
                          : undefined
                    }
                    onClick={() => void startPhotos()}
                  >
                    {busy ? <Spinner size="1" /> : null}
                    {canDraw ? 'Continue' : 'Save with photos'}
                    <ArrowRight size={18} />
                  </button>
                </div>
              )}
              <p className="sc-dlg-foot">{footnote}</p>
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

function Head({ onBack, children }: { onBack?: () => void; children?: ReactNode }) {
  return (
    <div className="sc-pstudio-head sc-newdlg-head">
      {onBack && (
        <button type="button" className="sc-newdlg-back" onClick={onBack} aria-label="Back">
          <CaretLeft size={15} />
        </button>
      )}
      <SheetTitle className="sc-newdlg-title">New presenter</SheetTitle>
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
  footnote,
  onBack,
  onStarted,
  onGone,
  onReset,
}: {
  draftId: string;
  canDraw: boolean;
  footnote: ReactNode;
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
  const [notes, setNotes] = useState('');
  const [details, setDetails] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [askErr, setAskErr] = useState<string | null>(null);
  const [discarding, setDiscarding] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const seeded = useRef(false);
  const started = useRef('');
  const nameTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    if (!d || seeded.current) return;
    seeded.current = true;
    setName(d.name);
    setFacets(d.facets);
  }, [d]);

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
      await api.updatePresenterDraft(brand.id, d.id, { name, facets, direction: notes.trim() || undefined });
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
        <div className="sc-pstudio-foot">
          <p className="sc-dlg-foot">{footnote}</p>
        </div>
      </>
    );
  }

  const stageHash = slot.hash ?? (d.stage === 'analyzing' ? d.sources[0] : undefined);
  const blocker = saveBlocker(d, name, canDraw);
  const coverage = coverageLine(d, canDraw);
  const composerOn = canDraw && (d.views.portrait.hash || d.views.portrait.status !== 'empty');
  const errorLine = saveErr ?? s.err;

  return (
    <>
      <Head onBack={onBack}>
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
        <div className="sc-pstudio-body" data-end={phase !== 'review' || undefined}>
          <div className="sc-pstudio-origin">
            <span className="sc-newdlg-seclabel">
              {d.source === 'photos' ? 'From your photos' : 'From your description'}
            </span>
            {d.source === 'photos' ? (
              <div className="sc-pstudio-origin-photos">
                {d.sources.map((h, i) => (
                  <img key={h} src={thumbUrl(h, 'micro')} alt={`Yours, ${i + 1} of ${d.sources.length}`} />
                ))}
              </div>
            ) : (
              <p>{d.direction}</p>
            )}
          </div>
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
          {phase === 'review' && (
            <ReviewFields
              name={name}
              onName={setNameLater}
              facets={facets}
              onFacets={(next) => {
                setFacets(next);
                void s.update({ facets: next });
              }}
              notes={notes}
              onNotes={setNotes}
              categories={presenterCategories}
              details={details}
              onDetails={setDetails}
              onEnter={() => void save()}
            />
          )}
        </div>
      </div>
      <div className="sc-pstudio-foot">
        {composerOn && (
          <RefineComposer
            placeholder={composerPlaceholder(view, d)}
            hint={refineHint(view, d)}
            disabled={s.busy}
            working={isDrawing}
            error={askErr}
            onSend={ask}
          />
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
        <p className="sc-dlg-foot">{footnote}</p>
      </div>
    </>
  );
}

const drawingView = (d: PresenterDraft): StudioView | null => (d.activeView as StudioView | null) ?? null;
