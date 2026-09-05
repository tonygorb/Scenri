import {
  useCallback,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type CSSProperties,
  type KeyboardEvent,
} from 'react';
import { MagnifyingGlass, UploadSimple, X } from '@phosphor-icons/react';
import { api, type Brand } from '../../api.js';
import { uploadLogo } from '../../apiUploads.js';
import { appendColor, flattenPalette, nextHex } from '../../brand/palette.js';
import { ColorPicker } from '../../layout/ColorPicker.js';
import { useAppData } from '../../app/AppShell.js';
import { bookmarkedScenes } from '../../bookmarks.js';
import { useCreateAsset } from '../../create/AssetCreateHost.js';
import { failureToast } from '../../failure.js';
import { VerticalsTabs } from '../../layout/VerticalsTabs.js';
import { useToasts } from '../../toasts.js';
import { PAGE, buildCandidates, filterCandidates, pickList, type IngredientKind } from '../ingredientOptions.js';
import { useIngredientCatalog } from '../useIngredientCatalog.js';
import { identityKeyOf, type SentenceToken } from '../line/tokens.js';
import { AttachTile } from './AttachTile.js';
import { SHOT_PAGE, useShotPages } from './useShotPages.js';
import {
  GROUPS,
  GROUP_LABEL,
  NAV_KEYS,
  TILE_MIN,
  TILE_MIN_PHONE,
  columnsFor,
  emptyCopy,
  extraCards,
  fromCandidate,
  matchesCard,
  shotCards,
  stepIndex,
  tabItems,
  type AttachCard,
  type AttachGroup,
  type AttachTab,
  type NavGroup,
  type NavKey,
} from './attachRules.js';

export interface AttachBodyProps {
  brand: Brand;
  tab: AttachTab;
  onTab: (tab: AttachTab) => void;
  /** The category of whichever product is already in the brief, if any: feeds the "suited" hint. */
  activeProductCategory?: string | null;
  /** A refine is armed on the hub: scenes sit out, and the hint says how to use one. */
  refining?: boolean;
  /** The shot holds as many identities as one takes: every identity tile sits out with this sentence. */
  full?: string | null;
  /** What the shot already holds, by identity key: those tiles wear a tick. */
  attached: ReadonlySet<string>;
  /** A phone: bigger tiles, fewer across. */
  phone: boolean;
  /** A thumb, not a mouse: a pick must not leave the brief focused, or the keyboard rises over the panel. */
  touch: boolean;
  onPick: (card: AttachCard) => void;
  /** A ticked tile pressed again: take the chip back out of the shot. */
  onRemove: (card: AttachCard) => void;
  onUpload: () => void;
  /** Image files pasted while the picker has focus: the same door as Upload image. */
  onFiles: (files: FileList) => void;
  onClose: () => void;
}

const KIND_OF: Partial<Record<AttachGroup, IngredientKind>> = {
  Products: 'product',
  Presenters: 'presenter',
  Scenes: 'scene',
};

interface GroupList {
  group: AttachGroup;
  items: AttachCard[];
  total: number;
  remaining: number;
}

/**
 * Everything inside either shell: the action row (search, Upload image,
 * close), the category rail, and the one scrolling grid. The desktop panel
 * and the phone sheet give it a box and nothing else, so the picker is
 * learned once.
 *
 * Products, presenters and scenes come through `pickList`, the same rank,
 * search and paging the caret menus and the chip picker use; the brand's
 * marks, colours and finished shots have no candidate model and are matched
 * with the library rule directly. Nothing here depends on the callbacks, so
 * a keystroke in the brief behind the panel rebuilds no list.
 */
