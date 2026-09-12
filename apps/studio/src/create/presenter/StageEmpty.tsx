import { UserPlus } from '@phosphor-icons/react';

/**
 * The stage while there is no picture on it.
 *
 * A 4:5 plate of raised grey filling the window is a picture frame with no
 * picture in it: it claims the largest thing on screen at the one moment the
 * conversation is the only thing that matters. This is the sign that replaces
 * it. It stands where the portrait will stand, at a fixed size, so a wider
 * window buys more quiet rather than a bigger sign.
 *
 * The plate and its two rings are decoration and say nothing a reader needs;
 * the two lines say all of it, so the glyph carries no label of its own.
 */
export function StageEmpty({ lead, hint }: { lead?: string; hint?: string }) {
  return (
    <div className="sc-pstudio-empty">
      <span className="sc-pstudio-empty-mark" aria-hidden>
        <span className="sc-pstudio-empty-ring" data-at="far" />
        <span className="sc-pstudio-empty-ring" data-at="near" />
        <UserPlus size={32} />
      </span>
      {lead && (
        <span className="sc-pstudio-empty-say">
          <span>{lead}</span>
          {hint && <span>{hint}</span>}
        </span>
      )}
    </div>
  );
}
