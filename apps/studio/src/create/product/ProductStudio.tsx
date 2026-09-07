import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { CaretLeft, Cube, Warning, X } from '@phosphor-icons/react';
import { Spinner } from '@radix-ui/themes';
import { api, uploadImage } from '../../api.js';
import { useDialogParam } from '../../app/AppShell.js';
import { useBrand } from '../../app/BrandLayout.js';
import { CategoryPicker } from '../../layout/CategoryPicker.js';
import { DialogSheet, SheetClose, SheetTitle } from '../../layout/DialogSheet.js';
import { Dropzone } from '../../layout/Dropzone.js';
import type { FlowProps } from '../flow.js';
import { clearProductDraft, loadProductDraft, saveProductDraft } from './productDraft.js';
import { labelOf, StudioBoard } from './StudioBoard.js';
import {
  boardOf,
  canSave,
  coverHashOf,
  drawing,
  initialStudio,
  nextAngleOf,
  offerOf,
  reduce,
  type StudioState,
} from './studioState.js';

/**
 * Adding a product: show Scenri the product, confirm it, draw the views the
 * photographs leave uncovered, review, save.
 *
 * Not the presenter or scene form. Those are a picture being named and sent
 * to a build; this is a small capture studio. Photographs are facts and need
 * no approval. One read turns them into the identity sheet and a label per
 * photograph; from those the studio plans which views are worth drawing,
 * draws them one at a time in the same frame, and holds each for Keep or Try
 * again. Nothing exists in the library until Save, which is the one write
 * every product has always used, so the composer's chip insert is untouched.
 *
 * The state is a reducer with no React in it (studioState.ts) and the draft
 * survives a reload, a view mid-draw included (productDraft.ts). Closing is
 * an abandon with one Undo: the last attempt is held in memory for the toast,
 * and its drawn views leave the server when the next studio opens without it.
 */
let stash: { brandId: string; state: StudioState } | null = null;

