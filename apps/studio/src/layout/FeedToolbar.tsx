import { DropdownMenu } from '@radix-ui/themes';
import { ArrowsDownUp, CaretDown, FolderSimple, SidebarSimple } from '@phosphor-icons/react';
import type { ShotSet } from '../api.js';
import { FEED_SORTS, LENSES, type FeedSort, type Lens } from '../feedRules.js';
import { FeedSizeControl } from './DensityControl.js';
import { LibrarySearch } from './library/LibrarySearch.js';
import { VerticalsTabs, type VerticalsTabItem } from './VerticalsTabs.js';

/**
 * One row above the feed, holding two questions and nothing else.
 *
 * WHAT AM I BROWSING sits on the left: a place (the whole brand, a set, or the
 * shots not filed into one) and a lens over it (all, keepers, archived). These
 * used to be one strip of identical tabs, which made them look like one
 * question when they are two — and worse, they fought: a set short-circuited
 * the lens in `shown`, so asking for keepers while inside a set silently threw
 * you out of the set, leaving no tab selected at all. They compose now.
 *
 * HOW DO I FIND SOMETHING sits on the right, in the order every catalog wall
 * in the app already uses: search, then size. Sort is the one thing only this
 * screen has, and it sits between them as a menu rather than as a permanent
 * label. The row used to also spend space on a result count — the tab numbers
 * carry that now, since they follow the place and the search — and on a
 * fourteen-stop width slider whose middle stops changed nothing.
 *
 * Spacing says the same thing twice: 8px between siblings on one axis, 16px
 * across an axis boundary. Nothing here draws a container to do that work.
 */
export function FeedToolbar({
  sets,
  active,
  ungrouped,
  ungroupedCount,
  onPlaceAll,
  onPlaceUngrouped,
  onOpenSet,
  onNewSet,
  lens,
  lensCounts,
  onLens,
  q,
  onQ,
  searchTotal,
  sort,
  onSort,
  tile,
  onTile,
  assets,
  onAssets,
  showAssets,
}: {
  sets: ShotSet[];
  /** The set you are inside, which is a route rather than a filter. */
  active: ShotSet | null;
  /** Hub-only place: the shots no set has claimed. */
  ungrouped: boolean;
  ungroupedCount: number;
  onPlaceAll: () => void;
  onPlaceUngrouped: () => void;
  onOpenSet: (set: ShotSet) => void;
  onNewSet: () => void;
  lens: Lens;
  lensCounts: Record<Lens, number>;
  onLens: (l: Lens) => void;
  q: string;
  onQ: (q: string) => void;
  /** How many shots the search is over (pre-search), for the placeholder. */
  searchTotal: number;
  sort: FeedSort;
  onSort: (s: FeedSort) => void;
  tile: number;
  onTile: (px: number) => void;
  /** The assets rail's switch, on the screens where the rail exists. */
  assets: boolean;
  onAssets: () => void;
  showAssets: boolean;
}) {
  const placeValue = active ? active.id : ungrouped ? '__ungrouped__' : '__all__';
  const placeLabel = active ? active.name : ungrouped ? 'Not in a set' : 'Sets';
  const somewhere = Boolean(active) || ungrouped;

  const lensItems: VerticalsTabItem[] = LENSES.map((l) => ({
    value: l.id === 'all' ? null : l.id,
    label: l.label,
    count: lensCounts[l.id],
  }));

  return (
    <div className="sc-toolbar">
      <div className="sc-toolbar-scope">
        {/* A place is somewhere you can be, so this is a list of places and
              the one you are in carries the tick — not a filter chip. */}
        <DropdownMenu.Root>
          <DropdownMenu.Trigger>
            <button type="button" className="sc-toolbar-btn" data-on={somewhere || undefined} aria-label={placeLabel}>
              <FolderSimple size={14} />
              <span className="sc-toolbar-btn-t">{placeLabel}</span>
              {!somewhere && sets.length > 0 && <span className="sc-toolbar-btn-n">{sets.length}</span>}
              <CaretDown size={10} />
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Content align="start">
            <DropdownMenu.RadioGroup value={placeValue}>
              <DropdownMenu.RadioItem value="__all__" onSelect={onPlaceAll}>
                All shots
              </DropdownMenu.RadioItem>
              {/* Was a fourth lens tab, which put a set-filing chore next to
                    the two lenses people look through every day. It answers
                    "which pile", so it belongs with the piles. */}
              <DropdownMenu.RadioItem value="__ungrouped__" onSelect={onPlaceUngrouped}>
                Not in a set{ungroupedCount > 0 ? ` · ${ungroupedCount}` : ''}
              </DropdownMenu.RadioItem>
              {sets.length > 0 && <DropdownMenu.Separator />}
              {sets.map((s) => (
                <DropdownMenu.RadioItem key={s.id} value={s.id} onSelect={() => onOpenSet(s)}>
                  {s.name}
                </DropdownMenu.RadioItem>
              ))}
            </DropdownMenu.RadioGroup>
            <DropdownMenu.Separator />
            <DropdownMenu.Item onSelect={onNewSet}>New set</DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Root>

        {/* Counts follow the place and the search, so the row needs no
              separate "N shots": the tab you are on already says it. */}
        <VerticalsTabs
          aria-label="Shot lenses"
          activeKey={lens === 'all' ? null : lens}
          items={lensItems}
          onSelect={(value) => onLens((value ?? 'all') as Lens)}
        />
      </div>

      <div className="sc-toolbar-actions">
        <LibrarySearch value={q} onChange={onQ} noun="shots" total={searchTotal} />

        {/* Sort is the only control here that no other wall in the app has,
              so it takes a menu rather than a permanent label: four orders,
              the current one ticked, and a trigger that cannot change width. */}
        <DropdownMenu.Root>
          <DropdownMenu.Trigger>
            <button type="button" className="sc-toolbar-btn" aria-label="Sort shots">
              <ArrowsDownUp size={14} />
              <span className="sc-toolbar-btn-t">Sort</span>
              <CaretDown size={10} />
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Content align="end">
            <DropdownMenu.RadioGroup value={sort} onValueChange={(v) => onSort(v as FeedSort)}>
              {FEED_SORTS.map((s) => (
                <DropdownMenu.RadioItem key={s.id} value={s.id}>
                  {s.label}
                </DropdownMenu.RadioItem>
              ))}
            </DropdownMenu.RadioGroup>
          </DropdownMenu.Content>
        </DropdownMenu.Root>

        {/* The wall toggle, unchanged: the feed is a wall of pictures like
              Products and Scenes are, so it gets their control rather than a
              shape of its own. */}
        <FeedSizeControl value={tile} onChange={onTile} />

        {/* Not a discovery control: it opens and shuts a column of the page.
              It keeps the row's far end, held off by the wider gap that marks
              every other boundary here, rather than sitting in the top bar
              where a page-local switch would appear and vanish as you moved. */}
        {showAssets && (
          <button
            type="button"
            className="sc-icon-btn sc-toolbar-assets"
            data-on={assets || undefined}
            onClick={onAssets}
            aria-label="Assets panel"
            aria-pressed={assets}
            title="Assets panel (.)"
          >
            <SidebarSimple size={15} mirrored />
          </button>
        )}
      </div>
    </div>
  );
}
