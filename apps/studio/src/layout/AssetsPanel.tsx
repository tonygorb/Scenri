import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { Dialog } from '@radix-ui/themes';
import { CaretRight, ImageSquare, MagnifyingGlass, Plus, X } from '@phosphor-icons/react';
import { assetUrl, imgUrl, type Brand, type Look, type TreeNode } from '../api.js';
import { useBrand } from '../app/BrandLayout.js';
import { ProductsPanel } from '../AssetPanel.js';
import { PREF, useLocalPref } from '../prefs.js';
import { presentersPath } from '../routes.js';

const ROLE_NAMES = ['Primary', 'Secondary', 'Accent', 'Accent 2', 'Neutral', 'Neutral 2'];

/**
 * How many the open group's grid starts with before infinite scroll takes
 * over. A catalog import can land five hundred products, and this column
 * used to render every one of them the moment you opened it.
 */
const PREVIEW = 12;

/** How many a closed/idle group teases — one row, no pagination controls. */
const IDLE_PREVIEW = 4;

/** How many more the open group renders each time the scroll sentinel is hit. */
const LOAD_BATCH = 24;

/**
 * Browsable mirror of the attach menu: the same groups TokenMenu serves,
 * as thumbnails. Clicking inserts into the composer; the sigil menus stay
 * the keyboard path.
 */
