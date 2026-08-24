import { Check, DotsThree, PencilLine, Stack, Star } from '@phosphor-icons/react';
import { DropdownMenu } from '@radix-ui/themes';
import { nodeLabel, type TreeNode } from '../../api.js';
import type { ShotMenuItem } from './shotMenu.js';

/**
 * Everything a shot tile wears over its picture.
 *
 * One rule holds it together: **at rest the card wears marks, on hover the
 * marks become controls.** A mark is state you have to read while scanning a
 * wall of shots — this one is kept, this one is a stack of four. A control is
 * a thing you do, and nothing you do needs to be visible before you have
 * chosen a card.
 *
 * The tile carries **two verbs and no more**: Refine, which is the whole loop
 * of this app, and one overflow that opens the shot's menu. Keep and Archive
 * used to bloom here as buttons of their own, which made four separate things
 * appear over a photograph on every hover and put a different number of them
 * on the tile under the cursor than on its neighbours. They are management,
 * they live in the menu, and the picture keeps its corners.
 *
 * The keeper star is now purely a mark: gold when kept, absent when not, never
 * a button. Marks are not interactive and controls are not decorative, and
 * keeping a shot is one line of the menu like every other verb.
 */
export function ShotChrome({
  node,
  take,
  takeCount,
  chosen,
  picking,
  batching,
  armed,
  menu,
  onPick,
  onBranch,
  onToggleExpand,
}: {
  node: TreeNode;
  /** Which take this tile shows, or null when the run is stacked into one tile. */
  take: number | null;
  takeCount: number;
  chosen: boolean;
  picking: boolean;
  /**
   * A batch is being built, so the tile shows its tick and nothing else.
   *
   * Refine and the overflow both act on one picture, and choosing which twelve
   * go in a set is the opposite of that. The scrim goes with them, because a
   * scrim exists to make a rail legible and there is no longer a rail; what a
   * hover has to say here is only "the pointer is on this one", which a ring
   * says without touching the photograph.
   *
   * Absent rather than hidden with a stylesheet. Rendering a verb and then
   * fighting its opacity is what produced three competing mode mechanisms
   * here; leaving it out of the tree gives the hover rules nothing to argue
   * with.
   */
  batching: boolean;
  /** Whether the brief is currently pointed at this exact tile. */
  armed: boolean;
  /** The shot's verbs, built once by the feed so both menus agree. */
  menu: ShotMenuItem[];
  onPick?: (id: string) => void;
  onBranch?: (id: string, imageIndex?: number) => void;
  onToggleExpand?: (id: string) => void;
}) {
  const opened = take !== null;
  /**
   * Picking and the menu act on the run rather than on one picture, so an
   * opened-out run carries them on its first take only. Four copies of one
   * checkbox is not four choices.
   */
  const runControls = !opened || take === 0;

  return (
    <>
      {/* One scrim per card edge, not one pill per control.

          None of it while a batch is being built. A scrim exists to make a
          rail legible, and during selection there is no rail: it darkened the
          picture to protect nothing. The tile says "the pointer is here" with
          a ring instead, which is a smaller claim and the right size of one. */}
      {!batching && <span className="sc-cell-veil" aria-hidden />}

      {picking && runControls && (
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
        </button>
      )}

      {/* A mark, not a control: gold says kept and nothing else, and there is
          no unlit state to hover because an unkept shot simply has no star. */}
      {node.kept && runControls && (
        <span className="sc-cell-mark sc-cell-star" title="Kept">
          <Star size={14} weight="fill" />
          <span className="sc-vh">Kept</span>
        </span>
      )}

      <div className="sc-cell-bar">
        {/* The count is not a caption, it is the door into the other takes, so
            it is the one thing on the tile that stays legible at rest. Every
            take can close the run, not just the first. */}
        {takeCount > 1 && onToggleExpand ? (
          <button
            type="button"
            className="sc-cell-ctl sc-cell-stack"
            aria-expanded={opened}
            aria-label={opened ? `Collapse ${takeCount} variants` : `Show all ${takeCount} variants`}
            onClick={() => onToggleExpand(node.id)}
          >
            <Stack size={13} />
            <span className="sc-cell-ctl-n">{opened ? `${(take ?? 0) + 1}/${takeCount}` : takeCount}</span>
            <span className="sc-cell-ctl-lb">{opened ? 'Collapse' : 'variants'}</span>
          </button>
        ) : (
          <span />
        )}

        <div className="sc-cell-acts">
          {/* Refining is about THIS picture rather than the run, so an opened
              take carries its own and names the take it is about. */}
          {onBranch && !batching && (
            <button
              type="button"
              className="sc-cell-ctl sc-cell-branch"
              data-on={armed || undefined}
              aria-label={opened ? `Refine ${(take ?? 0) + 1} of ${takeCount}` : `Refine ${nodeLabel(node)}`}
              title={opened ? 'Continue from this take' : 'Continue from this shot'}
              onClick={() => onBranch(node.id, take ?? undefined)}
            >
              <PencilLine size={13} />
              <span className="sc-cell-ctl-lb">Refine</span>
            </button>
          )}
          {runControls && !batching && menu.length > 0 && (
            <DropdownMenu.Root>
              <DropdownMenu.Trigger>
                <button
                  type="button"
                  className="sc-cell-ctl sc-cell-more"
                  aria-label={`More for ${nodeLabel(node)}`}
                  title="More"
                >
                  <DotsThree size={16} weight="bold" />
                </button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Content>
                {menu.map((it) => (
                  <span key={it.key} style={{ display: 'contents' }}>
                    {it.separated && <DropdownMenu.Separator />}
                    <DropdownMenu.Item color={it.danger ? 'red' : undefined} onSelect={it.onSelect}>
                      {it.label}
                    </DropdownMenu.Item>
                  </span>
                ))}
              </DropdownMenu.Content>
            </DropdownMenu.Root>
          )}
        </div>
      </div>
    </>
  );
}
