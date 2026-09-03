import { useCallback } from 'react';
import { X } from '@phosphor-icons/react';
import { nodeLabel, type FeedNode, thumbUrl } from '../api.js';
import { ChipPreview } from './ChipPreview.js';
import { useHoverPreview } from './useHoverPreview.js';

/**
 * The version being refined, worn as the one chip pattern the app has: the
 * sentence's own .sc-token as a small inverse card, the shot's picture first,
 * then the word for what is happening. Not the shot's prompt: that read as a
 * truncated instruction, not a name. Hover peeks at the image the way a
 * sentence chip does; click opens it full size.
 *
 * A leaf on purpose. The hover peek used to be state on the composer itself,
 * so resting the pointer on this chip re-rendered the whole composer, its
 * brief line, its settings and its source cards, twice per hover.
 */
export function RefineChip({
  target,
  onOpenImage,
  onClear,
}: {
  target: FeedNode;
  /** Open the picture full size (the composer owns the one lightbox). */
  onOpenImage: () => void;
  /** Let go of the refine thread and make a new shot instead. */
  onClear?: () => void;
}) {
  const hover = useHoverPreview<{ anchor: HTMLElement }>();
  const image = target.images[0];
  const open = useCallback(() => {
    if (!image) return;
    hover.closeNow();
    onOpenImage();
  }, [image, hover.closeNow, onOpenImage]);
  return (
    <>
      {/* biome-ignore lint/a11y/useSemanticElements: a <button> cannot hold the remove <button> the chip pattern floats over its right edge; the sentence's own chips are the same span-as-button */}
      <span
        className="sc-token sc-target-chip"
        role="button"
        tabIndex={0}
        aria-haspopup="dialog"
        aria-label={`Version being refined: ${nodeLabel(target)}. Open the image, or remove to make a new shot.`}
        onPointerEnter={(e) => {
          if (e.pointerType === 'mouse' && image) hover.open({ anchor: e.currentTarget });
        }}
        onPointerLeave={(e) => e.pointerType === 'mouse' && hover.close()}
        onClick={open}
        onKeyDown={(e) => {
          // the X inside bubbles its keys up here; only the chip's own
          if (e.target !== e.currentTarget) return;
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            open();
          }
        }}
      >
        {/* a version that has just been asked for has no picture yet, and
            the same shimmer the feed uses says so without a second word */}
        {image ? <img src={thumbUrl(image, 'micro')} alt="" /> : <span className="sc-target-thumb sc-shimmer" />}
        Refining
        {onClear && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              hover.closeNow();
              onClear();
            }}
            aria-label="Make a new shot instead"
          >
            <X size={12} />
          </button>
        )}
      </span>
      {/* The chip's hover peek: the same card a sentence chip gets. */}
      {hover.shown && image && (
        <ChipPreview
          anchor={hover.shown.anchor}
          kind="shot"
          src={thumbUrl(image, 'tile')}
          label={nodeLabel(target)}
          noun="Refining this shot"
          onOpen={open}
          onHoverIn={hover.keep}
          onHoverOut={hover.close}
          onClose={hover.closeNow}
        />
      )}
    </>
  );
}