export function AssetsPanel({
  brand,
  templates,
  shots,
  onProduct,
  onCharacter,
  onColor,
  onRef,
  onTemplate,
  onBrandChanged,
  onClose,
}: {
  brand: Brand;
  templates: Look[];
  shots: TreeNode[];
  onProduct: (id: string) => void;
  onCharacter: (id: string) => void;
  onColor: (hex: string, name?: string) => void;
  onRef: (imageHash: string) => void;
  onTemplate: (id: string) => void;
  onBrandChanged: () => void;
  /** Drawer mode close (shown under 1280px only). */
  onClose: () => void;
}) {
  const [q, setQ] = useState('');
  const [openGroup, setOpenGroup] = useLocalPref<string | null>(PREF.assetsOpenGroup, null);
  const toggleGroup = (name: string) => setOpenGroup((g) => (g === name ? null : name));
  const navigate = useNavigate();
  const { products: library } = useBrand();
  const products: any[] = library.length ? library : ((brand.json?.products ?? []) as any[]);
  const palette = useMemo(() => {
    const p = brand.json?.palette;
    const raw: { hex: string; name?: string }[] = [];
    const add = (c: any) => {
      if (c?.hex) raw.push({ hex: String(c.hex).toUpperCase(), name: c.name });
    };
    add(p?.primary);
    add(p?.secondary);
    (p?.accent ?? []).forEach(add);
    (p?.neutrals ?? []).forEach(add);
    return raw.map((c, i) => ({ hex: c.hex, name: c.name ?? ROLE_NAMES[i] ?? `Color ${i + 1}` }));
  }, [brand]);
  const recent = shots
    .filter((s) => s.status === 'done' && s.images.length > 0)
    .slice(-8)
    .reverse();

  const searching = !!q.trim();
  const match = (label: string) => !searching || label.toLowerCase().includes(q.trim().toLowerCase());
  const fProducts = products.filter((p) => match(p.name ?? ''));
  const cast: any[] = (brand.json?.characters ?? []) as any[];
  const fCast = cast.filter((c) => match(c.name ?? ''));
  const fTemplates = templates.filter((t) => match(t.name));
  const fPalette = palette.filter((c) => match(c.name) || match(c.hex));

  const productsGroup = (
    <Group
      key="Products"
      name="Products"
      count={fProducts.length}
      searching={searching}
      openGroup={openGroup}
      onToggle={toggleGroup}
      action={
        <Dialog.Root>
          <Dialog.Trigger>
            <button type="button" className="sc-aadd" title="Add product" aria-label="Add product">
              <Plus size={10} />
            </button>
          </Dialog.Trigger>
          <Dialog.Content maxWidth="560px">
            <Dialog.Title>Products: {brand.json?.meta?.name}</Dialog.Title>
            <ProductsPanel brand={brand} onChanged={onBrandChanged} />
          </Dialog.Content>
        </Dialog.Root>
      }
      empty={q ? 'No product matches.' : 'No products yet. Add one so shots stay exact.'}
      note="Click to attach. Locked shots keep the product exact."
      render={(shown, mode) =>
        shown.map((p: any) => {
          const shot = assetUrl(p.shots?.[0]?.file);
          const thumb = shot ? (
            <img src={shot} alt={p.name} loading="lazy" />
          ) : (
            <span className="sc-aswatch" style={{ display: 'grid', placeItems: 'center' }}>
              <ImageSquare size={14} />
            </span>
          );
          if (mode === 'open') {
            return <AssetCard key={p.id} title={p.name} onClick={() => onProduct(p.id)} thumb={thumb} label={p.name} />;
          }
          return (
            <button type="button" key={p.id} title={p.name} onClick={() => onProduct(p.id)}>
              {thumb}
            </button>
          );
        })
      }
      items={fProducts}
    />
  );

  const presentersGroup = (
    <Group
      key="Presenters"
      name="Presenters"
      count={fCast.length}
      searching={searching}
      openGroup={openGroup}
      onToggle={toggleGroup}
      action={
        <>
          <button
            type="button"
            className="sc-aadd"
            title="Browse the presenter library"
            aria-label="Browse the presenter library"
            onClick={() => navigate(presentersPath(brand))}
          >
            <CaretRight size={10} />
          </button>
          <Dialog.Root>
            <Dialog.Trigger>
              <button type="button" className="sc-aadd" title="Add someone" aria-label="Add someone">
                <Plus size={10} />
              </button>
            </Dialog.Trigger>
            <Dialog.Content maxWidth="560px">
              <Dialog.Title>Presenters: {brand.json?.meta?.name}</Dialog.Title>
              <ProductsPanel brand={brand} onChanged={onBrandChanged} kind="characters" />
            </Dialog.Content>
          </Dialog.Root>
        </>
      }
      empty={q ? 'Nobody matches.' : 'No presenters yet. Browse the library or add your own.'}
      note="Name someone once and they come back the same."
      items={fCast}
      render={(shown, mode) =>
        shown.map((c: any) => {
          const shot = assetUrl(c.shots?.[0]?.file);
          const thumb = shot ? (
            <img src={shot} alt={c.name} loading="lazy" />
          ) : (
            <span className="sc-aswatch" style={{ display: 'grid', placeItems: 'center' }}>
              <ImageSquare size={14} />
            </span>
          );
          if (mode === 'open') {
            return (
              <AssetCard key={c.id} title={c.name} onClick={() => onCharacter(c.id)} thumb={thumb} label={c.name} />
            );
          }
          return (
            <button type="button" key={c.id} title={c.name} onClick={() => onCharacter(c.id)}>
              {thumb}
            </button>
          );
        })
      }
    />
  );

  const looksGroup =
    fTemplates.length > 0 ? (
      <Group
        key="Looks"
        name="Looks"
        count={fTemplates.length}
        searching={searching}
        openGroup={openGroup}
        onToggle={toggleGroup}
        items={fTemplates}
        render={(shown, mode) =>
          shown.map((t: Look) => {
            const thumb = t.previewUrl ? (
              <img src={t.previewUrl} alt={t.name} loading="lazy" />
            ) : (
              <span className="sc-aswatch" style={{ display: 'grid', placeItems: 'center' }}>
                <ImageSquare size={14} />
              </span>
            );
            if (mode === 'open') {
              return (
                <AssetCard key={t.id} title={t.name} onClick={() => onTemplate(t.id)} thumb={thumb} label={t.name} />
              );
            }
            return (
              <button type="button" key={t.id} title={t.name} onClick={() => onTemplate(t.id)}>
                {thumb}
              </button>
            );
          })
        }
      />
    ) : null;

  const brandColorsGroup =
    fPalette.length > 0 ? (
      <Group
        key="Brand colors"
        name="Brand colors"
        count={fPalette.length}
        searching={searching}
        openGroup={openGroup}
        onToggle={toggleGroup}
        items={fPalette}
        render={(shown) =>
          shown.map((c: { hex: string; name: string }) => (
            <button type="button" key={c.hex} title={`${c.name} ${c.hex}`} onClick={() => onColor(c.hex, c.name)}>
              <span className="sc-aswatch" style={{ background: c.hex }} />
            </button>
          ))
        }
      />
    ) : null;

  const recentShotsGroup =
    recent.length > 0 && !searching ? (
      <Group
        key="Recent shots"
        name="Recent shots"
        count={recent.length}
        searching={searching}
        openGroup={openGroup}
        onToggle={toggleGroup}
        items={recent}
        note="Attach as a style reference."
        render={(shown) =>
          shown.map((s: TreeNode) => (
            <button type="button" key={s.id} title="Attach as a style reference" onClick={() => onRef(s.images[0])}>
              <img src={imgUrl(s.images[0])} alt="" loading="lazy" />
            </button>
          ))
        }
      />
    ) : null;

  return (
    <aside className="sc-assets" aria-label="Assets" data-open-group={openGroup || undefined}>
      <div className="sc-assets-head">
        <b>Assets</b>
        <button
          type="button"
          className="sc-icon-btn"
          onClick={onClose}
          aria-label="Close assets"
          style={{ width: 28, height: 28 }}
        >
          <X size={12} />
        </button>
      </div>
      <div className="sc-assets-search">
        <MagnifyingGlass size={12} />
        <input placeholder="Search assets" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      {productsGroup}
      {presentersGroup}
      {looksGroup}
      {brandColorsGroup}
      {recentShotsGroup}
    </aside>
  );
}

