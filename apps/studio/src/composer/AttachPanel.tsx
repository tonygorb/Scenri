import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { ImageSquare, MagnifyingGlass, Plus, UploadSimple, X } from '@phosphor-icons/react';
import { imgUrl, type Brand, type TreeNode } from '../api.js';
import { uploadLogo } from '../apiUploads.js';
import { useAppData } from '../app/AppShell.js';
import { useToasts } from '../toasts.js';
import { failureToast } from '../failure.js';
import { useCreateAsset } from '../create/AssetCreateHost.js';
import { flattenPalette } from '../brand/palette.js';
import { attachableMarks, markLabel } from '../brand/marks.js';
import type { SentenceToken } from './BriefInput.js';
import { keepCaret } from './line.js';
import { matchesQuery } from '../layout/library/libraryRules.js';
import { buildCandidates, pickList, type IngredientKind } from './ingredientOptions.js';
import { useIngredientCatalog } from './useIngredientCatalog.js';
import { bookmarkedScenes } from '../bookmarks.js';

/** Per group on the All tab, where the point is breadth rather than depth. */
const ALL_TAB_PREVIEW = 8;
/** On a single tab, enough to browse; past this, searching beats scrolling. */
const TAB_CAP = 60;
/**
 * "Library" used to sit here as a tab of its own, holding Scenri's products
 * while "Products" held yours — ownership presented as a type. They are the
 * same kind of thing and they share a tab now, yours ranked first, which is
 * what the caret menu and the chip picker have always done.
 */
const TABS = ['All', 'Products', 'Presenters', 'Scenes', 'Colors', 'Brand', 'Shots'] as const;
export type AttachTab = (typeof TABS)[number];
type Tab = AttachTab;

interface Card {
  key: string;
  tab: Exclude<Tab, 'All'>;
  label: string;
  sub?: string;
  /** Matched on but never shown: keywords, brand, names from before a rename. */
  search?: string;
  thumb?: string | null;
  /** Set when `thumb` is a card/shot standing in for a square avatar — pull
   * the framing to the top of the picture instead of centring a torso. */
  crop?: 'top';
  swatch?: string;
  /** A hint, not a filter — see compat.ts. Only ever set for Scenes/Presenters. */
  recommended?: boolean;
  run: () => void;
}

/**
 * The big attach surface: opens above the composer at its full width.
 * Same data the sigil menus serve, browsable as thumbnail cards. Stays
 * open for multi-attach; Esc, X or outside click closes.
 */