const newDraftId = () => `d-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export function ProductStudio({ onBack, onStarted, caps, capsNote, restore, onDiscarded }: FlowProps) {
  const { brand } = useBrand();
  const { close } = useDialogParam('new');
  const [s, dispatch] = useReducer(reduce, brand.id, (id) => {
    if (restore && stash?.brandId === id) {
      const back = stash.state;
      stash = null;
      return back;
    }
    return loadProductDraft(id) ?? initialStudio(newDraftId());
  });
  const sRef = useRef(s);
  sRef.current = s;
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [importUrl, setImportUrl] = useState('');
  const [showSize, setShowSize] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const drawStart = useRef(Date.now());
  const readSeq = useRef(0);
  const savedRef = useRef(false);
  const discardedRef = useRef(onDiscarded);
  discardedRef.current = onDiscarded;

  // A stash nobody took back belongs to an attempt that is over: its drawn
  // views leave the server now, so a closed tab is the only way they linger.
  useEffect(() => {
    if (stash) {
      const gone = stash;
      stash = null;
      void api.abandonProductDraft(gone.brandId, gone.state.draftId).catch(() => {});
    }
  }, []);

  // The draft, kept as it changes: every change, at once. It is a few hundred
  // bytes, and a debounce here was measured losing the whole board to a
  // reload that came inside the beat after a photograph landed.
  useEffect(() => {
    if (!savedRef.current) saveProductDraft(brand.id, s);
  }, [s, brand.id]);

  // Closing is an abandon with one way back. A view mid-draw is stopped; the
  // attempt is held in memory for the toast's Undo, and the session draft is
  // cleared so the next opening starts clean.
  useEffect(
    () => () => {
      if (savedRef.current) return;
      const cur = sRef.current;
      if (!cur.photos.length) {
        clearProductDraft(brand.id);
        return;
      }
      if (drawing(cur) && cur.candidate) void api.cancelCandidate(brand.id, cur.candidate.jobId).catch(() => {});
      stash = { brandId: brand.id, state: cur };
      clearProductDraft(brand.id);
      discardedRef.current?.();
    },
    [brand.id],
  );

  /* ------------------------------------------------------------- photos */

  const addFiles = useCallback(
    async (files: File[]) => {
      setUploading(true);
      setErr(null);
      try {
        const added: string[] = [];
        for (const f of files.slice(0, 6)) added.push(await uploadImage(f));
        dispatch({ t: 'photosAdded', hashes: added });
      } catch (e: any) {
        setErr(String(e.message ?? e));
      } finally {
        setUploading(false);
      }
    },
    [dispatch],
  );

  /* --------------------------------------------------------------- read */

  // One read per photograph set, once the capability probe has answered. A
  // photograph without a label is what asks for it; a rehydrated draft that
  // already carries its labels is not read again.
  const photoKey = s.photos.map((p) => p.hash).join(',');
  useEffect(() => {
    const cur = sRef.current;
    if (!cur.photos.length || !caps) return;
    if (cur.kept.length || cur.candidate || cur.building) return;
    if (!cur.photos.some((p) => p.angle === null) && cur.reading !== 'idle' && cur.reading !== 'failed') return;
    const id = ++readSeq.current;
    const t = setTimeout(async () => {
      // the gate again, now: a draw may have started in the meantime
      const now = sRef.current;
      if (now.kept.length || now.candidate || now.building) return;
      dispatch({ t: 'readingStarted' });
      try {
        const r = await api.analyzeProduct(
          brand.id,
          sRef.current.photos.map((p) => p.hash),
          sRef.current.name.trim() || undefined,
        );
        if (readSeq.current !== id) return;
        dispatch({
          t: 'readingDone',
          available: r.available,
          reason: r.reason ?? null,
          sheet: r.sheet,
          angles: r.angles,
          conflict: r.conflict,
          coverage: r.coverage,
        });
      } catch (e: any) {
        if (readSeq.current === id) dispatch({ t: 'readingFailed', reason: String(e.message ?? e) });
      }
    }, 0);
    return () => clearTimeout(t);
  }, [photoKey, brand.id, !!caps]);

  /* --------------------------------------------------------- candidates */

  const startView = useCallback(
    async (angle: string, attempt = 1, correction: string | null = null) => {
      const cur = sRef.current;
      setErr(null);
      try {
        const { jobId } = await api.startCandidate(brand.id, {
          draftId: cur.draftId,
          angle,
          photoHashes: cur.photos.map((p) => p.hash),
          keptHashes: cur.kept.map((k) => k.hash),
          sheet: cur.sheet ? { ...cur.sheet } : null,
          correction,
          attempt,
        });
        drawStart.current = Date.now();
        dispatch({ t: 'candidateStarted', jobId, angle, attempt });
      } catch (e: any) {
        setErr(String(e.message ?? e));
      }
    },
    [brand.id],
  );

  const isDrawing = drawing(s);
  const jobId = s.candidate?.jobId ?? null;
  useEffect(() => {
    if (!jobId || !isDrawing) return;
    let alive = true;
    const tick = async () => {
      try {
        const r = await api.candidate(brand.id, jobId);
        if (!alive) return;
        dispatch({
          t: 'candidatePolled',
          candidate: { id: r.id, stage: r.stage, hash: r.hash, error: r.error, angle: r.angle, attempt: r.attempt },
        });
        if (r.stage === 'failed' || r.stage === 'cancelled') {
          setErr(r.stage === 'failed' ? (r.error ?? 'The view could not be drawn.') : null);
          dispatch({ t: 'candidateRejected' });
        }
      } catch (e: any) {
        if (!alive) return;
        // the registry is in memory: a restart between polls loses the job, never the photographs
        if (/not found/i.test(String(e?.message ?? ''))) dispatch({ t: 'candidateLost' });
      }
    };
    void tick();
    const iv = setInterval(tick, 1000);
    return () => {
      alive = false;
      clearInterval(iv);
    };
  }, [jobId, isDrawing, brand.id]);

  useEffect(() => {
    if (!isDrawing) return;
    const iv = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(iv);
  }, [isDrawing]);

  const keep = async () => {
    const c = sRef.current.candidate;
    if (!c?.hash) return;
    setErr(null);
    try {
      await api.keepCandidate(brand.id, c.jobId);
    } catch (e: any) {
      setErr(String(e.message ?? e));
      return;
    }
    dispatch({ t: 'candidateKept' });
    const cur = sRef.current;
    const next = cur.building
      ? nextAngleOf({ ...cur, kept: [...cur.kept, { hash: c.hash, angle: c.angle }], candidate: null })
      : null;
    if (next) void startView(next);
  };

  const tryAgain = async () => {
    const c = sRef.current.candidate;
    if (!c) return;
    setErr(null);
    try {
      await api.rejectCandidate(brand.id, c.jobId);
    } catch (e: any) {
      setErr(String(e.message ?? e));
      return;
    }
    dispatch({ t: 'candidateRejected' });
  };

  const drawAgain = () => {
    const cur = sRef.current;
    if (!cur.retrying) return;
    void startView(cur.retrying, (cur.candidate?.attempt ?? 1) + 1, cur.correction.trim() || null);
  };

  const skip = () => {
    const cur = sRef.current;
    if (!cur.retrying) return;
    const angle = cur.retrying;
    dispatch({ t: 'angleSkipped', angle });
    const next = nextAngleOf({ ...cur, retrying: null, skipped: [...cur.skipped, angle] });
    if (cur.building && next) void startView(next);
  };

  const cancelDraw = () => {
    const c = sRef.current.candidate;
    if (c) void api.cancelCandidate(brand.id, c.jobId).catch(() => {});
  };

  const build = () => {
    const next = nextAngleOf(sRef.current);
    if (!next) return;
    dispatch({ t: 'buildStarted' });
    void startView(next);
  };

  /* ---------------------------------------------------------------- save */

  const save = async () => {
    const cur = sRef.current;
    if (!canSave(cur) || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const name = cur.name.trim() || suggestedName(cur);
      const res = await api.createProduct(brand.id, {
        name,
        // an unlabelled photograph carries no angle: "other" is the reader's shrug, not a slot
        shots: boardOf(cur).map((b) => ({
          hash: b.hash,
          angle: b.angle && b.angle !== 'other' ? b.angle : undefined,
          source: b.source,
        })),
        category: cur.category ?? undefined,
        cover: coverHashOf(cur) ?? undefined,
        dimensions: cur.dimensions.trim() || undefined,
        sheet: cur.sheet ? { ...cur.sheet } : undefined,
        draftId: cur.draftId,
      });
      savedRef.current = true;
      clearProductDraft(brand.id);
      onStarted({ kind: 'product', id: res.productId, name });
    } catch (e: any) {
      setErr(String(e.message ?? e));
    } finally {
      setBusy(false);
    }
  };

  const startImport = async () => {
    const url = importUrl.trim() || (brand.json?.meta?.website ?? '');
    if (!url) return;
    setImporting(true);
    setErr(null);
    try {
      await api.catalogImport(brand.id, url);
      savedRef.current = true;
      clearProductDraft(brand.id);
      onStarted({ kind: 'product', id: '', name: url });
    } catch (e: any) {
      setErr(String(e.message ?? e));
    } finally {
      setImporting(false);
    }
  };

  /* --------------------------------------------------------------- words */

  const canDraw = !!caps?.canGenerate;
  const offer = canDraw ? offerOf(s) : 'none';
  const next = nextAngleOf(s);
  const candidateLabel = labelOf(s.candidate?.angle ?? s.retrying ?? next);
  const elapsed = clock(now - drawStart.current);
  const board = boardOf(s);
  const ready = canSave(s);
  const nPhotos = s.photos.length;

  const line = lineOf(s, { canDraw, offer, next, engineName: caps?.engineName ?? null });

  // The foot holds two verbs at most, and which two follows the moment:
  // a view being drawn, a view to decide on, a correction to make, or the
  // product to save. Never a step counter.
  let verbs: {
    primary: string;
    onPrimary: () => void;
    primaryReady: boolean;
    ghost?: { label: string; onClick: () => void };
  };
  if (isDrawing) {
    verbs = {
      primary: 'Drawing',
      onPrimary: () => {},
      primaryReady: false,
      ghost: { label: 'Stop', onClick: cancelDraw },
    };
  } else if (s.candidate?.stage === 'ready') {
    verbs = {
      primary: 'Keep',
      onPrimary: () => void keep(),
      primaryReady: true,
      ghost: { label: 'Try again', onClick: () => void tryAgain() },
    };
  } else if (s.retrying) {
    verbs = {
      primary: 'Draw again',
      onPrimary: drawAgain,
      primaryReady: true,
      ghost: { label: 'Skip this view', onClick: skip },
    };
  } else if (offer === 'recommended' && !s.kept.length) {
    verbs = {
      primary: 'Build views',
      onPrimary: build,
      primaryReady: true,
      ghost: { label: 'Save as is', onClick: () => void save() },
    };
  } else {
    verbs = {
      primary: 'Save product',
      onPrimary: () => void save(),
      primaryReady: ready,
      ...(offer !== 'none' && next ? { ghost: { label: `Draw the ${labelOf(next)} view`, onClick: build } } : {}),
    };
  }
  const footnote =
    isDrawing || s.candidate?.stage === 'ready' || s.retrying
      ? capsNote(`One view at a time, drawn from the photographs${caps?.engineName ? ` with ${caps.engineName}` : ''}.`)
      : verbs.primary === 'Build views'
        ? capsNote(
            `Draws ${plural(remainingViews(s), 'view')} one at a time. ${caps?.free ? 'Nothing billed through Scenri.' : 'Each view is one generation.'}`,
          )
        : 'Saved to this brand. Nothing generated.';

  return (
    <DialogSheet
      className="sc-pstudio"
      maxWidth="880px"
      onDismiss={close}
      onPaste={(e) => {
        const files = Array.from(e.clipboardData?.files ?? []).filter((f) => f.type.startsWith('image/'));
        if (!files.length) return;
        e.preventDefault();
        void addFiles(files);
      }}
    >
      <div className="sc-newdlg-head">
        {onBack && (
          <button type="button" className="sc-newdlg-back" onClick={onBack} aria-label="Back">
            <CaretLeft size={15} />
          </button>
        )}
        <SheetTitle className="sc-newdlg-title">New product</SheetTitle>
        <SheetClose>
          <button type="button" className="sc-set-close sc-newdlg-close" aria-label="Close">
            <X size={16} />
          </button>
        </SheetClose>
      </div>

      <div className="sc-newdlg-body">
        {nPhotos === 0 ? (
          <div className="sc-assetwell">
            <Dropzone
              label="Add product photos"
              hint="One is enough. More sides, of the same exact product, pin the shape."
              busy={uploading}
              onFiles={(files) => void addFiles(files)}
              onReject={() => setErr('Drop an image file.')}
            >
              <Cube size={22} />
            </Dropzone>
          </div>
        ) : (
          <StudioBoard
            board={board}
            selected={s.selected}
            candidate={s.candidate}
            candidateLabel={candidateLabel}
            elapsed={elapsed}
            cover={coverHashOf(s)}
            uploading={uploading}
            onSelect={(hash) => dispatch({ t: 'selected', hash })}
            onAdd={(files) => void addFiles(files)}
            onRemove={(hash) =>
              dispatch(
                board.find((b) => b.hash === hash)?.source === 'derived'
                  ? { t: 'viewRemoved', hash }
                  : { t: 'photoRemoved', hash },
              )
            }
            onCover={(hash) => dispatch({ t: 'coverChosen', hash })}
          />
        )}

        {line && (
          <p className="sc-pstudio-line" data-tone={line.tone} role="status" aria-live="polite">
            {line.tone === 'warn' ? <Warning size={14} weight="bold" /> : line.busy ? <Spinner size="1" /> : null}
            <span>
              {line.text}
              {line.small && <small>{line.small}</small>}
            </span>
          </p>
        )}

        {s.retrying && (
          <div className="sc-pstudio-fix">
            <label className="sc-newdlg-seclabel" htmlFor="sc-pstudio-fix">
              What is off? (optional)
            </label>
            <input
              id="sc-pstudio-fix"
              className="sc-in"
              type="text"
              placeholder="The cap is narrower. Keep the label exactly as photographed."
              value={s.correction}
              maxLength={200}
              onChange={(e) => dispatch({ t: 'correctionChanged', correction: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  drawAgain();
                }
              }}
            />
          </div>
        )}

        {nPhotos > 0 && !isDrawing && s.candidate?.stage !== 'ready' && !s.retrying && (
          <div className="sc-pstudio-review">
            <input
              className="sc-in"
              type="text"
              aria-label="Name"
              placeholder={s.sheet ? titleCase(s.sheet.promptName) : 'Name this product'}
              value={s.name}
              onChange={(e) => dispatch({ t: 'nameChanged', name: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && ready && !busy) {
                  e.preventDefault();
                  void save();
                }
              }}
            />
            <CategoryPicker value={s.category} onChange={(k) => dispatch({ t: 'categoryChanged', category: k })} />
            {showSize || s.dimensions ? (
              <input
                className="sc-in sc-pstudio-sizein"
                type="text"
                aria-label="Size"
                placeholder="Size, e.g. 30 ml, 95 mm tall"
                value={s.dimensions}
                onChange={(e) => dispatch({ t: 'dimensionsChanged', dimensions: e.target.value })}
              />
            ) : (
              <button type="button" className="sc-pstudio-size" onClick={() => setShowSize(true)}>
                Add size
              </button>
            )}
          </div>
        )}

        <div className="sc-newdlg-secondary">
          {showImport ? (
            <>
              <label className="sc-newdlg-seclabel" htmlFor="sc-import-url">
                Your store's address
              </label>
              <div className="sc-newdlg-secrow">
                <input
                  id="sc-import-url"
                  className="sc-in"
                  type="url"
                  placeholder={brand.json?.meta?.website ?? 'https://yourstore.com'}
                  value={importUrl}
                  onChange={(e) => setImportUrl(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void startImport();
                  }}
                />
                <button
                  type="button"
                  className="sc-btn sc-btn-ghost"
                  disabled={importing}
                  onClick={() => void startImport()}
                >
                  {importing ? 'Starting' : 'Import'}
                </button>
              </div>
            </>
          ) : (
            <button type="button" className="sc-newdlg-secmore" onClick={() => setShowImport(true)}>
              Import a catalog from a store URL
            </button>
          )}
        </div>
      </div>

      <div className="sc-newdlg-foot">
        {err && (
          <p className="sc-newdlg-err" role="alert">
            {err}
          </p>
        )}
        <div className="sc-pstudio-verbs">
          {verbs.ghost && (
            <button type="button" className="sc-btn sc-btn-ghost" onClick={verbs.ghost.onClick}>
              {verbs.ghost.label}
            </button>
          )}
          <button
            type="button"
            className="sc-btn sc-btn-primary sc-dlg-go"
            aria-disabled={!verbs.primaryReady || busy || undefined}
            title={nPhotos === 0 ? 'Add at least one photo' : undefined}
            onClick={() => {
              if (verbs.primaryReady && !busy) verbs.onPrimary();
            }}
          >
            {busy || isDrawing ? <Spinner size="1" /> : null}
            {verbs.primary}
          </button>
        </div>
        <p className="sc-dlg-foot">{footnote}</p>
      </div>
    </DialogSheet>
  );
}

/* ---------------------------------------------------------------- words */

function lineOf(
  s: StudioState,
  ctx: {
    canDraw: boolean;
    offer: 'recommended' | 'available' | 'none';
    next: string | null;
    engineName: string | null;
  },
): { text: string; small?: string; tone?: 'warn'; busy?: boolean } | null {
  const n = s.photos.length;
  if (!n) return null;
  if (s.reading === 'reading') return { text: 'Reading the photos', busy: true };
  if (drawing(s))
    return {
      text: `Drawing the ${labelOf(s.candidate?.angle)} view from the photographs.`,
      small: 'Shape and proportion only. The photographs stay the authority for colour, finish and every mark.',
    };
  if (s.candidate?.stage === 'ready')
    return { text: 'Keep it if the shape is right. Nothing in a drawn view outranks a photograph.' };
  if (s.retrying) return { text: `The ${labelOf(s.retrying)} view will be drawn again from the photographs.` };
  if (s.conflict)
    return {
      text: s.conflict,
      small: 'A product is one exact item. Remove the photograph that shows another.',
      tone: 'warn',
    };
  const what = `${n === 1 ? 'One photograph' : `${n} photographs`}${s.sheet ? ` of ${s.sheet.promptName.replace(/^an? /i, '')}` : ''}${s.kept.length ? `, ${plural(s.kept.length, 'drawn view')}` : ''}.`;
  // What the read established, then what can still be drawn. The two are
  // independent: a machine with no reader can still draw, and one with no
  // engine can still read.
  const read =
    s.reading === 'unavailable'
      ? ` ${s.readingReason ?? 'Nothing here can read them'}, so the photographs are the product as they are.`
      : s.reading === 'failed'
        ? ' They could not be read, so they are the product as they are.'
        : '';
  const offer = !ctx.canDraw
    ? ctx.next
      ? ' No engine here can draw a view.'
      : ''
    : ctx.offer === 'recommended'
      ? ` Scenri can draw ${listOf(remainingAngles(s))} to pin the shape.`
      : ctx.offer === 'available'
        ? ` ${listOf(remainingAngles(s), true)} could still be drawn.`
        : s.kept.length || n > 1
          ? ' The shape is covered.'
          : '';
  const small = s.reading === 'failed' ? (s.readingReason ?? undefined) : s.coverage[0];
  return { text: `${what}${read}${offer}`, small };
}

function remainingAngles(s: StudioState): string[] {
  const out: string[] = [];
  let cur = s;
  for (let i = 0; i < 3; i++) {
    const a = nextAngleOf(cur);
    if (!a) break;
    out.push(a);
    cur = { ...cur, kept: [...cur.kept, { hash: `pending-${i}`, angle: a }] };
  }
  return out;
}
const remainingViews = (s: StudioState) => remainingAngles(s).length;

function listOf(angles: string[], capital = false): string {
  const words = angles.map((a) => `a ${labelOf(a)} view`);
  const text = words.length <= 1 ? (words[0] ?? '') : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
  return capital ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

const plural = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`;

function clock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

function titleCase(s: string): string {
  return s.replace(/^a(n)? /i, '').replace(/\b\w/g, (c) => c.toUpperCase());
}

/** A name when the person left it blank: the read's noun phrase, else a plain word. */
function suggestedName(s: StudioState): string {
  const guess = s.sheet ? titleCase(s.sheet.promptName).slice(0, 40).trim() : '';
  return guess || 'Product';
}
