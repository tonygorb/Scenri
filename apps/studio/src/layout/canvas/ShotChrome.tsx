import { Check, DotsThree, Infinity as InfinityIcon, Star } from '@phosphor-icons/react';
import { DropdownMenu } from '@radix-ui/themes';
import { nodeLabel, type TreeNode } from '../../api.js';
import type { ShotMenuItem } from './shotMenu.js';

/**
 * Everything a shot tile wears over its picture.
 *
 * One rule holds it together: **at rest the card wears marks, on hover the
 * marks become controls.** A mark is state you have to read while scanning a
 * wall of shots — this one is kept. A control is a thing you do, and nothing
 * you do needs to be visible before you have chosen a card.
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
  chosen,
  picking,
  batching,
  armed,
  menu,
  onPick,
  onBranch,
}: {
  node: TreeNode;
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
  onBranch?: (id: string) => void;
}) {
  return (
    <>
      {/* One scrim per card edge, not one pill per control.

          None of it while a batch is being built. A scrim exists to make a
          rail legible, and during selection there is no rail: it darkened the
          picture to protect nothing. The tile says "the pointer is here" with
          a ring instead, which is a smaller claim and the right size of one. */}
      {!batching && <span className="sc-cell-veil" aria-hidden />}

      {picking && (
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
      {node.kept && (
        <span className="sc-cell-mark sc-cell-star" title="Kept">
          <Star size={14} weight="fill" />
          <span className="sc-vh">Kept</span>
        </span>
      )}

      <div className="sc-cell-bar">
        <span />

        <div className="sc-cell-acts">
          {onBranch && !batching && (
            <button
              type="button"
              className="sc-cell-ctl sc-cell-branch"
              data-on={armed || undefined}
              aria-label={`Refine ${nodeLabel(node)}`}
              title="Continue from this shot"
              onClick={() => onBranch(node.id)}
            >
              {/* the refine mark: a version thread loops on itself, and the
                  pencil this used to be said "edit text" more than it said that */}
              <InfinityIcon size={13} weight="bold" />
              <span className="sc-cell-ctl-lb">Refine</span>
            </button>
          )}
          {!batching && menu.length > 0 && (
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
