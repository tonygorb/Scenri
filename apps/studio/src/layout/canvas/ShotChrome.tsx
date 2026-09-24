import type { ReactElement } from 'react';
import {
  Archive,
  Check,
  DotsThreeVertical,
  DownloadSimple,
  Infinity as InfinityIcon,
  Star,
  Trash,
} from '@phosphor-icons/react';
import { DropdownMenu } from '@radix-ui/themes';
import { imgUrl, nodeLabel, type FeedNode } from '../../api.js';
import { iconTip } from '../Tip.js';
import { useHoverNone } from '../../useMediaQuery.js';
import { ShotMenuGlyph } from './ShotMenuGlyph.js';
import type { ShotMenuItem } from './shotMenu.js';

/**
 * Everything a shot tile wears over its picture.
 *
 * One rule holds it together: at rest a tile is a picture, and on hover it
 * grows the controls. A kept shot is the exception that stays lit, because
 * that is the only way to scan a wall for one.
 *
 * The action row is More, then Refine, then Archive (or Delete once the shot
 * is archived), then Download, then Keep at the end. Refine is the same
 * square as the others: the infinity mark, no word. On a phone it is not on
 * the picture at all. A tap opens the shot, which is the refine, and the
 * menu still has the line. Those are rounded squares; the tick stays a
 * circle. The star is gold when the shot is kept, and a kept one stays
 * visible so a wall can be scanned. A selection does not take the row away.
 * The dock is the batch; the row is this shot.
 */
export function ShotChrome({
  node,
  chosen,
  picking,
  batching,
  armed,
  menu,
  onPick,
  onBranch,
  onToggleKeep,
  onArchive,
  onDelete,
}: {
  node: FeedNode;
  chosen: boolean;
  picking: boolean;
  /**
   * A batch is being built. The tick and the ring say so. Refine leaves,
   * because starting a new piece of work from one picture is the opposite
   * of choosing a group, and the menu drops it at the same moment. The
   * action row stays: More, Archive, Download and Keep are still this shot's.
   */
  batching: boolean;
  /** Whether the brief is currently pointed at this exact tile. */
  armed: boolean;
  /** The shot's verbs, built once by the feed so both menus agree. */
  menu: ShotMenuItem[];
  onPick?: (id: string) => void;
  onBranch?: (id: string) => void;
  onToggleKeep?: (node: FeedNode) => void;
  /** Live shot: archive it. The corner uses this only while the shot is in the feed. */
  onArchive?: (node: FeedNode) => void;
  /** Permanent delete. Only offered once the shot is already archived. */
  onDelete?: (node: FeedNode) => void;
}) {
  const name = nodeLabel(node);
  const hoverNone = useHoverNone();
  const named = (label: string, control: ReactElement) => iconTip(label, control, hoverNone);
  const download = () => {
    const hash = node.images[0];
    if (!hash) return;
    const base =
      node.promptHead
        .slice(0, 40)
        .replace(/\s+/g, '-')
        .replace(/[^a-zA-Z0-9-]/g, '') || 'shot';
    const a = document.createElement('a');
    a.href = imgUrl(hash);
    a.download = `${base}.png`;
    a.click();
  };
  return (
    <>
      {/* One scrim per card edge, not one pill per control.

          None of it while a batch is being built. A scrim exists to make a
          rail legible, and during selection there is no rail: it darkened the
          picture to protect nothing. The tile says "the pointer is here" with
          a ring instead, which is a smaller claim and the right size of one. */}
      {!batching && <span className="sc-cell-veil" aria-hidden />}

      {picking &&
        named(
          chosen ? 'Deselect' : 'Select',
          <button
            type="button"
            className="sc-cell-ctl sc-cell-pick"
            data-on={chosen || undefined}
            aria-pressed={chosen}
            aria-label={chosen ? 'Deselect shot' : 'Select shot'}
            onClick={() => onPick?.(node.id)}
          >
            {/* The tick is always drawn, dimmed until it means something. An
                empty disc over a photograph reads as a smudge rather than as a
                control waiting to be used. */}
            <Check size={13} weight="bold" />
          </button>,
        )}

      {/* The composer is pointed here: the picked tile's lit tick, worn as a
          mark. During batching the real pick control renders instead, and the
          brief cannot be armed then anyway. pointer-events is off in CSS, so
          this is state, never a second control. */}
      {armed && !picking && (
        <span className="sc-cell-ctl sc-cell-pick" data-on title="Being refined">
          <Check size={13} weight="bold" />
          <span className="sc-vh">Being refined</span>
        </span>
      )}

      <div className="sc-shot-tools">
        {onToggleKeep && (
          <div className="sc-corner">
            {menu.length > 0 && (
              <DropdownMenu.Root>
                {named(
                  'More',
                  <DropdownMenu.Trigger>
                    <button type="button" className="sc-cell-ctl sc-cell-more" aria-label={`More for ${name}`}>
                      <DotsThreeVertical size={16} weight="bold" />
                    </button>
                  </DropdownMenu.Trigger>,
                )}
                <DropdownMenu.Content align="end" sideOffset={4} collisionPadding={12}>
                  {menu.map((it) => (
                    <span key={it.key} style={{ display: 'contents' }}>
                      {it.separated && <DropdownMenu.Separator />}
                      <DropdownMenu.Item color={it.danger ? 'red' : undefined} onSelect={it.onSelect}>
                        <ShotMenuGlyph name={it.icon} />
                        {it.label}
                      </DropdownMenu.Item>
                    </span>
                  ))}
                </DropdownMenu.Content>
              </DropdownMenu.Root>
            )}
            {onBranch &&
              !batching &&
              named(
                'Refine',
                <button
                  type="button"
                  className="sc-cell-ctl sc-cell-branch"
                  data-on={armed || undefined}
                  aria-label={`Refine ${name}`}
                  onClick={() => onBranch(node.id)}
                >
                  {/* the refine mark: a version thread loops on itself, and the
                    pencil this used to be said "edit text" more than it said that */}
                  <InfinityIcon size={15} weight="bold" />
                </button>,
              )}
            {node.archived
              ? onDelete &&
                named(
                  'Delete permanently',
                  <button
                    type="button"
                    className="sc-cell-ctl"
                    aria-label={`Delete ${name} permanently`}
                    onClick={() => onDelete(node)}
                  >
                    <Trash size={15} />
                  </button>,
                )
              : onArchive &&
                named(
                  'Archive',
                  <button
                    type="button"
                    className="sc-cell-ctl"
                    aria-label={`Archive ${name}`}
                    onClick={() => onArchive(node)}
                  >
                    <Archive size={15} />
                  </button>,
                )}
            {node.images[0] &&
              named(
                'Download',
                <button type="button" className="sc-cell-ctl" aria-label={`Download ${name}`} onClick={download}>
                  <DownloadSimple size={15} />
                </button>,
              )}
            {named(
              node.kept ? 'Remove from Keepers' : 'Add to Keepers',
              <button
                type="button"
                className={`sc-cell-ctl sc-cell-keep${node.kept ? ' sc-cell-star' : ''}`}
                data-on={node.kept || undefined}
                aria-pressed={node.kept}
                aria-label={node.kept ? `Remove ${name} from Keepers` : `Add ${name} to Keepers`}
                onClick={() => onToggleKeep(node)}
              >
                <Star size={15} weight={node.kept ? 'fill' : 'regular'} />
              </button>,
            )}
          </div>
        )}
      </div>
    </>
  );
}
