import { Plus, X } from '@phosphor-icons/react';
import { thumbUrl } from '../../api.js';
import { Dropzone } from '../../layout/Dropzone.js';
import { COPY } from './sceneCopy.js';
import { PICTURES_MAX } from './sceneStudioRules.js';
import type { Upload } from './useSceneStudio.js';

/**
 * The pictures a scene is read from, in the rail.
 *
 * The same tiles every creation flow uses (`.sc-assetform-refs`), with one
 * addition the studio needs: a picture still on its way up is already on
 * screen, drawn from the file itself, breathing until the store answers.
 * There is no reordering because the order means nothing: the reader takes
 * the world the pictures share, and the words say which is for what.
 */
export function ScenePictures({
  hashes,
  uploads,
  disabled,
  caption,
  onAdd,
  onRemove,
  onReject,
}: {
  hashes: string[];
  uploads: Upload[];
  disabled: boolean;
  caption: string;
  onAdd: (files: File[]) => void;
  onRemove: (hash: string) => void;
  onReject: () => void;
}) {
  const room = PICTURES_MAX - hashes.length - uploads.length;
  return (
    <section className="sc-sstudio-sec" aria-labelledby="sc-sstudio-pics-lb">
      <h3 id="sc-sstudio-pics-lb" className="sc-sstudio-lead">
        {COPY.picturesLead}
      </h3>
      <div className="sc-assetform-refs sc-sstudio-pics">
        {hashes.map((h, i) => (
          <span key={h} className="sc-assetform-ref">
            <img
              src={thumbUrl(h, 'micro')}
              alt={`The place, ${i + 1} of ${hashes.length + uploads.length}`}
              loading="lazy"
              decoding="async"
            />
            <button
              type="button"
              className="sc-assetform-drop"
              aria-label={`Remove picture ${i + 1}`}
              disabled={disabled}
              onClick={() => onRemove(h)}
            >
              <X size={11} weight="bold" />
            </button>
          </span>
        ))}
        {uploads.map((u, i) => (
          <span key={u.id} className="sc-assetform-ref" data-uploading>
            <img src={u.url} alt={`The place, ${hashes.length + i + 1}, still adding`} />
          </span>
        ))}
        {room > 0 && !disabled && (
          <Dropzone
            label={hashes.length + uploads.length ? COPY.morePictures(room) : COPY.addPictures}
            busy={false}
            onFiles={onAdd}
            onReject={onReject}
          >
            <Plus size={15} />
          </Dropzone>
        )}
      </div>
      <p className="sc-sstudio-hint">{caption}</p>
      {hashes.length + uploads.length > 1 && <p className="sc-sstudio-hint">{COPY.picturesSayWhich}</p>}
    </section>
  );
}
