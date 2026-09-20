import { Archive, ArrowCounterClockwise, FolderSimple, Star, Trash, X } from '@phosphor-icons/react';
import { DropdownMenu } from '@radix-ui/themes';
import { type ReactNode, useState } from 'react';
import type { ShotSet } from '../../api.js';
import { Confirm } from '../../Confirm.js';
import { Tip } from '../../layout/Tip.js';

/**
 * What you can do with a handful of shots. Only ever about membership.
 *
 * A toolbar, not a banner: three groups behind hairlines, saying what the
 * tools act on, the tools, and the way out. Each verb is one icon at one size
 * and names itself in a tooltip, which is the app's rule for an icon-only
 * control (DESIGN.md 5). Select all is the one control no glyph carries, so it
 * stays a word; below 360px it is the thing that goes, because selecting every
 * loaded shot is a pointer's job.
 *
 * A phone gets the same bar with a slightly larger box under the same glyph,
 * never a different composition: the sizes are one scale, written in
 * `surfaces/home.css` above the rules that use them.
 */
export function PickedBar({
  count,
  sets,
  onAdd,
  onNew,
  onClear,
  onKeep,
  onArchiveBatch,
  allKept,
  archivedLens,
  pickedIds,
  onRestoreBatch,
  onDeleteBatch,
  loaded,
  onSelectAll,
}: {
  count: number;
  sets: ShotSet[];
  onAdd: (s: ShotSet) => void;
  onNew: () => void;
  onClear: () => void;
  onKeep: () => void;
  /** Put the lot away, the same verb the tile's own menu carries. */
  onArchiveBatch: (ids: string[]) => void;
  allKept: boolean;
  /** Keep/Add-to-set are curation for active work — an archived
   * selection only has two sensible actions, so the bar swaps entirely. */
  archivedLens: boolean;
  pickedIds: string[];
  onRestoreBatch: (ids: string[]) => void;
  onDeleteBatch: (ids: string[]) => void;
  /** How many shots the feed is holding, which is what Select all can reach. */
  loaded: number;
  onSelectAll: () => void;
}) {
  const [askDelete, setAskDelete] = useState(false);

  return (
    <div className="sc-picked" data-lens={archivedLens ? 'archived' : undefined} role="toolbar" aria-label="Selection">
      <span className="sc-picked-meta">
        <span className="sc-picked-n" role="status">
          {count}
          <span className="sc-vh"> selected</span>
        </span>
        {count < loaded && (
          <button type="button" className="sc-picked-all" onClick={onSelectAll}>
            Select all
          </button>
        )}
      </span>

      <span className="sc-picked-rule" aria-hidden />

      <span className="sc-picked-tools">
        {archivedLens ? (
          <>
            <Tool label="Restore" onClick={() => onRestoreBatch(pickedIds)}>
              <ArrowCounterClockwise size={17} />
            </Tool>
            <Tool label={`Delete ${count} permanently`} tone="danger" onClick={() => setAskDelete(true)}>
              <Trash size={17} />
            </Tool>
          </>
        ) : (
          <>
            <Tool label={allKept ? 'Remove from keepers' : 'Keep'} onClick={onKeep}>
              <Star size={17} weight={allKept ? 'fill' : 'regular'} />
            </Tool>
            <DropdownMenu.Root>
              <Tip label="Add to set">
                <DropdownMenu.Trigger>
                  <button type="button" className="sc-picked-tool" aria-label="Add to set">
                    <FolderSimple size={17} />
                  </button>
                </DropdownMenu.Trigger>
              </Tip>
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
            {/* the one verb that takes shots out of the feed, so it answers in
                red under the hand rather than looking like its neighbours */}
            <Tool label="Archive" tone="danger" onClick={() => onArchiveBatch(pickedIds)}>
              <Archive size={17} />
            </Tool>
          </>
        )}
      </span>

      <span className="sc-picked-rule" aria-hidden />

      <span className="sc-picked-exit">
        <Tool label="Done" onClick={onClear}>
          <X size={16} weight="bold" />
        </Tool>
      </span>

      {archivedLens && (
        <Confirm
          label={`Delete ${count} permanently`}
          title={`Delete ${count} shot${count === 1 ? '' : 's'} permanently?`}
          body="This cannot be undone."
          busy={false}
          open={askDelete}
          onOpenChange={setAskDelete}
          onConfirm={() => onDeleteBatch(pickedIds)}
        />
      )}
    </div>
  );
}

/** One tool: an icon, the name it carries in a tooltip, and its tone. */
function Tool({
  label,
  tone,
  onClick,
  children,
}: {
  label: string;
  /** Destructive: it answers in red under the hand. */
  tone?: 'danger';
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Tip label={label}>
      <button type="button" className="sc-picked-tool" data-tone={tone} aria-label={label} onClick={onClick}>
        {children}
      </button>
    </Tip>
  );
}