export function AttachBody({
  brand,
  tab,
  onTab,
  activeProductCategory,
  refining,
  full,
  attached,
  phone,
  touch,
  onPick,
  onRemove,
  onUpload,
  onFiles,
  onClose,
}: AttachBodyProps) {
  const catalog = useIngredientCatalog(activeProductCategory);
  const bookmarked = useMemo<ReadonlySet<string>>(() => new Set(bookmarkedScenes(brand.id)), [brand.id]);
  const createAsset = useCreateAsset();
  const { applyBrand } = useAppData();
  const { push } = useToasts();
  const [logoBusy, setLogoBusy] = useState(false);

  const [q, setQ] = useState('');
  const query = useDeferredValue(q);
  const [shown, setShown] = useState(PAGE);
  const [active, setActive] = useState(0);
  const [width, setWidth] = useState(phone ? 347 : 696);
  const searchRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  // A new tab or a new search is a new list: page one, first tile.
  useEffect(() => {
    setShown(PAGE);
    setActive(0);
  }, [tab, query]);

  // How many tiles fit across, for the one-row groups on All. Measured from
  // the body, predicted with the same numbers the grid's `minmax` reads.
  useLayoutEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const measure = () => setWidth(el.clientWidth - 2 * inset(el));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const candidates = useMemo(
    () => ({
      product: buildCandidates('product', catalog),
      presenter: buildCandidates('presenter', catalog),
      scene: buildCandidates('scene', catalog),
    }),
    [catalog],
  );
  const extras = useMemo(() => extraCards(brand.json), [brand.json]);
  // Every finished shot, newest first, searched on the server: the shelf the
  // workspace carries for the rail stops at forty-eight.
  const shots = useShotPages(brand.id, query);
  const shotItems = useMemo(() => shotCards(shots.items, shots.total), [shots.items, shots.total]);

  /** Every group's size under the current search, for the rail. */
  const counts = useMemo(() => {
    const out = {} as Record<AttachGroup, number>;
    for (const g of GROUPS) {
      const kind = KIND_OF[g];
      out[g] =
        g === 'Shots'
          ? shots.total
          : kind
            ? filterCandidates(candidates[kind], query).length
            : extras.filter((c) => c.group === g && matchesCard(c, query)).length;
    }
    return out;
  }, [candidates, extras, query, shots.total]);

  const listFor = useCallback(
    (g: AttachGroup, limit: number): GroupList => {
      const kind = KIND_OF[g];
      if (kind) {
        const pl = pickList(kind, candidates[kind], { currentId: null, query, bookmarked, shown: limit });
        return { group: g, items: pl.items.map(fromCandidate), total: pl.total, remaining: pl.remaining };
      }
      if (g === 'Shots') {
        // paged by the server: what is not here yet is a page away, not a slice
        const items = shotItems.slice(0, limit);
        const remaining = shots.hasMore
          ? Math.max(1, shots.total - shotItems.length)
          : Math.max(0, shotItems.length - limit);
        return { group: g, items, total: shots.total, remaining };
      }
      const all = extras.filter((c) => c.group === g && matchesCard(c, query));
      return { group: g, items: all.slice(0, limit), total: all.length, remaining: Math.max(0, all.length - limit) };
    },
    [candidates, extras, query, bookmarked, shotItems, shots.hasMore, shots.total],
  );

  /**
   * What is on screen. All is a summary, one row per group and "Show all";
   * a tab is the whole group, a page at a time. A brand with a catalog import
   * has hundreds of products, and drawing every one of them on All pushed
   * Presenters, Scenes and Colours off the bottom of a panel whose whole job
   * is to show you what there is.
   */
  const lists = useMemo<GroupList[]>(() => {
    if (tab === 'All') {
      return GROUPS.map((g) => listFor(g, g === 'Colors' ? 12 : columnsFor(g, width, phone))).filter(
        (l) => l.items.length > 0,
      );
    }
    // the Shots tab pages by the server, so it draws every page it holds
    return [listFor(tab, tab === 'Shots' ? Number.MAX_SAFE_INTEGER : shown)];
  }, [tab, listFor, shown, width, phone]);

  /** Every tile in navigation order, and where each group's run starts and ends. */
  const { flat, navGroups } = useMemo(() => {
    const flat: AttachCard[] = [];
    const navGroups: NavGroup[] = [];
    for (const l of lists) {
      if (!l.items.length) continue;
      navGroups.push({ start: flat.length, end: flat.length + l.items.length - 1 });
      flat.push(...l.items);
    }
    return { flat, navGroups };
  }, [lists]);

  // Clamped rather than reset: a poll that drops one card should not throw the
  // keyboard back to the top of the list.
  useEffect(() => {
    setActive((a) => Math.max(0, Math.min(a, flat.length - 1)));
  }, [flat.length]);

  const focusTile = useCallback((i: number) => {
    const el = bodyRef.current?.querySelector<HTMLElement>(`[data-nav="${i}"]`);
    if (!el) return;
    setActive(i);
    el.focus({ preventScroll: true });
    el.scrollIntoView({ block: 'nearest' });
  }, []);

  // One press per tile: in the shot already, it comes out; otherwise it goes in.
  const pickIndex = useCallback(
    (i: number) => {
      const card = flat[i];
      if (!card) return;
      if (attached.has(card.key)) onRemove(card);
      else onPick(card);
      // Placing the caret beside the new chip focuses the brief, which on a
      // touch screen raises the keyboard over the panel after every tap. The
      // caret is remembered; the brief waits to be tapped.
      if (touch) (document.activeElement as HTMLElement | null)?.blur?.();
    },
    [flat, attached, touch, onPick, onRemove],
  );

  const onPaste = (e: ClipboardEvent<HTMLDivElement>) => {
    const files = e.clipboardData.files;
    if (!files.length || !Array.from(files).some((f) => f.type.startsWith('image/'))) return;
    e.preventDefault();
    onFiles(files);
  };

  /**
   * Bound to the body, never to `window`. Every key it answers stops here:
   * the shot overlay walks its shots on the same arrows and closes on the
   * same Escape, and a picker opened from the overlay's own composer must
   * not move the shot behind it. The rail routes its own arrows and the
   * search field keeps its text keys; both still stop the key from leaving.
   */
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      // a search with text in it: the first Escape clears, the next one closes
      if (target === searchRef.current && q) setQ('');
      else onClose();
      return;
    }
    if (target === searchRef.current) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        e.stopPropagation();
        focusTile(0);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        // Type three letters, press Enter. The whole point of a search field
        // over a grid you were going to arrow through anyway.
        pickIndex(0);
      }
      return;
    }
    if (!NAV_KEYS.has(e.key)) return;
    e.stopPropagation();
    if (target.closest('[role="tablist"]')) return;
    const tile = target.closest<HTMLElement>('[data-nav]');
    if (!tile) return;
    e.preventDefault();
    const next = stepIndex(active, e.key as NavKey, columnsOf(tile.closest('.sc-ap-grid')), navGroups);
    if (next === 'search') searchRef.current?.focus();
    else if (next != null) focusTile(next);
  };

  /**
   * The declared-intent channel for a logo. A logo dragged into the composer
   * lands as a plain reference, and a reference logotype is deliberately
   * treated as mood, which is exactly how testers' logos came back
   * fictionalised. This action mints a real kit mark through the same route
   * Settings uses (first mark becomes THE logo, later ones variants) and
   * drops the chip in, so the compiler's whole mark contract applies.
   */
  const addLogo = async (file: File) => {
    setLogoBusy(true);
    try {
      const row = await uploadLogo(brand.id, file);
      applyBrand(row);
      const hash = (row as { logoHash?: string }).logoHash;
      if (hash)
        onPick({
          key: `m:${hash}`,
          group: 'Brand',
          shape: 'square',
          label: 'Logo',
          full: 'Logo',
          search: '',
          token: { t: 'mark', imageHash: hash },
        });
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

  /**
   * Make a new one from here. A product is written the moment the flow
   * finishes, so its chip goes straight into a brief that is still in memory
   * (the one caller that genuinely needs an answer back; a URL round-trip
   * would remount the composer under it). A presenter or a scene is a build
   * the flow starts: the tab is the place to watch, and the tile arrives
   * when the build lands, announced by the bell.
   */
  const create = (kind: 'product' | 'presenter' | 'scene') =>
    createAsset(kind, {
      onCreated: (made) => {
        if (made.kind !== kind) return;
        if (made.kind === 'product') {
          const token: SentenceToken = { t: 'product', id: made.id };
          onPick({
            key: identityKeyOf(token),
            group: 'Products',
            shape: 'square',
            label: 'Product',
            full: '',
            search: '',
            token,
          });
          return;
        }
        onTab(made.kind === 'presenter' ? 'Presenters' : 'Scenes');
      },
    });

  /**
   * A colour is the one thing made in place: pick it, it joins the kit through
   * the same route the rail's plus uses, and the chip drops in. An already
   * known colour is not written twice, and a cancelled pick writes nothing.
   */
  const addColour = async (hex: string) => {
    const result = appendColor(brand.json?.palette, hex);
    if (!result.swatch) return;
    if (result.added) {
      try {
        const row = await api.updateBrand(brand.id, { ...(brand.json ?? {}), palette: result.palette });
        applyBrand(row);
      } catch (e) {
        push(failureToast(e, 'Could not save the brand'));
        return;
      }
    }
    const token: SentenceToken = { t: 'color', hex: result.swatch.hex, name: result.swatch.name };
    onPick({
      key: identityKeyOf(token),
      group: 'Colors',
      shape: 'swatch',
      label: result.swatch.name,
      full: '',
      search: '',
      swatch: result.swatch.hex,
      token,
    });
  };

  /** Two reasons a tile sits out, one way of sitting out. A colour never does. */
  const whyFor = (g: AttachGroup): string | null =>
    refining && g === 'Scenes'
      ? 'Scenes set up a new shot. Press X on Refining to use one.'
      : full && g !== 'Colors'
        ? full
        : null;

  const empty = flat.length === 0;
  let nav = 0;

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: a key router, not a control
    <div className="sc-ap-inner" onKeyDown={onKeyDown} onPaste={onPaste}>
      <div className="sc-ap-head">
        <div className="sc-ap-actions">
          <label className="sc-ap-search">
            <MagnifyingGlass size={14} aria-hidden />
            <input
              ref={searchRef}
              type="text"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search"
              aria-label="Search"
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          {/* The one way to bring your own picture in, said in words: it used
              to be a 12px glyph beside the close button, which is how one of
              the composer's most important actions went unfound. */}
          <button
            type="button"
            className="sc-btn sc-btn-ghost sc-ap-upload"
            onClick={onUpload}
            title="Add an image from your computer. It joins the shot as a reference."
          >
            <UploadSimple size={14} aria-hidden />
            <span>Upload image</span>
          </button>
          <button type="button" className="sc-icon-btn sc-ap-close" onClick={onClose} aria-label="Close">
            <X size={14} />
          </button>
        </div>
        <div className="sc-ap-tabs">
          <VerticalsTabs
            aria-label="What to add"
            activeKey={tab === 'All' ? null : tab}
            items={tabItems(counts)}
            onSelect={(v) => onTab((v ?? 'All') as AttachTab)}
          />
        </div>
      </div>

      <div className="sc-ap-body" ref={bodyRef}>
        {refining && tab === 'Scenes' && (
          <p className="sc-ap-hint">
            Scenes set up a new shot, so they sit out while you are refining. Press X on Refining to use one.
          </p>
        )}
        {lists.map((l) => {
          const why = whyFor(l.group);
          const start = nav;
          nav += l.items.length;
          const kind = KIND_OF[l.group];
          const min = (phone ? TILE_MIN_PHONE : TILE_MIN)[l.group];
          const style = { '--ap-min': `${min}px`, '--ap-lines': kind === 'product' ? 2 : 1 } as CSSProperties;
          return (
            <section key={l.group} className="sc-ap-group" aria-label={GROUP_LABEL[l.group]}>
              {/* The group's row, the same two slots everywhere: its name and
                  count leading, one action trailing. On All that action is the
                  rest of the group; on a tab it is the tab's own way to make
                  one. An action with no title beside it read as a stray. */}
              <div className="sc-ap-sec">
                <span className="sc-ap-sec-title">
                  {GROUP_LABEL[l.group]}
                  <span className="sc-ap-sec-n">{l.total}</span>
                </span>
                {tab === 'All' && l.total > l.items.length && (
                  <button type="button" className="sc-ap-sec-act" onClick={() => onTab(l.group)}>
                    Show all {l.total}
                  </button>
                )}
                {tab === 'Products' && (
                  <button type="button" className="sc-ap-sec-act sc-ap-add" onClick={() => create('product')}>
                    Add product
                  </button>
                )}
                {tab === 'Presenters' && (
                  <button type="button" className="sc-ap-sec-act sc-ap-add" onClick={() => create('presenter')}>
                    Create presenter
                  </button>
                )}
                {tab === 'Scenes' && (
                  <button type="button" className="sc-ap-sec-act sc-ap-add" onClick={() => create('scene')}>
                    Create scene
                  </button>
                )}
                {tab === 'Colors' && (
                  <ColorPicker
                    className="sc-ap-sec-act sc-ap-add"
                    triggerStyle={{ background: 'none' }}
                    value={nextHex(flattenPalette(brand.json?.palette))}
                    presets={flattenPalette(brand.json?.palette).map((c) => c.hex)}
                    commitMode="close"
                    align="end"
                    label="Add color"
                    onChange={(hex) => void addColour(hex)}
                  >
                    Add color
                  </ColorPicker>
                )}
                {tab === 'Brand' && (
                  // A label over a hidden input, the same gesture BrandIdentity's
                  // variant-add uses: one click, a file, and the mark is in the
                  // kit AND in the brief.
                  <label
                    className="sc-ap-sec-act sc-ap-add"
                    title="Add your logo to the brand kit"
                    data-busy={logoBusy || undefined}
                  >
                    <input
                      type="file"
                      accept="image/*"
                      // visually hidden, not `hidden`: the input is what the keyboard reaches, and Enter on it opens the file dialog
                      className="sc-vh"
                      disabled={logoBusy}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        e.target.value = '';
                        if (file) void addLogo(file);
                      }}
                    />
                    Add logo
                  </label>
                )}
              </div>
              <div className="sc-ap-grid" data-shape={l.items[0]?.shape ?? 'square'} style={style}>
                {l.items.map((card, i) => (
                  <AttachTile
                    key={card.key}
                    card={card}
                    index={start + i}
                    active={start + i === active}
                    ticked={attached.has(card.key)}
                    why={why}
                    onPick={pickIndex}
                    onFocus={setActive}
                  />
                ))}
              </div>
              {tab !== 'All' && l.remaining > 0 && (
                <button
                  type="button"
                  className="sc-ap-more"
                  disabled={l.group === 'Shots' && shots.loading}
                  onClick={() => (l.group === 'Shots' ? shots.loadMore() : setShown((n) => n + PAGE))}
                >
                  {/* Never a silent truncation: say what is not on screen. */}
                  Show {Math.min(l.group === 'Shots' ? SHOT_PAGE : PAGE, l.remaining)} more of {l.total}
                </button>
              )}
            </section>
          );
        })}
        {tab === 'Shots' && shots.error && <p className="sc-ap-empty">Could not load the shots. {shots.error}</p>}
        {empty && !(tab === 'Shots' && (shots.loading || shots.error)) && (
          <p className="sc-ap-empty">{emptyCopy(tab, q)}</p>
        )}
      </div>
    </div>
  );
}

/** With `auto-fill` the column count is whatever fitted, so ask the layout. */
function columnsOf(grid: Element | null): number {
  if (!grid) return 1;
  return Math.max(1, getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean).length);
}

/** The body's horizontal padding, so the measured width is the grid's own. */
function inset(el: HTMLElement): number {
  return Number.parseFloat(getComputedStyle(el).paddingLeft) || 0;
}
