import { useEffect, useState, type CSSProperties } from 'react';
import { Box, Flex, Text } from '@radix-ui/themes';
import { imgUrl, thumbUrl, type FeedNode } from '../api.js';
import { describeCancelled, describeFailure } from '../failure.js';
import { FailureNote } from './Failure.js';
// one clock for the whole app: the canvas and the bell must not disagree
import { elapsedLabel, elapsedSec, runningPhrase } from '../tasks.js';
// the feed's running tiles hold the same shape, from the same source
import { aspectOfFormat } from '../composer/formats.js';
import type { StageZoom } from './detail/useStageZoom.js';

function aspectOf(node: FeedNode): number {
  return aspectOfFormat(node.brief?.format);
}

/** The pixels the run recorded for its first image, when it recorded them. */
export function recordedSize(node: FeedNode): [number, number] | null {
  const size = (node.brief as { rendered?: { sizes?: [number, number][] } } | null)?.rendered?.sizes?.[0];
  return size && size[0] > 0 && size[1] > 0 ? size : null;
}

export function StageFrame({
  node,
  onRetry,
  onCancel,
  engineName,
  zoom,
}: {
  node: FeedNode;
  onRetry?: () => void;
  onCancel?: () => void;
  /** What the engine that ran this is called, so a failure can name it. */
  engineName?: string;
  /** Given, the finished picture zooms where it is: the row is its viewport, the frame is what moves. */
  zoom?: StageZoom;
}) {
  const [, force] = useState(0);

  useEffect(() => {
    if (node.status !== 'running') return;
    const t = setInterval(() => force((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, [node.status]);

  if (node.kind === 'root') {
    return (
      <Box className="sc-frame" p="8">
        <Flex direction="column" align="center" gap="2" py="6">
          <Text className="sc-display" size="7" align="center">
            Blank canvas, full brand.
          </Text>
          <Text color="gray" size="2" align="center">
            Pick a Template below (engineered briefs, your product attached) or describe a visual.
          </Text>
        </Flex>
      </Box>
    );
  }
  /*
   * The waiting state stands on its own, outside the frame that centres a
   * finished picture. That frame is an inline-block: it shrink-wraps whatever
   * is inside it, so a placeholder sized from the stage's cap had no definite
   * parent width to clamp itself against and overflowed the stage by a
   * quarter on a desktop and double on a phone.
   */
  if (node.status === 'running') {
    return (
      /*
       * The picture's own place, held.
       *
       * This was a bordered 4:3 box at a fixed 640px, whatever shape the
       * shot was actually going to be and however much room the stage had:
       * a small empty rectangle adrift in a large dark one, which then
       * jumped to a different size and shape the moment the picture landed.
       * It now takes the box the picture will take — the stage's own cap
       * for height, the shot's recorded shape for aspect — and fills it
       * with the same shimmer the feed uses while a tile is rendering, so
       * there is one language for "this is coming" in both places and
       * nothing moves when it arrives.
       *
       * The prompt is not repeated here. It is already the BRIEF beside
       * this, in full, and it was truncated to a single line here anyway.
       */
      <div className="sc-stage-wait" style={{ '--sc-wait-ar': aspectOf(node) } as CSSProperties}>
        <span className="sc-shimmer" />
        <div className="sc-stage-wait-say">
          {/* The counter alone: the shimmer says "generating", and the words
              beside the number read as noise on a phone. The escalating
              phrase still reaches assistive tech. */}
          <span
            className="sc-stage-wait-t"
            role="status"
            aria-label={`${runningPhrase(node.createdAt)}, ${elapsedSec(node.createdAt)} seconds`}
          >
            {elapsedLabel(node.createdAt)}
          </span>
          {onCancel && (
            <button
              type="button"
              className="sc-btn sc-btn-ghost"
              data-urgent={elapsedSec(node.createdAt) >= 60 || undefined}
              onClick={onCancel}
            >
              Cancel
            </button>
          )}
        </div>
      </div>
    );
  }

  /*
   * Nothing landed, so nothing is framed.
   *
   * This was a 420px card of Radix `Flex` adrift in a full-screen dark
   * rectangle, printing the engine's raw JSON as its body text and repeating
   * the brief — already stated in full in the rail beside it — clipped at 160
   * characters. The pass after that gave it the footprint the picture would
   * have had, which drew an 800px dashed box around the same emptiness.
   *
   * A failure is an empty state with a reason. The stage already centres what
   * it is given, so the note is simply given to it: no frame, no placeholder
   * shape, no chrome standing in for a photograph that does not exist.
   */
  if (node.status === 'cancelled' || node.status === 'error') {
    const cancelled = node.status === 'cancelled';
    const failure = cancelled ? describeCancelled() : describeFailure(node.error, engineName);
    return <FailureNote failure={failure} density="stage" onRetry={onRetry} />;
  }

  const hash = node.status === 'done' ? node.images[0] : undefined;
  const size = hash ? recordedSize(node) : null;
  const frame =
    hash && size ? (
      /*
       * The run recorded its pixels, so the frame takes the picture's box
       * before a byte of it arrives: the same sizing the waiting state uses,
       * bounded by the room there is, the cap, and the picture's own width.
       * Under the original sits the feed's tile derivative, already decoded by
       * the tile that was just clicked, so the stage shows the shot at once
       * and the original replaces it in place when its decode is done.
       */
      <Box
        ref={zoom?.frameRef}
        className="sc-frame sc-stage-pic"
        data-pixels={zoom?.pixels || undefined}
        style={{ '--sc-pic-ar': size[0] / size[1], '--sc-pic-w': `${size[0]}px`, ...zoom?.frameStyle } as CSSProperties}
      >
        <StagePicture key={hash} hash={hash} alt={node.promptHead} zoom={zoom} />
      </Box>
    ) : (
      <Flex justify="center">
        <Box
          ref={zoom?.frameRef}
          className="sc-frame"
          data-pixels={zoom?.pixels || undefined}
          style={{ display: 'inline-block', maxWidth: '100%', ...zoom?.frameStyle }}
        >
          {hash && (
            <Box position="relative" style={{ lineHeight: 0 }}>
              <img
                ref={zoom?.imgRef}
                src={imgUrl(hash)}
                alt={node.promptHead}
                // the cap itself lives in CSS, where it can know whether a row of
                // takes sits under the shot: a percentage cannot, because nothing
                // between here and the stage has a definite height to measure
                style={{ display: 'block', maxWidth: '100%' }}
                onLoad={(e) => zoom?.onImgLoad(e.currentTarget)}
              />
            </Box>
          )}
        </Box>
      </Flex>
    );

  if (!zoom) return frame;
  /*
   * The picture's row is its viewport. At fit the frame sits where the
   * layout put it and nothing is transformed; zoomed, the frame moves and
   * scales inside this box and the box clips it. The box takes the keys and
   * the gestures, so it is focusable and says how.
   */
  return (
    <figure
      ref={zoom.viewRef}
      className="sc-stage-view"
      aria-label="Picture. Plus and minus zoom, 0 fits, 1 is actual size."
      {...zoom.viewProps}
    >
      {frame}
    </figure>
  );
}

function StagePicture({ hash, alt, zoom }: { hash: string; alt: string; zoom?: StageZoom }) {
  // the derivative stays until the original has pixels; a cached original
  // can be complete before React attaches onLoad, hence the ref check
  const [under, setUnder] = useState(true);
  const attach = (el: HTMLImageElement | null) => {
    zoom?.imgRef(el);
    if (el?.complete && el.naturalWidth) setUnder(false);
  };
  return (
    <Box position="relative" style={{ lineHeight: 0 }}>
      {under && <img className="sc-stage-under" src={thumbUrl(hash, 'tile')} alt="" aria-hidden decoding="async" />}
      <img
        ref={attach}
        src={imgUrl(hash)}
        alt={alt}
        className="sc-stage-img"
        onLoad={(e) => {
          setUnder(false);
          zoom?.onImgLoad(e.currentTarget);
        }}
      />
    </Box>
  );
}
