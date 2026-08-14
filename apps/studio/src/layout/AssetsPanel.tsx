import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { productLabel, productSearchText, sceneLabel, sceneSearchText } from '../displayName.js';
import { useNavigate } from 'react-router';
import { Dialog } from '@radix-ui/themes';
import { CaretRight, ImageSquare, MagnifyingGlass, Plus, X } from '@phosphor-icons/react';
import { assetUrl, imgUrl, type Brand, type Scene, type Presenter, type TreeNode } from '../api.js';
import { useBrand } from '../app/BrandLayout.js';
import { useCreateAsset } from '../create/AssetCreateHost.js';
import { useAppData } from '../app/AppShell.js';
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
  presenters,
  shots,
  onProduct,
  onCharacter,
  onColor,
  onRef,
  onTemplate,
  onClose,
}: {
  brand: Brand;
  templates: Scene[];
  presenters: Presenter[];
  shots: TreeNode[];
  onProduct: (id: string) => void;
  onCharacter: (id: string) => void;
  onColor: (hex: string, name?: string) => void;
  onRef: (imageHash: string) => void;
  onTemplate: (id: string) => void;
  /** Drawer mode close (shown under 1280px only). */
  onClose: () => void;
}) {
  const [q, setQ] = useState('');
  const [openGroup, setOpenGroup] = useLocalPref<string | null>(PREF.assetsOpenGroup, null);
  const toggleGroup = (name: string) => setOpenGroup((g) => (g === name ? null : name));
  const navigate = useNavigate();
  const { products: library } = useBrand();
  const createAsset = useCreateAsset();
  const { demoProducts } = useAppData();
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
  // Search the structured metadata, not just the label. These lists used to
  // match on `name` alone, which is exactly the case a short display name
  // would have made worse.
  const fProducts = products.filter((p) => match(productSearchText(p)));
  const fSamples = demoProducts.filter((p) => match(productSearchText(p)));
  const fPresenters = presenters.filter((p) => match(`${p.name} ${p.descriptor ?? ''}`));
  const fTemplates = templates.filter((t) => match(sceneSearchText(t)));
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
        <button
          type="button"
          className="sc-aadd"
          title="Add product"
          aria-label="Add product"
          onClick={() => createAsset('product')}
        >
          <Plus size={10} />
        </button>
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
            return (
              <AssetCard
                key={p.id}
                title={productLabel(p, 'tooltip')}
                onClick={() => onProduct(p.id)}
                thumb={thumb}
                label={productLabel(p, 'card')}
              />
            );
          }
          return (
            <button type="button" key={p.id} title={productLabel(p, 'tooltip')} onClick={() => onProduct(p.id)}>
              {thumb}
            </button>
          );
        })
      }
      items={fProducts}
    />
  );

  /**
   * The sample products ship with scenri and every homepage example is built
   * from one. They used to disappear the moment a brand had a catalog of its
   * own (`library.length ? library : ...`), which left "Recreate this" pasting
   * a product chip the panel could not show, find or swap.
   *
   * So they get their own group rather than competing for the Products list:
   * the brand's own products still lead and are still what you reach for, and
   * the label makes it impossible to ship one into client work by accident.
   */
  const samplesGroup = (
    <Group
      key="Scenri library"
      name="Scenri library"
      count={fSamples.length}
      searching={searching}
      openGroup={openGroup}
      onToggle={toggleGroup}
      empty="No sample matches."
      note="Ships with scenri. Used by the homepage examples."
      render={(shown, mode) =>
        shown.map((p: any) => {
          const thumb = p.previewUrl ? (
            <img src={p.previewUrl} alt={p.name} loading="lazy" />
          ) : (
            <span className="sc-aswatch" style={{ display: 'grid', placeItems: 'center' }}>
              <ImageSquare size={14} />
            </span>
          );
          if (mode === 'open') {
            return (
              <AssetCard
                key={p.id}
                title={productLabel(p, 'tooltip')}
                onClick={() => onProduct(p.id)}
                thumb={thumb}
                label={productLabel(p, 'card')}
              />
            );
          }
          return (
            <button type="button" key={p.id} title={productLabel(p, 'tooltip')} onClick={() => onProduct(p.id)}>
              {thumb}
            </button>
          );
        })
      }
      items={fSamples}
    />
  );

  const presentersGroup = (
    <Group
      key="Presenters"
      name="Presenters"
      count={fPresenters.length}
      searching={searching}
      openGroup={openGroup}
      onToggle={toggleGroup}
      action={
        <button
          type="button"
          className="sc-aadd"
          title="Browse the presenter library"
          aria-label="Browse the presenter library"
          onClick={() => navigate(presentersPath(brand))}
        >
          <CaretRight size={10} />
        </button>
      }
      empty={q ? 'Nobody matches.' : 'No presenters yet. Browse the library to attach one.'}
      note="Click to attach. Same person every time."
      items={fPresenters}
      render={(shown, mode) =>
        shown.map((p: Presenter) => {
          // .sc-acard-thumb is aspect-ratio: 1 with object-fit: cover, which
          // crops ~70px off the top of the 4:5 thumbnail — exactly the head.
          const src = p.avatarUrl ?? p.previewUrl;
          const thumb = src ? (
            <img src={src} alt={p.name} loading="lazy" />
          ) : (
            <span className="sc-aswatch" style={{ display: 'grid', placeItems: 'center' }}>
              <ImageSquare size={14} />
            </span>
          );
          if (mode === 'open') {
            return (
              <AssetCard key={p.id} title={p.name} onClick={() => onCharacter(p.id)} thumb={thumb} label={p.name} />
            );
          }
          return (
            <button type="button" key={p.id} title={p.name} onClick={() => onCharacter(p.id)}>
              {thumb}
            </button>
          );
        })
      }
    />
  );

  const scenesGroup =
    fTemplates.length > 0 ? (
      <Group
        key="Scenes"
        name="Scenes"
        count={fTemplates.length}
        searching={searching}
        openGroup={openGroup}
        onToggle={toggleGroup}
        items={fTemplates}
        render={(shown, mode) =>
          shown.map((t: Scene) => {
            const thumb = t.previewUrl ? (
              <img src={t.previewUrl} alt={t.name} loading="lazy" />
            ) : (
              <span className="sc-aswatch" style={{ display: 'grid', placeItems: 'center' }}>
                <ImageSquare size={14} />
              </span>
            );
            if (mode === 'open') {
              return (
                <AssetCard
                  key={t.id}
                  title={sceneLabel(t, 'tooltip')}
                  onClick={() => onTemplate(t.id)}
                  thumb={thumb}
                  label={sceneLabel(t, 'card')}
                />
              );
            }
            return (
              <button type="button" key={t.id} title={sceneLabel(t, 'tooltip')} onClick={() => onTemplate(t.id)}>
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
      {samplesGroup}
      {presentersGroup}
      {scenesGroup}
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
    <button type="button" className="sc-acard" aria-label={title} onClick={onClick}>
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
