import type { ReactNode } from 'react';
import { ImageSquare } from '@phosphor-icons/react';
import { thumbUrl } from '../../api.js';
import { RunningTag } from '../../layout/canvas/RunningTag.js';

/**
 * The large frame: the one being decided on, or the one being drawn. The
 * picture is the whole point of this dialog, so it takes the room; the words
 * about it sit underneath, read out once per change.
 */
export function Stage({
  hash,
  alt,
  drawing,
  since,
  cover,
  status,
  children,
}: {
  /** The frame on the stage, or null while nothing has landed yet. */
  hash: string | null;
  alt: string;
  /** Something is being drawn right now; with no frame, the stage shimmers. */
  drawing: boolean;
  /** When the draw began, for the clock. */
  since: string | null;
  /** This frame is the card. */
  cover: boolean;
  status: string;
  /** What fills the stage before anything is drawn: the upload well. */
  children?: ReactNode;
}) {
  return (
    <div className="sc-sb-stage-wrap">
      <div className="sc-sb-stage" data-drawing={drawing && !hash ? '' : undefined}>
        {hash ? (
          <img key={hash} src={thumbUrl(hash, 'tile')} alt={alt} decoding="async" />
        ) : children ? (
          children
        ) : (
          <span className="sc-sb-blank" aria-hidden>
            {drawing ? <span className="sc-shimmer" /> : <ImageSquare size={22} />}
          </span>
        )}
        {cover && hash && (
          <span className="sc-sb-covertag" aria-hidden>
            Cover
          </span>
        )}
        {drawing && !hash && since && (
          <span className="sc-sb-clock">
            <RunningTag since={since} />
          </span>
        )}
      </div>
      <p className="sc-sb-status" role="status" aria-live="polite">
        {status}
      </p>
    </div>
  );
}
