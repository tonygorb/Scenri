import type { KeyboardEvent } from 'react';
import { OpenAIMark } from '../../layout/OpenAIMark.js';
import { RefStrip } from '../RefStrip.js';
import { MAX_PHOTOS, photosHint } from './presenterStudioRules.js';

/** Three sentences a person can start from. Text only: an image would be a face, and a face is an identity. */
const EXAMPLES = [
  'Warm man in his 30s, close-cropped beard, easy smile',
  'Athletic woman in her mid 20s, natural curls',
  'Silver-haired man in his 60s, quiet authority',
];

/** From scratch: one sentence, and Scenri draws the person. */
export function ScratchPanel({
  direction,
  onDirection,
  onCreate,
  error,
}: {
  direction: string;
  onDirection: (next: string) => void;
  onCreate: () => void;
  error?: string | null;
}) {
  return (
    <div className="sc-pstudio-field">
      <label className="sc-newdlg-seclabel" htmlFor="sc-pstudio-direction">
        Describe the person
      </label>
      <textarea
        id="sc-pstudio-direction"
        className="sc-in"
        rows={3}
        maxLength={400}
        placeholder="Confident woman in her 40s, short silver hair, natural skin, understated editorial presence"
        value={direction}
        onChange={(e) => onDirection(e.target.value)}
        onKeyDown={(e: KeyboardEvent) => {
          if (e.key !== 'Enter' || e.shiftKey) return;
          e.preventDefault();
          onCreate();
        }}
      />
      <div className="sc-pstudio-examples">
        <span>Try</span>
        {EXAMPLES.map((ex) => (
          <button type="button" key={ex} className="sc-chip" onClick={() => onDirection(ex)}>
            {ex}
          </button>
        ))}
      </div>
      {error && (
        <p className="sc-newdlg-err" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/** Nothing here can draw a person: the same card the composer shows, and the same door out of it. */
export function SetupCard({ onSetup }: { onSetup: () => void }) {
  return (
    <div className="sc-pstudio-card">
      <OpenAIMark />
      <b>Image generation is not set up yet</b>
      <p>
        About a minute, using the ChatGPT account you already have. A person from a description needs it; photos do not.
      </p>
      <button type="button" className="sc-btn sc-btn-primary" onClick={onSetup}>
        Set up
      </button>
    </div>
  );
}

/** From photos: one to four photographs of one person, and the word that they may be used. */
export function PhotosPanel({
  hashes,
  uploading,
  attested,
  canDraw,
  error,
  onAdd,
  onRemove,
  onReject,
  onAttested,
}: {
  hashes: string[];
  uploading: boolean;
  attested: boolean;
  canDraw: boolean;
  error?: string | null;
  onAdd: (files: File[]) => void;
  onRemove: (hash: string) => void;
  onReject: () => void;
  onAttested: (on: boolean) => void;
}) {
  return (
    <div className="sc-pstudio-field sc-pstudio-photos">
      <span className="sc-newdlg-seclabel">Photos</span>
      <RefStrip
        hashes={hashes}
        max={MAX_PHOTOS}
        label="Add 1 to 4 photos"
        hint={photosHint(0)}
        busy={uploading}
        onAdd={onAdd}
        onRemove={onRemove}
        onReject={onReject}
      />
      {hashes.length > 0 && <p className="sc-pstudio-line">{photosHint(hashes.length)}</p>}
      {!canDraw && (
        <p className="sc-pstudio-line">No engine here can draw the other views. The photos are saved as they are.</p>
      )}
      <label className="sc-pstudio-consent">
        <input type="checkbox" checked={attested} onChange={(e) => onAttested(e.target.checked)} />
        <span>
          I confirm this is a real person who is 18 or older and has given me permission to use their likeness in
          commercial images, and that I am responsible for that permission.
        </span>
      </label>
      {error && (
        <p className="sc-newdlg-err" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/** The words that belong to a presenter, asked for once the person exists. */
export function ReviewFields({
  name,
  onName,
  facets,
  onFacets,
  notes,
  onNotes,
  categories,
  details,
  onDetails,
  onEnter,
}: {
  name: string;
  onName: (next: string) => void;
  facets: string[];
  onFacets: (next: string[]) => void;
  notes: string;
  onNotes: (next: string) => void;
  categories: string[];
  details: boolean;
  onDetails: (open: boolean) => void;
  onEnter: () => void;
}) {
  return (
    <div className="sc-pstudio-review">
      <div className="sc-pstudio-field">
        <label className="sc-newdlg-seclabel" htmlFor="sc-pstudio-name">
          Name
        </label>
        <input
          id="sc-pstudio-name"
          className="sc-in"
          type="text"
          maxLength={60}
          placeholder="Their name"
          value={name}
          onChange={(e) => onName(e.target.value)}
          onKeyDown={(e: KeyboardEvent) => {
            if (e.key !== 'Enter') return;
            e.preventDefault();
            onEnter();
          }}
        />
      </div>
      <button
        type="button"
        className="sc-newdlg-secmore"
        aria-expanded={details}
        aria-controls="sc-pstudio-details"
        onClick={() => onDetails(!details)}
      >
        {details ? 'Details' : '+ Details'}
      </button>
      {details && (
        <div id="sc-pstudio-details" className="sc-pstudio-details">
          {categories.length > 0 && (
            <fieldset className="sc-assetform-facets">
              <legend>Categories</legend>
              <div className="sc-assetform-facets-chips">
                {categories.map((v) => (
                  <button
                    type="button"
                    key={v}
                    className="sc-chip"
                    data-on={facets.includes(v) || undefined}
                    aria-pressed={facets.includes(v)}
                    onClick={() => onFacets(facets.includes(v) ? facets.filter((x) => x !== v) : [...facets, v])}
                  >
                    {v}
                  </button>
                ))}
              </div>
            </fieldset>
          )}
          <div className="sc-pstudio-field">
            <label className="sc-newdlg-seclabel" htmlFor="sc-pstudio-notes">
              Notes
            </label>
            <textarea
              id="sc-pstudio-notes"
              className="sc-in"
              rows={2}
              maxLength={400}
              placeholder="Anything worth knowing about them"
              value={notes}
              onChange={(e) => onNotes(e.target.value)}
            />
          </div>
        </div>
      )}
    </div>
  );
}