export function AttachPanel({
  brand,
  shots,
  initialTab = 'All',
  activeProductCategory,
  id,
  onToken,
  onTemplate,
  onUpload,
  onClose,
}: {
  brand: Brand;
  shots: TreeNode[];
  initialTab?: AttachTab;
  /** For the opener's aria-controls. */
  id?: string;
  /** The category of whichever product is already in the brief, if any — see compat.ts. */
  activeProductCategory?: string | null;
  onToken: (t: SentenceToken) => void;
  onTemplate: (id: string) => void;
  onUpload: () => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<Tab>(initialTab);
  useEffect(() => {
    setTab(initialTab);
  }, [initialTab]);
  const [q, setQ] = useState('');
  const catalog = useIngredientCatalog(activeProductCategory);
  const bookmarked = useMemo(() => new Set(bookmarkedScenes(brand.id)), [brand.id]);
  const createAsset = useCreateAsset();
  const { applyBrand } = useAppData();
  const { push } = useToasts();
  const [logoBusy, setLogoBusy] = useState(false);
  /**
   * The declared-intent channel for a logo. A logo dragged into the composer
   * lands as a plain reference — a drop declares no intent — and a reference
   * logotype is deliberately treated as mood, which is exactly how testers'
   * logos came back fictionalised. This tile mints a real kit mark through
   * the same route Settings uses (first mark becomes THE logo, later ones
   * variants) and drops the chip in, so the compiler's whole mark contract
   * applies.
   */
  const addLogo = async (file: File) => {
    setLogoBusy(true);
    try {
      const row = await uploadLogo(brand.id, file);
      applyBrand(row);
      const hash = (row as { logoHash?: string }).logoHash;
      if (hash) onToken({ t: 'mark', imageHash: hash });
      // Under the warn edge the mark rides, but its fine lettering is already
      // subpixel; the chip will flag it too, this just says it at the moment
      // of upload, when re-exporting is one step away.
      const edge = (row as { logoEdge?: number | null }).logoEdge;
      if (edge && edge < 512)
        push({
          kind: 'success',
          title: 'Logo added, but it is small',
          detail: `Only ${edge}px across. Fine lettering may not survive generation. Export it larger, or as SVG.`,
        });
    } catch (e) {
      push(failureToast(e, 'Could not upload that logo'));
    } finally {
      setLogoBusy(false);
    }
  };
  // The creation dialog lives in the URL now, so "is something stacked on top
  // of me" is a question the URL answers rather than a boolean this panel has
  // to remember to keep in sync.
  const [params] = useSearchParams();
  const creating = params.get('new') !== null;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // the creation dialog is a real Radix Dialog stacked on top — its own
      // Escape closes it; this only steps in once nothing is on top
      if (e.key === 'Escape' && !creating) {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose, creating]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      // same reason: the creation dialog portals to document.body, so a click
      // inside it — its input, its own close button — reads as "outside
      // .sc-attachpanel" and closed both the dialog and the panel underneath it
      if (creating) return;
      if (
        !(e.target as HTMLElement).closest('.sc-attachpanel') &&
        !(e.target as HTMLElement).closest('.sc-attach-toggle')
      )
        onClose();
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [onClose, creating]);

  const cards = useMemo<Card[]>(() => {
    const palette = flattenPalette(brand.json?.palette);
    const marks = attachableMarks(brand.json);
    const recent = shots
      .filter((s) => s.status === 'done' && s.images.length > 0)
      .slice(-12)
      .reverse();

    /**
     * Products, presenters and scenes come from the one shared model, ranked
     * the same way the rail and the chip picker rank them — yours first, then
     * suitability and taste. This panel used to build its own three lists,
     * with its own products fallback and its own search text, which is how it
     * ended up able to find things the caret menu could not.
     */
    const ingredient = (kind: IngredientKind, tab: Exclude<Tab, 'All'>): Card[] =>
      pickList(kind, buildCandidates(kind, catalog), {
        currentId: null,
        query: '',
        bookmarked,
        shown: Number.MAX_SAFE_INTEGER,
      }).items.map((c) => ({
        key: `${kind}:${c.id}`,
        tab,
        label: c.label,
        sub: c.sub,
        search: c.search,
        thumb: c.thumb,
        // the candidate's framing hint used to be dropped right here, so an
        // avatar-less presenter rendered as a centred torso in the 1:1 card
        crop: c.crop,
        recommended: c.recommended,
        run: () => (c.kind === 'scene' ? onTemplate(c.id) : onToken(c.token)),
      }));

    return [
      ...ingredient('product', 'Products'),
      ...ingredient('presenter', 'Presenters'),
      ...ingredient('scene', 'Scenes'),
      ...marks.map(
        (m): Card => ({
          key: `m:${m.hash}`,
          tab: 'Brand',
          label: markLabel(brand.json, m),
          sub: 'the mark itself',
          thumb: imgUrl(m.hash as string),
          run: () => onToken({ t: 'mark', imageHash: m.hash as string }),
        }),
      ),
      ...palette.map(
        (c): Card => ({
          key: `c:${c.hex}`,
          tab: 'Colors',
          label: c.name,
          sub: c.hex,
          swatch: c.hex,
          run: () => onToken({ t: 'color', hex: c.hex, name: c.name }),
        }),
      ),
      ...recent.map(
        (s, i): Card => ({
          key: `r:${s.id}`,
          tab: 'Shots',
          label: `Shot ${recent.length - i}`,
          sub: 'as reference',
          thumb: imgUrl(s.images[0]),
          run: () => onToken({ t: 'ref', imageHash: s.images[0] }),
        }),
      ),
    ];
  }, [brand, catalog, bookmarked, shots, onToken, onTemplate]);

  // The library matcher, not a second one: `rosé` and `serums` found results
  // on every library page and in the picker, and nothing here.
  const match = (c: Card) => matchesQuery(`${c.label} ${c.sub ?? ''} ${c.search ?? ''}`, q);
  const inTab = (c: Card) => tab === 'All' || c.tab === tab;
  const shown = cards.filter((c) => inTab(c) && match(c));
  // Brand sits with the other identity-ish groups: it was missing here, which
  // made the marks reachable only by knowing to click the Brand tab.
  const groups: Exclude<Tab, 'All'>[] = ['Products', 'Presenters', 'Scenes', 'Brand', 'Colors', 'Shots'];

  const card = (c: Card) => (
    <button
      type="button"
      key={c.key}
      className="sc-ap-card"
      title={c.sub ? `${c.label} · ${c.sub}` : c.label}
      onClick={c.run}
    >
      {c.swatch ? (
        <span className="sc-ap-thumb" style={{ background: c.swatch }} />
      ) : c.thumb ? (
        <img className="sc-ap-thumb" src={c.thumb} alt="" loading="lazy" data-crop={c.crop} />
      ) : (
        <span className="sc-ap-thumb sc-ap-thumb-empty">
          <ImageSquare size={16} />
        </span>
      )}
      {c.recommended && <span className="sc-ap-rec">Recommended</span>}
      <b dir="auto">{c.label}</b>
    </button>
  );

  return (
    // Non-modal on purpose — it stays open for multi-attach and the brief
    // stays editable behind it — so no focus trap and no aria-modal. Escape
    // still closes it from anywhere inside; the opener restores focus.
    <div
      className="sc-attachpanel"
      role="dialog"
      id={id}
      aria-label="Attach to brief"
      onMouseDownCapture={keepCaret}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <div className="sc-ap-head">
        <div className="sc-ap-tabs">
          {TABS.map((t) => (
            <button type="button" key={t} data-active={t === tab} onClick={() => setTab(t)}>
              {t}
            </button>
          ))}
        </div>
        <div className="sc-ap-search">
          <MagnifyingGlass size={12} />
          <input placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <button
          type="button"
          className="sc-icon-btn sc-ap-close"
          onClick={onUpload}
          aria-label="Upload image"
          title="Upload an image"
          style={{ width: 28, height: 28 }}
        >
          <UploadSimple size={12} />
        </button>
        <button
          type="button"
          className="sc-icon-btn sc-ap-close"
          onClick={onClose}
          aria-label="Close"
          style={{ width: 28, height: 28 }}
        >
          <X size={12} />
        </button>
      </div>

      <div className="sc-ap-body">
        {shown.length === 0 && <div className="sc-ap-empty">Nothing matches{q.trim() ? ` "${q.trim()}"` : ''}.</div>}
        {tab === 'All' ? (
          groups.map((g) => {
            const items = shown.filter((c) => c.tab === g);
            if (!items.length) return null;
            /**
             * All is a summary, not an inventory. A brand with a catalog import
             * has hundreds of products, and drawing every one of them here
             * pushed Presenters, Scenes and Colours off the bottom of a panel whose
             * whole job is to show you what there is.
             */
            const preview = items.slice(0, ALL_TAB_PREVIEW);
            const rest = items.length - preview.length;
            return (
              <div key={g} className="sc-ap-group">
                <div className="sc-eyebrow">{g === 'Shots' ? 'Recent shots' : g === 'Colors' ? 'Brand colors' : g}</div>
                <div className="sc-ap-grid">{preview.map(card)}</div>
                {rest > 0 && (
                  <button type="button" className="sc-amore" onClick={() => setTab(g)}>
                    Show all {items.length}
                  </button>
                )}
              </div>
            );
          })
        ) : (
          <>
            <div className="sc-ap-grid">
              {tab === 'Products' && (
                // Add-a-product used to mean close this panel, open the Assets
                // rail, upload, close, reopen, find it, click it. One button.
                <button
                  type="button"
                  className="sc-ap-card sc-ap-add"
                  onClick={() =>
                    // The one caller that genuinely needs an answer back: the
                    // chip goes into a brief that is still in memory, so a URL
                    // round-trip would remount the composer under it.
                    createAsset('product', {
                      onCreated: (made) => made.kind === 'product' && onToken({ t: 'product', id: made.id }),
                    })
                  }
                >
                  <span className="sc-ap-thumb sc-ap-thumb-empty">
                    <Plus size={16} />
                  </span>
                  <b>Add product</b>
                </button>
              )}
              {tab === 'Brand' && (
                // A label over a hidden input, the same gesture BrandIdentity's
                // variant-add uses: one click, a file, and the mark is in the
                // kit AND in the brief.
                <label
                  className="sc-ap-card sc-ap-add"
                  title="Add your logo to the brand kit"
                  aria-label="Add your logo to the brand kit"
                  data-busy={logoBusy || undefined}
                >
                  <input
                    type="file"
                    accept="image/*"
                    hidden
                    disabled={logoBusy}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      e.target.value = '';
                      if (file) void addLogo(file);
                    }}
                  />
                  <span className="sc-ap-thumb sc-ap-thumb-empty">
                    <Plus size={16} />
                  </span>
                  <b>Add logo</b>
                </label>
              )}
              {shown.slice(0, TAB_CAP).map(card)}
            </div>
            {shown.length > TAB_CAP && (
              // never a silent truncation: say what is not on screen and how to
              // reach it, which for a list this size is the search box above
              <p className="sc-ap-capped">
                Showing {TAB_CAP} of {shown.length}. Search to narrow it down.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
