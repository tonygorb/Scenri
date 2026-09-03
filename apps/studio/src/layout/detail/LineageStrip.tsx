import { nodeLabel, type FeedNode, thumbUrl } from '../../api.js';
import { ChipPreview } from '../../composer/ChipPreview.js';
import { useHoverPreview } from '../../composer/useHoverPreview.js';

/**
 * The image's history in reading order, worn as the thumb strip under the
 * stage. Hovering peeks a version at a readable size; clicking moves the
 * stage to it.
 *
 * One hover peek for the whole strip, owned here rather than by the overlay:
 * shared, so moving between two thumbs switches the card at once instead of
 * closing one and re-opening the next; here, so resting the pointer on a
 * thumb re-renders a handful of buttons, not the overlay and the second
 * composer inside it.
 */
export function LineageStrip({
  strip,
  activeId,
  onSelect,
}: {
  strip: FeedNode[];
  activeId: string;
  onSelect: (id: string) => void;
}) {
  const peek = useHoverPreview<{ key: string; src: string; label: string; el: HTMLElement; id: string }>();
  const peekAt = (n: FeedNode, el: HTMLElement) =>
    peek.open({ key: n.id, src: thumbUrl(n.images[0], 'tile'), label: nodeLabel(n), el, id: n.id });
  return (
    <>
      <div className="sc-thumbs">
        {strip.map((n) => (
          <button
            type="button"
            key={n.id}
            className="sc-thumb-btn"
            aria-label={nodeLabel(n)}
            aria-pressed={n.id === activeId}
            title={nodeLabel(n)}
            onClick={() => {
              peek.closeNow();
              onSelect(n.id);
            }}
            onPointerEnter={(e) => e.pointerType === 'mouse' && peekAt(n, e.currentTarget)}
            onPointerLeave={(e) => e.pointerType === 'mouse' && peek.close()}
            onFocus={(e) => e.currentTarget.matches(':focus-visible') && peekAt(n, e.currentTarget)}
          >
            <img
              src={thumbUrl(n.images[0], 'micro')}
              alt=""
              className="sc-thumb"
              loading="lazy"
              decoding="async"
              data-active={n.id === activeId}
              width={52}
              height={52}
            />
          </button>
        ))}
      </div>
      {peek.shown && (
        <ChipPreview
          key={peek.shown.key}
          anchor={peek.shown.el}
          kind="shot"
          src={peek.shown.src}
          label={peek.shown.label}
          onOpen={() => {
            const id = peek.shown?.id;
            peek.closeNow();
            if (id) onSelect(id);
          }}
          onHoverIn={peek.keep}
          onHoverOut={peek.close}
          onClose={peek.closeNow}
        />
      )}
    </>
  );
}
