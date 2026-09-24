/**
 * What can be done with one picture of a scene, the same for a scene made here
 * and a catalog one: Use this view (a shot follows it) and Set as cover (the
 * scene is shown by it). Two separate things: a cover is presentation and
 * changes nothing a shot is given, and a view is picked for one shot at a time.
 *
 * `tile` sits over the frame's foot on a hover device, shown on hover and when
 * the keyboard is inside the frame; on touch it is not drawn, because the frame
 * opens and `sheet` carries the same two in the lightbox. The cover itself is
 * marked on its tile, and Set as cover is not offered for it.
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
          Cover
        </span>
      )}
      {(onUse || canCover) && (
        <span className="sc-sceneview-acts">
          {onUse && (
            <button
              type="button"
              className="sc-sceneview-act"
              aria-label={`Use this view: ${label}`}
              disabled={busy}
              onClick={onUse}
            >
              Use this view
            </button>
          )}
          {canCover && (
            <button
              type="button"
              className="sc-sceneview-act"
              aria-label={`Set as cover: ${label}`}
              disabled={busy}
              onClick={onCover}
            >
              Set as cover
            </button>
          )}
        </span>
      )}
    </>
  );
}
