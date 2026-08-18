import { useEffect, useRef, useState } from 'react';
import { AlertDialog, Button, Dialog, DropdownMenu, Flex } from '@radix-ui/themes';
import { ArrowsDownUp, CaretDown, FolderSimple, SidebarSimple } from '@phosphor-icons/react';
import type { ShotSet } from '../api.js';
import { FEED_SORTS, LENSES, type FeedSort, type Lens } from '../feedRules.js';
import { FeedSizeControl } from './DensityControl.js';
import { LibrarySearch } from './library/LibrarySearch.js';
import { VerticalsTabs, type VerticalsTabItem } from './VerticalsTabs.js';

/**
 * One row above the feed, holding two questions and nothing else.
 *
 * WHERE I AM sits on the left as the feed title: All shots, a named set, or
 * the shots not filed into one. The lenses (all, keepers, archived) are
 * children of that place. They used to be one strip of identical tabs, which
 * made them look like one question when they are two — and worse, they
 * fought: a set short-circuited the lens in `shown`. The title is the parent;
 * the tabs stay the lens. Rename and delete live on this menu — the top bar
 * does not name the set a second time.
 *
 * HOW DO I FIND SOMETHING sits on the right, in the order every catalog wall
 * in the app already uses: search, then size. Sort is the one menu only this
 * screen has. The row used to also spend space on a result count — the tab
 * numbers carry that now — and on a fourteen-stop width slider whose middle
 * stops changed nothing.
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
  onResetNewSet,
  onRenameSet,
  onDeleteSet,
  askCreate,
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
  /** Create only happens after they name it — Cancel must not leave a set. */
  onNewSet: (name: string) => void;
  /** Drop any members the pick bar staged for the next create. */
  onResetNewSet?: () => void;
  /** Name the set you are in. Absent when you are not in one. */
  onRenameSet?: (name: string) => void;
  onDeleteSet?: () => void;
  /** The pick bar asked to name a set that does not exist yet. */
  askCreate?: boolean;
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
  const placeLabel = active ? active.name : ungrouped ? 'Not in a set' : 'All shots';
  const somewhere = Boolean(active) || ungrouped;
  const [naming, setNaming] = useState(false);
  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [draft, setDraft] = useState('');
  const nameRef = useRef<HTMLInputElement>(null);
  const creatingRef = useRef(false);

  const beginCreate = () => {
    creatingRef.current = true;
    setCreating(true);
    setDraft('');
    setNaming(true);
  };

  const openRename = () => {
    if (!active) return;
    creatingRef.current = false;
    setCreating(false);
    setDraft(active.name);
    setNaming(true);
  };

  useEffect(() => {
    if (!askCreate) return;
    beginCreate();
  }, [askCreate]);

  const commitName = () => {
    const name = draft.trim();
    if (!name) return;
    const made = creatingRef.current;
    creatingRef.current = false;
    setCreating(false);
    setNaming(false);
    if (made) onNewSet(name);
    else onRenameSet?.(name);
  };

  const onNameOpenChange = (open: boolean) => {
    if (open) {
      setNaming(true);
      return;
    }
    const abandon = creatingRef.current;
    creatingRef.current = false;
    setCreating(false);
    setNaming(false);
    if (abandon) onResetNewSet?.();
  };

  const lensItems: VerticalsTabItem[] = LENSES.map((l) => ({
    value: l.id === 'all' ? null : l.id,
    label: l.label,
    count: lensCounts[l.id],
  }));

  return (
    <div className="sc-toolbar">
      <div className="sc-toolbar-scope">
        {/* The name of the place, not a boxed sibling of the lenses. Idle is
              All shots — the type-name "Sets" and a set-count next to All 11
              was the thing that made this look like a second nav. Rename
              lives in a dialog so this trigger never swaps for an input. */}
        <DropdownMenu.Root>
          <DropdownMenu.Trigger>
            <button type="button" className="sc-toolbar-place" data-on={somewhere || undefined} aria-label={placeLabel}>
              <FolderSimple className="sc-toolbar-place-ic" size={14} />
              <span className="sc-toolbar-place-t">{placeLabel}</span>
              <CaretDown size={10} className="sc-caret" />
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Content align="start" onCloseAutoFocus={(e) => e.preventDefault()}>
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
            <DropdownMenu.Item
              onSelect={() => {
                onResetNewSet?.();
                beginCreate();
              }}
            >
              New set
            </DropdownMenu.Item>
            {active && onRenameSet && <DropdownMenu.Item onSelect={openRename}>Rename</DropdownMenu.Item>}
            {active && onDeleteSet && (
              <DropdownMenu.Item color="red" onSelect={() => setConfirmDelete(true)}>
                Delete set
              </DropdownMenu.Item>
            )}
          </DropdownMenu.Content>
        </DropdownMenu.Root>

        <Dialog.Root open={naming} onOpenChange={onNameOpenChange}>
          <Dialog.Content
            maxWidth="360px"
            aria-describedby={undefined}
            onOpenAutoFocus={(e) => {
              e.preventDefault();
              const field = nameRef.current;
              if (!field) return;
              field.focus();
              field.select();
            }}
          >
            <Dialog.Title>{creating ? 'Name this set' : 'Rename set'}</Dialog.Title>
            <input
              ref={nameRef}
              className="sc-in"
              style={{ width: '100%', marginTop: 8 }}
              value={draft}
              aria-label="Set name"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitName();
              }}
            />
            <Flex gap="3" mt="4" justify="end">
              <Button variant="soft" color="gray" onClick={() => onNameOpenChange(false)}>
                Cancel
              </Button>
              <Button onClick={commitName} disabled={!draft.trim()}>
                Save
              </Button>
            </Flex>
          </Dialog.Content>
        </Dialog.Root>

        <AlertDialog.Root open={confirmDelete} onOpenChange={setConfirmDelete}>
          <AlertDialog.Content maxWidth="420px">
            <AlertDialog.Title>Delete this set?</AlertDialog.Title>
            <AlertDialog.Description size="2">Shots stay in the library. Only the set goes.</AlertDialog.Description>
            <Flex gap="3" mt="4" justify="end">
              <AlertDialog.Cancel>
                <Button variant="soft" color="gray">
                  Cancel
                </Button>
              </AlertDialog.Cancel>
              <AlertDialog.Action>
                <Button
                  color="red"
                  onClick={() => {
                    onDeleteSet?.();
                    setConfirmDelete(false);
                  }}
                >
                  Delete set
                </Button>
              </AlertDialog.Action>
            </Flex>
          </AlertDialog.Content>
        </AlertDialog.Root>

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

        {/* Sort is the only order control this wall has, so it takes a menu
              rather than a permanent label: four orders, the current one
              ticked, and a trigger that cannot change width. */}
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
