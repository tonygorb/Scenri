import { DotsThree, DotsThreeVertical } from '@phosphor-icons/react';
import { DropdownMenu } from '@radix-ui/themes';
import { MenuGlyph } from './menuGlyph.js';
import { Tip } from './Tip.js';

/**
 * What can be done with one picture of a scene, the same for a scene made here
 * and a catalog one: Use this view (a shot follows it) and Set as cover (the
 * scene is shown by it). Two separate things: a cover is presentation and
 * changes nothing a shot is given, and a view is picked for one shot at a time.
 * A made scene's example can also be drawn again, the one thing here that
 * spends, and it says so.
 *
 * `tile` is shown on hover and when the keyboard is inside the frame. Use this
 * view is the centred glass pill Home's examples carry, the one thing the
 * picture is for; the rest sits behind a card's own More in the top-right, the
 * menu every catalog card opens. The cover is not marked on the picture: its
 * frame wears a card's selected ring and its caption says so
 * (`SceneViewCaption`). On touch More stays, as on a card, and the frame opens
 * `sheet`, which carries the same actions in the lightbox.
 */
export function SceneViewActions({
  variant,
  label,
  isCover,
  onUse,
  onCover,
  onRedraw,
  busy = false,
}: {
  variant: 'tile' | 'sheet';
  /** The view's name, for the tile buttons' accessible names ("Use this view: Hero"). */
  label: string;
  isCover: boolean;
  /** Absent when this view cannot be handed to a shot (a picture still drawing). */
  onUse?: () => void;
  onCover?: () => void;
  /** A made scene's example only: draw this one picture again. */
  onRedraw?: () => void;
  busy?: boolean;
}) {
  const canCover = !isCover && !!onCover;
  if (variant === 'sheet')
    return (
      <>
        {onUse && (
          <button type="button" className="sc-btn sc-btn-primary" disabled={busy} onClick={onUse}>
            Use this view
          </button>
        )}
        {canCover && (
          <button type="button" className="sc-btn sc-btn-ghost" disabled={busy} onClick={onCover}>
            Set as cover
          </button>
        )}
        {onRedraw && (
          <button type="button" className="sc-btn sc-btn-ghost" disabled={busy} onClick={onRedraw}>
            {REDRAW}
          </button>
        )}
      </>
    );
  return (
    <>
      {onUse && (
        <button
          type="button"
          className="sc-lookcard-use"
          aria-label={`Use this view: ${label}`}
          disabled={busy}
          onClick={onUse}
        >
          Use this view
        </button>
      )}
      {(canCover || onRedraw) && (
        <div className="sc-corner">
          <DropdownMenu.Root>
            <Tip label="More">
              <DropdownMenu.Trigger>
                <button type="button" className="sc-cell-ctl sc-lookcard-more" aria-label={`More for ${label}`}>
                  <DotsThreeVertical className="sc-lookcard-more-vert" size={16} weight="bold" />
                  <DotsThree className="sc-lookcard-more-horiz" size={16} weight="bold" />
                </button>
              </DropdownMenu.Trigger>
            </Tip>
            <DropdownMenu.Content side="bottom" align="end" sideOffset={4} collisionPadding={12}>
              {canCover && (
                <DropdownMenu.Item disabled={busy} onSelect={onCover}>
                  <MenuGlyph name="cover" />
                  Set as cover
                </DropdownMenu.Item>
              )}
              {onRedraw && (
                <DropdownMenu.Item disabled={busy} onSelect={onRedraw}>
                  <MenuGlyph name="redraw" />
                  {REDRAW}
                </DropdownMenu.Item>
              )}
            </DropdownMenu.Content>
          </DropdownMenu.Root>
        </div>
      )}
    </>
  );
}

/** What it costs, said before it is pressed, as the page's own draw button says it. */
const REDRAW = 'Draw again, one picture';

/**
 * A view's name under its picture, and on the cover the word that says so, the
 * way a selected card's caption carries its state.
 */
export function SceneViewCaption({ label, isCover }: { label: string; isCover: boolean }) {
  return (
    <span className="sc-refset-lb" data-cover={isCover || undefined} aria-hidden>
      {label}
      {isCover && <span className="sc-sceneview-cover"> · Cover</span>}
    </span>
  );
}
