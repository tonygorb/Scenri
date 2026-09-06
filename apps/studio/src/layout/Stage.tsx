import { useCallback, useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { Box, Flex, Text } from '@radix-ui/themes';
import { imgUrl, thumbUrl, type FeedNode } from '../api.js';
import { describeCancelled, describeFailure } from '../failure.js';
import { FailureNote } from './Failure.js';
// one clock for the whole app: the canvas and the bell must not disagree
import { elapsedLabel, elapsedSec, runningPhrase } from '../tasks.js';
// the feed's running tiles hold the same shape, from the same source
import { aspectOfFormat } from '../composer/formats.js';

function aspectOf(node: FeedNode): number {
  return aspectOfFormat(node.brief?.format);
}

/** The pixels the run recorded for its first image, when it recorded them. */
export function recordedSize(node: FeedNode): [number, number] | null {
  const size = (node.brief as { rendered?: { sizes?: [number, number][] } } | null)?.rendered?.sizes?.[0];
  return size && size[0] > 0 && size[1] > 0 ? size : null;
}

type ContentRect = { left: number; top: number; width: number; height: number };

export function StageFrame({
  node,
  onRetry,
  onCancel,
  engineName,
  onInspect,
}: {
  node: FeedNode;
  onRetry?: () => void;
  onCancel?: () => void;
  /** What the engine that ran this is called, so a failure can name it. */
  engineName?: string;
  /** Given, the finished picture is a button that opens the viewer. */
  onInspect?: () => void;
}) {
  const [imgEl, setImgEl] = useState<HTMLImageElement | null>(null);
  const [contentRect, setContentRect] = useState<ContentRect | null>(null);
  const [, force] = useState(0);

  useEffect(() => {
    if (node.status !== 'running') return;
    const t = setInterval(() => force((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, [node.status]);

  // object-fit: contain letterboxes inside the element; the editor must sit on
  // the actual image content box or DOM position and flatten output disagree.
  useEffect(() => {
    if (!imgEl) return;
    const compute = () => {
      const { naturalWidth: nw, naturalHeight: nh, clientWidth: cw, clientHeight: ch } = imgEl;
      if (!nw || !nh || !cw || !ch) return;
      const k = Math.min(cw / nw, ch / nh);
      const w = nw * k,
        h = nh * k;
      setContentRect({ left: (cw - w) / 2, top: (ch - h) / 2, width: w, height: h });
    };
    compute();
    imgEl.addEventListener('load', compute);
    const ro = new ResizeObserver(compute);
    ro.observe(imgEl);
    return () => {
      imgEl.removeEventListener('load', compute);
      ro.disconnect();
    };
  }, [imgEl]);

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
  if (hash && size) {
    /*
     * The run recorded its pixels, so the frame takes the picture's box
     * before a byte of it arrives: the same sizing the waiting state uses,
     * bounded by the room there is, the cap, and the picture's own width.
     * Under the original sits the feed's tile derivative, already decoded by
     * the tile that was just clicked, so the stage shows the shot at once
     * and the original replaces it in place when its decode is done.
     */
    return (
      <Box
        className="sc-frame sc-stage-pic"
        style={{ '--sc-pic-ar': size[0] / size[1], '--sc-pic-w': `${size[0]}px` } as CSSProperties}
      >
        <StagePicture
          key={hash}
          hash={hash}
          alt={node.promptHead}
          imgRef={setImgEl}
          contentRect={contentRect}
          onInspect={onInspect}
        />
      </Box>
    );
  }

  const plain = hash && (
    <img
      ref={setImgEl}
      src={imgUrl(hash)}
      alt={node.promptHead}
      // the cap itself lives in CSS, where it can know whether a row of
      // takes sits under the shot: a percentage cannot, because nothing
      // between here and the stage has a definite height to measure
      style={{ display: 'block', maxWidth: '100%' }}
    />
  );
  return (
    <Flex justify="center">
      <Box className="sc-frame" style={{ display: 'inline-block', maxWidth: '100%' }}>
        {hash && (
          <Box position="relative" style={{ lineHeight: 0 }}>
            {onInspect ? <PictureButton onInspect={onInspect}>{plain}</PictureButton> : plain}
            {contentRect && <ContentBox rect={contentRect} />}
          </Box>
        )}
      </Box>
    </Flex>
  );
}

/**
 * The picture is the way into the viewer: one button around the whole
 * photograph, so the whole photograph is the target and the cursor says so.
 * Nothing interactive inside it, and the derivative under the original rides
 * along, since the button is the box both are positioned in.
 */
function PictureButton({ onInspect, children }: { onInspect: () => void; children: ReactNode }) {
  return (
    <button type="button" className="sc-stage-open" aria-label="Zoom" onClick={onInspect}>
      {children}
    </button>
  );
}

function StagePicture({
  hash,
  alt,
  imgRef,
  contentRect,
  onInspect,
}: {
  hash: string;
  alt: string;
  imgRef: (el: HTMLImageElement | null) => void;
  contentRect: ContentRect | null;
  onInspect?: () => void;
}) {
  // the derivative stays until the original has pixels; a cached original
  // can be complete before React attaches onLoad, hence the ref check
  const [under, setUnder] = useState(true);
  const attach = useCallback(
    (el: HTMLImageElement | null) => {
      imgRef(el);
      if (el?.complete && el.naturalWidth) setUnder(false);
    },
    [imgRef],
  );
  const picture = (
    <>
      {under && <img className="sc-stage-under" src={thumbUrl(hash, 'tile')} alt="" aria-hidden decoding="async" />}
      <img ref={attach} src={imgUrl(hash)} alt={alt} className="sc-stage-img" onLoad={() => setUnder(false)} />
    </>
  );
  return (
    <Box position="relative" style={{ lineHeight: 0 }}>
      {onInspect ? <PictureButton onInspect={onInspect}>{picture}</PictureButton> : picture}
      {contentRect && <ContentBox rect={contentRect} />}
    </Box>
  );
}

function ContentBox({ rect }: { rect: ContentRect }) {
  return (
    <div
      style={{
        position: 'absolute',
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
        lineHeight: 'normal',
      }}
    ></div>
  );
}
