import { Plus, X } from '@phosphor-icons/react';
import { thumbUrl } from '../api.js';
import { Dropzone } from '../layout/Dropzone.js';

/**
 * The pictures you hand over, in every flow that takes pictures.
 *
 * Empty: one large well — the material is the subject, not four dead columns.
 * Filled: a 4:5 grid of what arrived, plus room for more. Sharing this widget
 * is what makes the three forms feel like one system.
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
  label: string;
  hint: string;
  busy: boolean;
  onAdd: (files: File[]) => void;
  onRemove: (hash: string) => void;
  onReject: () => void;
}) {
  if (hashes.length === 0) {
    return (
      <div className="sc-assetwell">
        <Dropzone label={label} hint={hint} busy={busy} onFiles={onAdd} onReject={onReject}>
          <Plus size={18} />
        </Dropzone>
      </div>
    );
  }
  const room = max - hashes.length;
  return (
    <div className="sc-assetform-refs">
      {hashes.map((h, i) => (
        <span key={h} className="sc-assetform-ref">
          <img src={thumbUrl(h, 'micro')} alt={`Reference ${i + 1}`} loading="lazy" decoding="async" />
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
      {room > 0 && (
        <Dropzone label={`${room} more`} busy={busy} onFiles={onAdd} onReject={onReject}>
          <Plus size={15} />
        </Dropzone>
      )}
    </div>
  );
}
