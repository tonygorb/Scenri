import { DropdownMenu } from '@radix-ui/themes';
import type { ShotSet, FeedNode } from '../../api.js';
import { Confirm } from '../../Confirm.js';

/** What you can do with a handful of shots. Only ever about membership. */
export function PickedBar({
  count,
  sets,
  onAdd,
  onNew,
  onClear,
  onKeep,
  allKept,
  comparable,
  onCompare,
  archivedLens,
  pickedIds,
  onRestoreBatch,
  onDeleteBatch,
}: {
  count: number;
  sets: ShotSet[];
  onAdd: (s: ShotSet) => void;
  onNew: () => void;
  onClear: () => void;
  onKeep: () => void;
  allKept: boolean;
  comparable: readonly [FeedNode, FeedNode] | null;
  onCompare: () => void;
  /** Keep/Compare/Add-to-set are curation for active work — an archived
   * selection only has two sensible actions, so the bar swaps entirely. */
  archivedLens: boolean;
  pickedIds: string[];
  onRestoreBatch: (ids: string[]) => void;
  onDeleteBatch: (ids: string[]) => void;
}) {
  return (
    <div className="sc-picked" role="status">
      <span className="sc-picked-n">{count} selected</span>
      {archivedLens ? (
        <button type="button" className="sc-btn" onClick={() => onRestoreBatch(pickedIds)}>
          Restore
        </button>
      ) : (
        <>
          <button type="button" className="sc-btn" onClick={onKeep}>
            {allKept ? 'Remove from keepers' : 'Keep'}
          </button>
          {/* shown at two, so the bar does not carry a control that spends most of
              its life disabled and unexplained */}
          {count === 2 && (
            <button
              type="button"
              className="sc-btn"
              // aria-disabled: keeps the button tab-reachable so its title —
              // the only explanation for why Compare is inert — stays
              // discoverable to keyboard/screen-reader users, not just mouse hover
              aria-disabled={!comparable || undefined}
              onClick={() => {
                if (comparable) onCompare();
              }}
              title={comparable ? 'Show the drift between these two' : 'Both shots need to have finished'}
            >
              Compare
            </button>
          )}
          <DropdownMenu.Root>
            <DropdownMenu.Trigger>
              <button type="button" className="sc-btn sc-btn-primary">
                Add to set
              </button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Content>
              {sets.map((s) => (
                <DropdownMenu.Item key={s.id} onSelect={() => onAdd(s)}>
                  {s.name}
                </DropdownMenu.Item>
              ))}
              {sets.length > 0 && <DropdownMenu.Separator />}
              <DropdownMenu.Item onSelect={onNew}>New set…</DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Root>
        </>
      )}
      <button type="button" className="sc-btn" onClick={onClear}>
        Clear
      </button>
      {archivedLens && (
        <Confirm
          label={`Delete ${count} permanently`}
          title={`Delete ${count} shot${count === 1 ? '' : 's'} permanently?`}
          body="This cannot be undone."
          busy={false}
          onConfirm={() => onDeleteBatch(pickedIds)}
        />
      )}
    </div>
  );
}
