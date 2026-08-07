import { useEffect, useMemo, useState } from 'react';
import { Dialog } from '@radix-ui/themes';
import { ImageSquare, MagnifyingGlass, Plus, UploadSimple, X } from '@phosphor-icons/react';
import { assetUrl, imgUrl, type Brand, type Scene, type Presenter, type TreeNode } from '../api.js';
import { useBrand } from '../app/BrandLayout.js';
import { ProductsPanel } from '../AssetPanel.js';
import { isRecommendedScene, isRecommendedPresenter } from '../compat.js';
import type { SentenceToken } from './BriefInput.js';
import { keepCaret } from './line.js';

const ROLE_NAMES = ['Primary', 'Secondary', 'Accent', 'Accent 2', 'Neutral', 'Neutral 2'];
/** Per group on the All tab, where the point is breadth rather than depth. */
const ALL_TAB_PREVIEW = 8;
/** On a single tab, enough to browse; past this, searching beats scrolling. */
const TAB_CAP = 60;
const TABS = ['All', 'Products', 'Presenters', 'Scenes', 'Colors', 'Shots'] as const;
export type AttachTab = (typeof TABS)[number];
type Tab = AttachTab;

interface Card {
  key: string;
  tab: Exclude<Tab, 'All'>;
  label: string;
  sub?: string;
  thumb?: string | null;
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
  templates,
  presenters,
  shots,
  initialTab = 'All',
  activeProductCategory,
  onToken,
  onTemplate,
  onUpload,
  onClose,
}: {
  brand: Brand;
  templates: Scene[];
  presenters: Presenter[];
  shots: TreeNode[];
  initialTab?: AttachTab;
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
  const [addProductOpen, setAddProductOpen] = useState(false);
  const { products: library } = useBrand();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // the Add-product dialog is a real Radix Dialog stacked on top — its
      // own Escape closes it; this only steps in once nothing is on top
      if (e.key === 'Escape' && !addProductOpen) {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose, addProductOpen]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      // same reason: the Add-product dialog portals to document.body, so a
      // click inside it — its input, its own close button — reads as "outside
      // .sc-attachpanel" and closed both the dialog and the panel underneath it
      if (addProductOpen) return;
      if (
        !(e.target as HTMLElement).closest('.sc-attachpanel') &&
        !(e.target as HTMLElement).closest('.sc-attach-toggle')
      )
        onClose();
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [onClose, addProductOpen]);

  const cards = useMemo<Card[]>(() => {
    const products: any[] = library.length ? library : ((brand.json?.products ?? []) as any[]);
    const p = brand.json?.palette;
    const raw: { hex: string; name?: string }[] = [];
    const add = (c: any) => {
      if (c?.hex) raw.push({ hex: String(c.hex).toUpperCase(), name: c.name });
    };
    add(p?.primary);
    add(p?.secondary);
    (p?.accent ?? []).forEach(add);
    (p?.neutrals ?? []).forEach(add);
    const recent = shots
      .filter((s) => s.status === 'done' && s.images.length > 0)
      .slice(-12)
      .reverse();

    return [
      ...products.map(
        (pr): Card => ({
          key: `p:${pr.id}`,
          tab: 'Products',
          label: pr.name ?? 'Product',
          sub: 'stays exact',
          thumb: assetUrl(pr.shots?.[0]?.file),
          run: () => onToken({ t: 'product', id: pr.id }),
        }),
      ),
      ...presenters.map(
        (pr): Card => ({
          key: `h:${pr.id}`,
          tab: 'Presenters',
          label: pr.name,
          sub: pr.descriptor,
          thumb: pr.previewUrl ?? null,
          recommended: isRecommendedPresenter(pr, activeProductCategory),
          run: () => onToken({ t: 'character', id: pr.id }),
        }),
      ),
      ...templates.map(
        (t): Card => ({
          key: `t:${t.id}`,
          tab: 'Scenes',
          label: t.name,
          sub: t.lighting,
          thumb: (t as any).previewUrl ?? null,
          recommended: isRecommendedScene(t, activeProductCategory),
          run: () => onTemplate(t.id),
        }),
      ),
      ...raw.map(
        (c, i): Card => ({
          key: `c:${c.hex}`,
          tab: 'Colors',
          label: c.name ?? ROLE_NAMES[i] ?? `Color ${i + 1}`,
          sub: c.hex,
          swatch: c.hex,
          run: () => onToken({ t: 'color', hex: c.hex, name: c.name ?? ROLE_NAMES[i] }),
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
  }, [brand, library, templates, presenters, shots, activeProductCategory, onToken, onTemplate]);

  const query = q.trim().toLowerCase();
  const match = (c: Card) => !query || `${c.label} ${c.sub ?? ''}`.toLowerCase().includes(query);
  const inTab = (c: Card) => tab === 'All' || c.tab === tab;
  const shown = cards.filter((c) => inTab(c) && match(c));
  const groups: Exclude<Tab, 'All'>[] = ['Products', 'Presenters', 'Scenes', 'Colors', 'Shots'];

  const card = (c: Card) => (
    <button
      type="button"
      key={c.key}
      className="sc-ap-card"
      title={c.sub ? `${c.label} — ${c.sub}` : c.label}
      onClick={c.run}
    >
      {c.swatch ? (
        <span className="sc-ap-thumb" style={{ background: c.swatch }} />
      ) : c.thumb ? (
        <img className="sc-ap-thumb" src={c.thumb} alt="" loading="lazy" />
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
    <div className="sc-attachpanel" role="dialog" aria-label="Attach to brief" onMouseDownCapture={keepCaret}>
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
        {shown.length === 0 && <div className="sc-ap-empty">Nothing matches{query ? ` "${q.trim()}"` : ''}.</div>}
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
                <button type="button" className="sc-ap-card sc-ap-add" onClick={() => setAddProductOpen(true)}>
                  <span className="sc-ap-thumb sc-ap-thumb-empty">
                    <Plus size={16} />
                  </span>
                  <b>Add product</b>
                </button>
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
      <Dialog.Root open={addProductOpen} onOpenChange={setAddProductOpen}>
        <Dialog.Content maxWidth="560px">
          <Dialog.Close>
            <button type="button" className="sc-set-close sc-dlg-close" aria-label="Close">
              <X size={16} />
            </button>
          </Dialog.Close>
          <Dialog.Title>Products: {brand.json?.meta?.name}</Dialog.Title>
          <ProductsPanel
            brand={brand}
            onChanged={(newProductId) => {
              // a single manual upload lands one product: insert it as a chip
              // and close the small dialog, collapsing what used to be a
              // close-reopen-find-click round trip down to this one upload
              if (newProductId) {
                onToken({ t: 'product', id: newProductId });
                setAddProductOpen(false);
              }
            }}
          />
        </Dialog.Content>
      </Dialog.Root>
    </div>
  );
}
