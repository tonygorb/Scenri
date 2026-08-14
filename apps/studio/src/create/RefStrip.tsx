import { Plus, X } from '@phosphor-icons/react';
import { imgUrl } from '../api.js';
import { Dropzone } from '../layout/Dropzone.js';

/**
 * The pictures you hand over, in every flow that takes pictures.
 *
 * This is the one widget all three creation forms genuinely share, and sharing
 * it is what makes them feel like one system: the same empty dropzone, the same
 * thumbnails, the same little X, whether you are giving Scenri a bottle, a face
 * or a room. What those pictures then mean is entirely the form's business —
 * a presenter's photos are pixels an engine will read, a scene's references
 * are only ever read as prose.
 *
 * Files upload as they are picked rather than on submit. That is what lets the
 * whole form survive being closed: a hash outlives the tab, a File does not.
 */
export function RefStrip({
  hashes,
  max,
  label,
  hint,
  busy,
  onAdd,
  onRemove,
  onReject,
}: {
  hashes: string[];
  max: number;
  /** What to call them here — "photos", "references", "images". */
  label: string;
  hint: string;
  busy: boolean;
  onAdd: (files: File[]) => void;
  onRemove: (hash: string) => void;
  onReject: () => void;
}) {
  if (hashes.length === 0) {
    return (
      <Dropzone label={label} hint={hint} busy={busy} onFiles={onAdd} onReject={onReject}>
        <Plus size={16} />
      </Dropzone>
    );
  }
  return (
    <div className="sc-assetform-refs">
      {hashes.map((h, i) => (
        <span key={h} className="sc-assetform-ref">
          <img src={imgUrl(h)} alt={`Reference ${i + 1}`} />
          <button
            type="button"
            className="sc-assetform-drop"
            aria-label={`Remove reference ${i + 1}`}
            onClick={() => onRemove(h)}
          >
            <X size={11} weight="bold" />
          </button>
        </span>
      ))}
      {hashes.length < max && (
        <Dropzone label="Add" busy={busy} onFiles={onAdd} onReject={onReject}>
          <Plus size={15} />
        </Dropzone>
      )}
    </div>
  );
}