/** A labeled, badge-capable card used for the open group's expanded grid. */
function AssetCard({
  title,
  onClick,
  thumb,
  label,
  badge,
}: {
  title: string;
  onClick: () => void;
  thumb: ReactNode;
  label: string;
  badge?: ReactNode;
}) {
  return (
    <button type="button" className="sc-acard" title={title} onClick={onClick}>
      <span className="sc-acard-thumb">
        {thumb}
        {badge && <span className="sc-acard-badge">{badge}</span>}
      </span>
      <span className="sc-acard-label">{label}</span>
    </button>
  );
}

/**
 * One group of the rail, in one of three modes.
 *
 * "idle" (nothing open anywhere, or searching) shows every group's compact
 * preview at once, same as the rail always has. Opening a group makes it
 * "open" — it takes over the rail's remaining height with a bigger card grid
 * — and every *other* group becomes "collapsed": a bare header, no preview.
 * Groups before the open one in render order collapse up against the top,
 * groups after it collapse down against the bottom (the open group's flex:1
 * pushes them there — see the CSS), so the open pane always ends up
 * sandwiched between two stacks of headers rather than needing to track
 * scroll position to know which groups should be showing a preview. Closing
 * the open group returns everything to idle rather than leaving anything
 * collapsed, so the rail never gets stuck in an all-headers state nobody
 * asked for.
 *
 * The preview cap is separate from all of that: it is about this group's own
 * DOM cost, so that five hundred products do not have to be drawn to see the
 * first twelve, whether idle or open.
 *
 * A search overrules the mode. Typing into the box and getting nothing back
 * because the matches were behind a collapsed header would read as the search
 * being broken.
 */
