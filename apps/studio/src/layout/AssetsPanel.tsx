import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { BookmarkSimple, CaretDown, Check, ImageSquare, MagnifyingGlass, Plus, X } from '@phosphor-icons/react';
import { api, imgUrl, type Brand, type TreeNode } from '../api.js';
import { useAppData } from '../app/AppShell.js';
import { appendColor, flattenPalette, nextHex, removeColor } from '../brand/palette.js';
import { useCreateAsset } from '../create/AssetCreateHost.js';
import { bookmarkedScenes } from '../bookmarks.js';
import { failureToast } from '../failure.js';
import { matchesQuery } from './library/libraryRules.js';
import {
  buildCandidates,
  filterCandidates,
  pickList,
  type Candidate,
  type IngredientKind,
} from '../composer/ingredientOptions.js';
import { useIngredientCatalog } from '../composer/useIngredientCatalog.js';
import { PREF, useSessionPref } from '../prefs.js';
import { useToasts } from '../toasts.js';
import { ColorPicker } from './ColorPicker.js';
import {
  NO_ATTACHMENTS,
  RAIL_BATCH,
  RAIL_COMPACT,
  RAIL_EXPANDED,
  railSlice,
  type AttachedIds,
} from './railSections.js';

/** The last shots, offered as style references. Not a history; a shelf. */
const RECENT_SHOTS = 12;

/** Matches the content fade in tokens.css. See `useShape`. */
const FADE_MS = 130;

/**
 * The creative-ingredients palette: what are we photographing, who appears,
 * where does it live.
 *
 * Three sections, one grammar. Each shows what this brand owns first and what
 * scenri ships after it, in one list — because they are the same kind of
 * thing, and which shelf a product came off is not the question you are asking
 * while composing. It used to lead with "Products" and "Scenri library" as two
 * top-level concepts, which made ownership look like a type and left every own
 * asset ranked below a suggestion.
 *
 * This is a glance and a click, not a browser. Five tiles and a way through to
 * the real library — the pages with search, facets and density — rather than a
 * second, worse copy of them in a 320px column. Everything here inserts
 * straight into the brief; nothing here manages anything.
 */
