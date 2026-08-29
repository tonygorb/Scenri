import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useMatch, useNavigate } from 'react-router';
import { api, type AssetBuildCapabilities } from '../api.js';
import { useAppData, useDialogParam } from '../app/AppShell.js';
import { useBrand } from '../app/BrandLayout.js';
import { useTaskCenter } from '../app/TaskCenter.js';
import type { CreateKind, PendingState } from '../createDraft.js';
import { P, hubPath, productPath } from '../routes.js';
import { useToasts } from '../toasts.js';
import { AssetKindPicker } from './AssetKindPicker.js';
import { PresenterForm } from './PresenterForm.js';
import { ProductForm } from './ProductForm.js';
import { SceneForm } from './SceneForm.js';
import type { Created } from './flow.js';

/**
 * The one place any of the three creation flows is ever mounted.
 *
 * Which one is showing lives in the URL (`?new=`), on exactly the terms
 * SettingsDialog's `?settings=` already set: opening pushes an entry so Back
 * closes it, moving between the chooser and a flow replaces, and closing
 * consumes. So the top bar's +, a library page's button, a Home card and a
 * pasted link are all the same code path, and none of them owns a dialog.
 *
 * The one thing the URL cannot carry is a callback — the composer needs the id
 * of the product it just made so it can drop a chip into a brief that is still
 * in memory, and the Create rail needs to know so it can open the matching
 * shelf. That lives in a ref, is fired only for the kind that asked, and
 * deliberately does not survive a reload: the asset is still created, which
 * is the half that matters.
 */

const CHOOSER = '1';
/** What each flow is called in a sentence about what just happened. */
const LABEL: Record<CreateKind, string> = { product: 'Product', presenter: 'Presenter', scene: 'Scene' };
const KINDS = ['product', 'presenter', 'scene'] as const;
const isKind = (v: string | null): v is CreateKind => !!v && (KINDS as readonly string[]).includes(v);

interface CreateApi {
  open: (kind: CreateKind | 'choose', opts?: { onCreated?: (made: Created) => void }) => void;
}
const Ctx = createContext<CreateApi | null>(null);

/** Open a creation flow from anywhere, without a dialog of your own. */
export function useCreateAsset(): CreateApi['open'] {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useCreateAsset must be used inside AssetCreateHost');
  return ctx.open;
}