function Group<T>({
  name,
  count,
  items,
  render,
  action,
  note,
  empty,
  searching,
  openGroup,
  onToggle,
}: {
  name: string;
  count: number;
  items: T[];
  render: (shown: T[], mode: 'compact' | 'open') => ReactNode;
  action?: ReactNode;
  note?: string;
  empty?: string;
  searching: boolean;
  openGroup: string | null;
  onToggle: (name: string) => void;
}) {
  const [visibleCount, setVisibleCount] = useState(PREVIEW);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const mode: 'idle' | 'open' | 'collapsed' =
    searching || openGroup === null ? 'idle' : openGroup === name ? 'open' : 'collapsed';

  // The open card grid and the compact preview row are different DOM shapes
  // (labeled cards vs plain thumbnails), not just a size change — swapping them
  // the instant `mode` flips reads as a pop, worst right as the box is also
  // resizing. So the shape shown (`displayShape`) lags `mode` by one fade: it
  // only follows once content has faded to invisible, then swaps and fades back
  // in. Idle and collapsed share the same compact shape, so this only ever
  // triggers on an actual open <-> compact change, never on idle <-> collapsed.
  const contentShape: 'compact' | 'open' = mode === 'open' ? 'open' : 'compact';
  const [displayShape, setDisplayShape] = useState<'compact' | 'open'>(contentShape);
  const [fading, setFading] = useState(false);
  useEffect(() => {
    if (contentShape === displayShape) return;
    // Reduced motion strips the opacity transition in CSS (see tokens.css), so
    // waiting out the fade here would just hold an invisible, unexplained gap
    // instead of hiding a swap — skip straight to the new shape.
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setDisplayShape(contentShape);
      return;
    }
    setFading(true);
    const t = setTimeout(() => {
      setDisplayShape(contentShape);
      setFading(false);
    }, 130);
    return () => {
      clearTimeout(t);
      setFading(false);
    };
  }, [contentShape, displayShape]);

  // Idle is a fixed one-row teaser — no pagination. Searching always shows every
  // match, regardless of mode. The open pane starts at PREVIEW and grows itself
  // as the user scrolls (see the sentinel effect below) — never a manual button,
  // never all 576 mounted at once. Collapsed groups stay mounted now (see the
  // transition comment below) but still cap to the teaser count — nobody
  // needs 576 hidden buttons in the DOM for a group they can't see. All of this
  // keys off `displayShape`, not `mode`, so the item list swaps in lockstep with
  // the faded-out moment above rather than a beat earlier.
  const shown =
    displayShape === 'open' ? items.slice(0, visibleCount) : searching ? items : items.slice(0, IDLE_PREVIEW);
  const hidden = displayShape === 'open' ? items.length - shown.length : 0;

  // Infinite scroll: growing the DOM in one 564-item jump on a button click was
  // the exact cost the PREVIEW cap exists to avoid — a sentinel a bit before the
  // bottom of the open group's own scroll area (not the whole panel) grows the
  // list a batch at a time instead, so it never has to happen all at once.
  useEffect(() => {
    if (displayShape !== 'open' || hidden === 0) return;
    const root = bodyRef.current;
    const target = sentinelRef.current;
    if (!root || !target) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setVisibleCount((c) => Math.min(c + LOAD_BATCH, items.length));
        }
      },
      { root, rootMargin: '200px' },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [displayShape, hidden, items.length]);

  return (
    <div className="sc-agroup" data-mode={mode}>
      <div className="sc-agroup-h">
        <button
          type="button"
          className="sc-agroup-t"
          aria-expanded={mode !== 'collapsed'}
          onClick={() => onToggle(name)}
        >
          <b>{name}</b>
          {count > 0 && <span className="sc-agroup-n">{count}</span>}
          <CaretRight size={11} className="sc-agroup-caret" aria-hidden="true" />
        </button>
        {action}
      </div>

      <div className="sc-agroup-body" ref={bodyRef}>
        <div className="sc-agroup-content" data-fading={fading || undefined}>
          {items.length === 0 && empty ? (
            <p className="sc-anote">{empty}</p>
          ) : (
            <>
              <div className={displayShape === 'open' ? 'sc-acard-grid' : 'sc-arow'}>{render(shown, displayShape)}</div>
              {displayShape === 'open' && hidden > 0 && (
                <div ref={sentinelRef} className="sc-agroup-sentinel" aria-hidden="true" />
              )}
              {note && <p className="sc-anote">{note}</p>}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