export function AssetsPanel({
  brand,
  shots,
  attached = NO_ATTACHMENTS,
  onProduct,
  onCharacter,
  onColor,
  onRef,
  onTemplate,
  onClose,
}: {
  brand: Brand;
  shots: TreeNode[];
  /** What the brief holds right now, so the rail can say so. */
  attached?: AttachedIds;
  onProduct: (id: string) => void;
  onCharacter: (id: string) => void;
  onColor: (hex: string, name?: string) => void;
  onRef: (imageHash: string) => void;
  onTemplate: (id: string) => void;
  /** Drawer mode close (shown under 1280px only). */
  onClose: () => void;
}) {
  const catalog = useIngredientCatalog();
  const createAsset = useCreateAsset();
  const { applyBrand } = useAppData();
  const { push } = useToasts();
  /**
   * Which single section is opened out, if any.
   *
   * One at a time, because the column has one pool of leftover height and this
   * is what spends it: the open section claims what the closed ones are not
   * using, and they keep their quick rows and settle around it. Two open at
   * once would be two claims on the same space and the rail would start
   * scrolling, which is the thing this shape exists to avoid.
   */
  const [expanded, setExpanded] = useSessionPref<string | null>(PREF.assetsExpanded, null);
  const toggle = (key: string) => setExpanded((cur) => (cur === key ? null : key));
  /**
   * Search over this rail and nothing else.
   *
   * Deliberately not persisted and deliberately not in the URL: it is a way of
   * reaching one asset in a shelf of six hundred, not a place you were. It
   * matches through `filterCandidates`, which is the library pages' own
   * matcher — accent-folded and plural-stemmed — so `rosé` and `serums` find
   * here exactly what they find everywhere else.
   */
  const [q, setQ] = useState('');
  const searching = q.trim().length > 0;
  /**
   * Open this section and only this one, after something was just added to it.
   *
   * Search overrules expand — every match already draws as open — so a live
   * query would hide the new tile if it did not match, and would keep every
   * other section claiming height. Clear it. `toggle` would shut a section
   * that was already open, which is the opposite of showing what you made.
   */
  const reveal = (key: string) => {
    setQ('');
    setExpanded(key);
  };

  /**
   * Idle until something is open; then that one is open and the rest stand
   * down. A live query overrules all of it: every section shows what it found,
   * because a match hidden behind a header nobody opened reads as the search
   * being broken.
   */
  const modeOf = (key: string): SectionMode =>
    searching ? 'result' : expanded === null ? 'idle' : expanded === key ? 'open' : 'collapsed';

  const bookmarked = useMemo(() => new Set(bookmarkedScenes(brand.id)), [brand.id]);

  /**
   * One ranked list per kind — yours lifted above scenri's, taste and
   * suitability ordering what is left. `pickList` is the composer's own
   * ranking, so the rail and the chip picker can never offer two different
   * "best first".
   *
   * `currentId: null` on purpose: the picker pulls the attached item out into
   * a header row of its own, and the rail wants it left in the grid where it
   * can be seen and un-ticked.
   */
  const ranked = useMemo(() => {
    const of = (kind: IngredientKind): Candidate[] => {
      const all = buildCandidates(kind, catalog);
      return pickList(kind, all, { currentId: null, query: '', bookmarked, shown: all.length }).items;
    };
    return { product: of('product'), presenter: of('presenter'), scene: of('scene') };
  }, [catalog, bookmarked]);

  const found = useMemo(
    () => ({
      product: filterCandidates(ranked.product, q),
      presenter: filterCandidates(ranked.presenter, q),
      scene: filterCandidates(ranked.scene, q),
    }),
    [ranked, q],
  );

  const palette = useMemo(() => flattenPalette(brand.json?.palette), [brand]);

  const shownPalette = useMemo(
    () => (searching ? palette.filter((c) => matchesQuery(`${c.name} ${c.hex}`, q)) : palette),
    [palette, q, searching],
  );

  const addColour = (hex: string) => {
    void (async () => {
      const result = appendColor(brand.json?.palette, hex);
      if (!result.swatch) return;
      if (result.added) {
        try {
          const row = await api.updateBrand(brand.id, {
            ...(brand.json ?? {}),
            palette: result.palette,
          });
          applyBrand(row);
        } catch (e) {
          push(failureToast(e, 'Could not save the brand'));
          return;
        }
      }
      // The plus writes the kit. The swatch is what drops a chip in the brief
      // — same as every other rail tile. Committing here is what made a
      // cancelled or already-known colour land in the composer anyway.
      reveal('colors');
    })();
  };

  const dropColour = (hex: string) => {
    void (async () => {
      const result = removeColor(brand.json?.palette, hex);
      if (!result.removed) return;
      try {
        const row = await api.updateBrand(brand.id, {
          ...(brand.json ?? {}),
          palette: result.palette,
        });
        applyBrand(row);
      } catch (e) {
        push(failureToast(e, 'Could not save the brand'));
      }
    })();
  };

  const recent = shots
    .filter((s) => s.status === 'done' && s.images.length > 0)
    .slice(-RECENT_SHOTS)
    .reverse();

  /** Nothing in the rail answered. Said once, rather than five times over. */
  const nothingFound =
    searching && !found.product.length && !found.presenter.length && !found.scene.length && !shownPalette.length;

  return (
    <aside className="sc-assets" aria-label="Assets">
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

      {/* Always open, never a collapse-to-icon puck: this column is 320px of
          dedicated space, and a control that has to be found before it can be
          used is the wrong trade at the one place you come to *find* things.
          Its own field rather than the toolbar's `LibrarySearch`, which is
          built to collapse inside a filter bar and carries global rules that
          misbehave in a new host. The matching is shared; the chrome is not. */}
      <div className="sc-assets-searchbar">
        <div className="sc-assets-search">
          <MagnifyingGlass size={12} />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && q) {
                e.stopPropagation();
                setQ('');
              }
            }}
            placeholder="Search assets"
            aria-label="Search assets in this panel"
          />
          {searching && (
            <button type="button" className="sc-assets-clear" onClick={() => setQ('')} aria-label="Clear search">
              <X size={11} />
            </button>
          )}
        </div>
      </div>

      {nothingFound && <p className="sc-assets-zero">Nothing here matches “{q.trim()}”.</p>}

      <Section
        kind="product"
        title="Products"
        items={found.product}
        attached={attached.product}
        mode={modeOf('product')}
        onToggle={toggle}
        onPick={onProduct}
        moreLabel="products"
        createLabel="Add product"
        onCreate={() =>
          createAsset('product', {
            onCreated: (made) => {
              // A product is written synchronously, so it can go straight into
              // the brief. Presenters and scenes are build jobs; their tile
              // appears in the section when the build lands.
              if (made.kind === 'product') {
                reveal('product');
                onProduct(made.id);
              }
            },
          })
        }
      />

      <Section
        kind="presenter"
        title="Presenters"
        items={found.presenter}
        attached={attached.presenter}
        mode={modeOf('presenter')}
        onToggle={toggle}
        onPick={onCharacter}
        moreLabel="presenters"
        createLabel="Create presenter"
        onCreate={() =>
          createAsset('presenter', {
            onCreated: (made) => {
              if (made.kind === 'presenter') reveal('presenter');
            },
          })
        }
      />

      <Section
        kind="scene"
        title="Scenes"
        items={found.scene}
        attached={attached.scene ? [attached.scene] : []}
        mode={modeOf('scene')}
        onToggle={toggle}
        onPick={onTemplate}
        moreLabel="scenes"
        createLabel="Create scene"
        onCreate={() =>
          createAsset('scene', {
            onCreated: (made) => {
              if (made.kind === 'scene') reveal('scene');
            },
          })
        }
      />

      {/* Colours are ingredients too — a brief carries them as chips exactly
          the way it carries a product. The plus writes the kit (not a catalog
          object); the swatch is the insert, the same as every other tile.
          Hidden only when a search turned nothing up. */}
      {!(searching && shownPalette.length === 0) && (
        <Group
          name="Brand colors"
          count={shownPalette.length}
          mode={modeOf('colors')}
          onToggle={() => toggle('colors')}
          action={
            <ColorPicker
              className="sc-aadd"
              triggerStyle={{ background: 'none' }}
              value={nextHex(palette)}
              presets={palette.map((c) => c.hex)}
              commitMode="close"
              align="end"
              label="Add colour"
              onChange={addColour}
            >
              <Plus size={10} />
            </ColorPicker>
          }
        >
          {(shape) => (
            <div className="sc-arow">
              {(shape === 'open' ? shownPalette : shownPalette.slice(0, RAIL_COMPACT)).map((c) => (
                <div key={c.hex} className="sc-aswatch-tile">
                  <button
                    type="button"
                    title={`${c.name} ${c.hex}`}
                    onClick={() => onColor(c.hex, c.name)}
                  >
                    <span className="sc-aswatch" style={{ background: c.hex }} />
                  </button>
                  {shape === 'open' && (
                    <button
                      type="button"
                      className="sc-aswatch-x"
                      aria-label={`Remove ${c.name}`}
                      title="Remove"
                      onClick={() => dropColour(c.hex)}
                    >
                      <X size={10} weight="bold" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </Group>
      )}

      {recent.length > 0 && !searching && (
        <Group name="Recent shots" count={recent.length} mode={modeOf('shots')} onToggle={() => toggle('shots')}>
          {(shape) => (
            <div className="sc-arow">
              {(shape === 'open' ? recent : recent.slice(0, RAIL_COMPACT)).map((s) => (
                <button type="button" key={s.id} title="Attach as a style reference" onClick={() => onRef(s.images[0])}>
                  <img src={imgUrl(s.images[0])} alt="" loading="lazy" />
                </button>
              ))}
            </div>
          )}
        </Group>
      )}
    </aside>
  );
}

/**
 * One ingredient section, in one of two shapes.
 *
 * Closed — which is how every section starts — it is a single row of four
 * square thumbnails: the quick pick, no labels, no chrome, the whole panel
 * legible in one glance without a click. Open, the same assets are drawn
 * larger and named, three across, with the way through to the full library in
 * the last cell.
 *
 * Neither shape scrolls. A brand with six hundred products draws the same
 * cells as a brand with six, which is what keeps this column calm and why
 * there is no pagination, no sentinel and no second scroll container in it.
 */
function Section({
  kind,
  title,
  items,
  attached,
  mode,
  onToggle,
  onPick,
  moreLabel,
  createLabel,
  onCreate,
}: {
  kind: IngredientKind;
  title: string;
  items: Candidate[];
  attached: string[];
  mode: SectionMode;
  onToggle: (key: string) => void;
  onPick: (id: string) => void;
  moreLabel: string;
  createLabel: string;
  onCreate: () => void;
}) {
  const on = useMemo(() => new Set(attached), [attached]);
  const [shown, setShown] = useState(RAIL_EXPANDED);
  // A section you closed and reopened starts at the top again. Coming back to
  // find four hundred tiles still unrolled from ten minutes ago is a section
  // that remembers something nobody asked it to.
  useEffect(() => {
    if (mode !== 'open') setShown(RAIL_EXPANDED);
  }, [mode]);

  // A search that turned nothing up in this kind takes the whole section with
  // it. A row of headings over five empty shelves is a worse answer than one
  // sentence saying so.
  if (mode === 'result' && items.length === 0) return null;

  return (
    <Group
      name={title}
      count={items.length}
      mode={mode}
      onToggle={() => onToggle(kind)}
      action={
        <button type="button" className="sc-aadd" title={createLabel} aria-label={createLabel} onClick={onCreate}>
          <Plus size={10} />
        </button>
      }
    >
      {(shape) => {
        const { visible, more } = railSlice(items, on, shape === 'open' ? shown : RAIL_COMPACT);
        return (
          <div className={shape === 'open' ? 'sc-acard-grid' : 'sc-arow'}>
            {visible.map((c) => (
              <AssetCard
                key={c.id}
                candidate={c}
                on={on.has(c.id)}
                named={shape === 'open'}
                onClick={() => onPick(c.id)}
              />
            ))}
            {shape === 'open' && more > 0 && (
              <button
                type="button"
                className="sc-amore-tile"
                onClick={() => setShown((n) => n + RAIL_BATCH)}
                aria-label={`Show ${Math.min(more, RAIL_BATCH)} more ${moreLabel}`}
              >
                <span className="sc-amore-n">+{more}</span>
                <span className="sc-amore-t">more</span>
              </button>
            )}
          </div>
        );
      }}
    </Group>
  );
}

/** A tile. One click attaches it; there is nothing else it does. */
function AssetCard({
  candidate,
  on,
  named,
  onClick,
}: {
  candidate: Candidate;
  on: boolean;
  named: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="sc-acard"
      data-on={on || undefined}
      aria-label={candidate.full}
      aria-pressed={on}
      title={candidate.full}
      onClick={onClick}
    >
      <span className="sc-acard-thumb">
        {candidate.thumb ? (
          <img src={candidate.thumb} alt="" loading="lazy" data-crop={candidate.crop} />
        ) : (
          <span className="sc-aswatch" style={{ display: 'grid', placeItems: 'center' }}>
            <ImageSquare size={14} />
          </span>
        )}
        <span className="sc-acard-tick" aria-hidden>
          <Check size={10} weight="bold" />
        </span>
      </span>
      {named && (
        <span className="sc-acard-label">
          {candidate.bookmarked && (
            <>
              <BookmarkSimple className="sc-bm-mark" size={10} weight="fill" aria-hidden />
              <span className="sc-vh">Bookmarked. </span>
            </>
          )}
          {candidate.label}
        </span>
      )}
    </button>
  );
}

/**
 * The shape actually on screen, one fade behind the one asked for.
 *
 * The quick row and the named grid are different DOM — different cell count,
 * different columns, labels or none — so swapping them the instant the state
 * flips reads as a pop, worst of all while the section is also changing
 * height. The content fades out first, the shape swaps underneath while it is
 * invisible, then it fades back in. Reduced motion strips the fade in CSS, so
 * waiting one out there would hold an unexplained blank instead of hiding a
 * swap: it goes straight across.
 */
type Shape = 'compact' | 'open';

/**
 * What a section is doing while the column is in whatever state it is in.
 *
 * `idle` — nothing is open anywhere, so every section shows its quick row and
 * the whole shelf is readable at a glance. `open` — this one is being used, so
 * it takes the height. `collapsed` — a sibling is open, so this one gives its
 * row back and waits as a header. `result` — a search is live, so every
 * section shows what it found and the rail scrolls through the answers.
 *
 * That third mode is the point. Height in a 320px column is the scarce thing:
 * four other quick rows are 280px that the section you are actually working in
 * could be using, and they are not being looked at while you work in it.
 */
export type SectionMode = 'idle' | 'open' | 'collapsed' | 'result';

function useShape(want: Shape): Shape {
  const [shown, setShown] = useState(want);
  useEffect(() => {
    if (want === shown) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setShown(want);
      return;
    }
    const t = setTimeout(() => setShown(want), FADE_MS);
    return () => clearTimeout(t);
  }, [want, shown]);
  return shown;
}

/**
 * The shared shell: a header, and a body that changes shape under it.
 *
 * The caret is invisible until the header is hovered or focused — a disclosure
 * control that is always showing is permanent noise for something you do once
 * a section. It stays visible on touch, where there is no hover to reveal it,
 * and the header itself is the button either way, so `aria-expanded` carries
 * the state whether or not the glyph is drawn.
 */
function Group({
  name,
  count,
  mode,
  onToggle,
  action,
  children,
}: {
  name: string;
  count?: number;
  mode: SectionMode;
  onToggle: () => void;
  action?: ReactNode;
  children: (shape: Shape) => ReactNode;
}) {
  const want: Shape = mode === 'open' || mode === 'result' ? 'open' : 'compact';
  const shape = useShape(want);
  return (
    <div className="sc-agroup" data-mode={mode}>
      <div className="sc-agroup-h">
        <button type="button" className="sc-agroup-t" aria-expanded={mode === 'open'} onClick={onToggle}>
          <b>{name}</b>
          {count !== undefined && count > 0 && <span className="sc-agroup-n">{count}</span>}
          <CaretDown size={11} className="sc-agroup-caret" aria-hidden="true" />
        </button>
        {action}
      </div>
      <div className="sc-agroup-body">
        <div className="sc-agroup-content" data-fading={shape !== want || undefined}>
          {children(shape)}
        </div>
      </div>
    </div>
  );
}