export function AssetCreateHost({ children }: { children: ReactNode }) {
  const { brand } = useBrand();
  const navigate = useNavigate();
  const { push } = useToasts();
  const { refresh: refreshBrands } = useAppData();
  const { builds, poke } = useTaskCenter();
  const param = useDialogParam('new');
  const value = param.value;

  // Where the launcher should put the keyboard, and what a bare + means here.
  const onProducts = !!useMatch({ path: P.products, end: false });
  const onPresenters = !!useMatch({ path: P.presenters, end: false });
  const onScenes = !!useMatch({ path: P.scenes, end: false });
  const here: CreateKind | null = onProducts ? 'product' : onPresenters ? 'presenter' : onScenes ? 'scene' : null;

  const [caps, setCaps] = useState<AssetBuildCapabilities | null>(null);
  const [capsFailed, setCapsFailed] = useState(false);
  // Whether a chooser is behind the open flow. Only then does a back arrow make
  // sense — one pointing at a screen you never saw implies history that is not there.
  const [cameFromChooser, setCameFromChooser] = useState(false);
  // Set only by Undo, so an ordinary opening can never arrive holding the last
  // attempt. Cleared as soon as the flow is gone.
  const [restore, setRestore] = useState(false);
  const createdRef = useRef<{ kind: CreateKind; fn: (made: Created) => void } | null>(null);
  /*
   * Who opened this, so focus can go back to them.
   *
   * Radix restores focus per Dialog.Content, and picking a row swaps one
   * Content for another — by the time the flow closes, the element Radix
   * remembered is a row that no longer exists, and focus lands on the body.
   * Recording the opener once, here, survives the swap.
   */
  const openerRef = useRef<HTMLElement | null>(null);

  const openParam = param.open;
  const setParam = param.set;
  const closeParam = param.close;

  const open = useCallback<CreateApi['open']>(
    (kind, opts) => {
      createdRef.current = kind === 'choose' || !opts?.onCreated ? null : { kind, fn: opts.onCreated };
      openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setCameFromChooser(kind === 'choose');
      setRestore(false);
      openParam(kind === 'choose' ? CHOOSER : kind);
    },
    [openParam],
  );

  const close = useCallback(() => {
    createdRef.current = null;
    setCameFromChooser(false);
    closeParam();
  }, [closeParam]);

  /**
   * Closing a creation ends it, so the way back is offered here rather than
   * bought with a confirm on every deliberate close.
   *
   * Only fires when there was something to lose — a name, a line, a photograph
   * — and never after a send, which keeps its own draft for Try again.
   */
  const onDiscarded = useCallback(
    (k: CreateKind) => {
      push({
        kind: 'success',
        title: `${LABEL[k]} discarded`,
        detail: 'Nothing was saved.',
        action: {
          label: 'Undo',
          onClick: () => {
            setRestore(true);
            setCameFromChooser(false);
            openParam(k);
          },
        },
      });
    },
    [openParam, push],
  );

  // The offer belongs to one closing. Once the flow is gone and the toast with
  // it, a later opening starts from nothing.
  useEffect(() => {
    if (value === null) setRestore(false);
  }, [value]);

  /*
   * Focus goes home once the dialog is actually gone — an effect rather than a
   * line inside close(), because close() runs while the dialog is still
   * mounted and Radix's own focus teardown would land on top of it.
   */
  useEffect(() => {
    if (value !== null) return;
    const opener = openerRef.current;
    openerRef.current = null;
    if (opener?.isConnected) opener.focus();
  }, [value]);

  // Asked once per opening, and retried once if the answer never came: a silent
  // null used to erase the whole cost line, so the dialog said nothing at all
  // about what pressing the button would spend.
  useEffect(() => {
    if (value === null) return;
    let alive = true;
    setCapsFailed(false);
    const ask = (retry: boolean) =>
      api
        .assetBuildCapabilities()
        .then((c) => alive && setCaps(c))
        .catch(() => {
          if (!alive) return;
          if (retry) setTimeout(() => ask(false), 600);
          else setCapsFailed(true);
        });
    void ask(true);
    return () => {
      alive = false;
    };
  }, [value]);

  /** Never an empty footnote: say what will happen, or say it could not be checked. */
  const capsNote = useCallback(
    (whenKnown: string): ReactNode => {
      if (caps) return whenKnown;
      if (capsFailed) return 'Could not reach the engine. You can still try.';
      return 'Checking the engine…';
    },
    [caps, capsFailed],
  );

  /** How the build a stored draft was sent as is doing, so Try again can refill. */
  const pendingState = useCallback(
    (jobId: string): PendingState => {
      const b = builds.find((x) => x.id === jobId);
      if (!b) return 'unknown';
      if (b.stage === 'failed') return 'failed';
      if (b.stage === 'cancelled') return 'cancelled';
      if (b.stage === 'done') return 'done';
      return 'running';
    },
    [builds],
  );

  /**
   * What was made, said once. A product exists the moment this fires; a build
   * has only started, and its own finish is announced by the bell later.
   */
  const onStarted = useCallback(
    (made: Created) => {
      const cb = createdRef.current;
      close();
      poke();
      if (made.kind === 'product') {
        // an import has no product of its own yet — the bell carries that one
        if (!made.id) {
          push({ kind: 'success', title: 'Importing your catalog', detail: made.name });
          return;
        }
        void refreshBrands();
        if (cb?.kind === 'product') cb.fn(made);
        push({
          kind: 'success',
          title: `${made.name} added`,
          actions: [
            { label: 'Add details', onClick: () => navigate(productPath(brand, made.id)) },
            { label: 'Use in a shot', onClick: () => navigate(`${hubPath(brand)}?product=${made.id}&compose=1`) },
          ],
        });
        return;
      }
      if (cb?.kind === made.kind) cb.fn(made);
      push({
        kind: 'success',
        title: `Building ${made.name}`,
        detail: made.kind === 'presenter' ? 'Four studio views. The bell will say when.' : 'The bell will say when.',
      });
    },
    [brand, close, navigate, poke, push, refreshBrands],
  );

  const api2 = useMemo<CreateApi>(() => ({ open }), [open]);

  const kind = isKind(value) ? value : null;
  const flowProps = {
    onBack: cameFromChooser ? () => setParam(CHOOSER) : undefined,
    onStarted,
    caps,
    capsNote,
    pendingState,
    restore,
    onDiscarded: () => kind && onDiscarded(kind),
  };

  return (
    <Ctx.Provider value={api2}>
      {children}
      {value === CHOOSER && (
        <AssetKindPicker
          suggest={here}
          onPick={(k) => {
            setCameFromChooser(true);
            setParam(k);
          }}
        />
      )}
      {/* Keyed by kind so switching flows remounts rather than carrying one
          form's fields into another's. */}
      {kind === 'product' && <ProductForm key="product" {...flowProps} />}
      {kind === 'presenter' && <PresenterForm key="presenter" {...flowProps} />}
      {kind === 'scene' && <SceneForm key="scene" {...flowProps} />}
    </Ctx.Provider>
  );
}
