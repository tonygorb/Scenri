import { ImageSquare } from '@phosphor-icons/react';
import { Tip } from './Tip.js';

/**
 * What can be done with one picture of a scene, the same for a scene made here
 * and a catalog one: Use this view (a shot follows it) and Set as cover (the
 * scene is shown by it). Two separate things: a cover is presentation and
 * changes nothing a shot is given, and a view is picked for one shot at a time.
 *
 * `tile` wears the catalog card's own controls, shown on hover and when the
 * keyboard is inside the frame: Use this view is the centred pill Home's
 * examples carry, and Set as cover is an icon with the app's tip in the top-left
 * corner, the slot where the cover's own mark stands, so the mark lands exactly
 * where it was asked for (a card's star works the same way). On touch neither
 * control is drawn, because the frame opens and `sheet` carries the same two in
 * the lightbox.
 */
export function SceneViewActions({
  variant,
  label,
  isCover,
  onUse,
  onCover,
  busy = false,
}: {
  variant: 'tile' | 'sheet';
  /** The view's name, for the tile buttons' accessible names ("Use this view: Hero"). */
  label: string;
  isCover: boolean;
  /** Absent when this view cannot be handed to a shot (a picture still drawing). */
  onUse?: () => void;
  onCover?: () => void;
  busy?: boolean;
}) {
  const canCover = !isCover && !!onCover;
  if (variant === 'sheet')
    return (
      <>
        {canCover && (
          <button type="button" className="sc-btn sc-btn-ghost" disabled={busy} onClick={onCover}>
            Set as cover
          </button>
        )}
        {onUse && (
          <button type="button" className="sc-btn sc-btn-ghost" disabled={busy} onClick={onUse}>
            Use this view
          </button>
        )}
      </>
    );
  return (
    <>
      {isCover && (
        <span className="sc-sceneview-cover" aria-hidden>
          <ImageSquare size={14} weight="fill" />
          Cover
        </span>
      )}
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
      {canCover && (
        <div className="sc-corner">
          <Tip label="Set as cover">
            <button
              type="button"
              className="sc-cell-ctl"
              aria-label={`Set as cover: ${label}`}
              disabled={busy}
              onClick={onCover}
            >
              <ImageSquare size={15} />
            </button>
          </Tip>
        </div>
      )}
    </>
  );
}
