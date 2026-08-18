/**
 * A lens is hiding work that exists. Never a bare blank: say which lens, and
 * offer the way out of it, because the alternative reads as the shots having
 * been thrown away.
 */
export function LensEmpty({
  text,
  onAll,
  actionLabel = 'Show all shots',
}: {
  text: string;
  onAll?: () => void;
  actionLabel?: string;
}) {
  return (
    <div className="sc-feed-empty">
      <p>{text}</p>
      {onAll && (
        <button type="button" className="sc-btn" onClick={onAll}>
          {actionLabel}
        </button>
      )}
    </div>
  );
}
