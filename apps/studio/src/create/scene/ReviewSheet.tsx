import type { KeyboardEvent } from 'react';
import { Plus } from '@phosphor-icons/react';

/**
 * The side of the review screen: the name, where it files, what the cover
 * means for this world, and one more view if the set wants it. The picture
 * and the board are the other side; this is only the words.
 */
export function ReviewSheet({
  name,
  onName,
  onSave,
  verticals,
  facets,
  onToggleFacet,
  figureLed,
  addView,
  onAddView,
  coverNote,
}: {
  name: string;
  onName: (v: string) => void;
  onSave: () => void;
  verticals: string[];
  facets: string[];
  onToggleFacet: (v: string) => void;
  figureLed: boolean;
  addView: { ok: boolean; why?: string };
  onAddView: () => void;
  /** Set when the analyzer said what another view would buy. */
  coverNote?: string | null;
}) {
  const submitOnEnter = (e: KeyboardEvent) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    onSave();
  };
  return (
    <div className="sc-sb-review">
      <div className="sc-assetform-field">
        <label className="sc-newdlg-seclabel" htmlFor="sc-scene-name">
          Name
        </label>
        <input
          id="sc-scene-name"
          className="sc-in"
          type="text"
          dir="auto"
          placeholder="Name this place"
          value={name}
          onChange={(e) => onName(e.target.value)}
          onKeyDown={submitOnEnter}
        />
      </div>
      <p className="sc-sb-note">
        {figureLed
          ? 'This cover also stands in beside a presenter, as the world and the treatment.'
          : 'The cover is for the card. A scene reaches a shot as words.'}
        {coverNote ? ` ${coverNote}` : ''}
      </p>
      {verticals.length > 0 && (
        <fieldset className="sc-assetform-facets">
          <legend>Categories</legend>
          <div className="sc-assetform-facets-chips">
            {verticals.map((v) => (
              <button
                type="button"
                key={v}
                className="sc-chip"
                data-on={facets.includes(v) || undefined}
                aria-pressed={facets.includes(v)}
                onClick={() => onToggleFacet(v)}
              >
                {v}
              </button>
            ))}
          </div>
        </fieldset>
      )}
      <button
        type="button"
        className="sc-btn sc-btn-ghost sc-sb-addview"
        aria-disabled={!addView.ok || undefined}
        title={addView.why}
        onClick={() => {
          if (addView.ok) onAddView();
        }}
      >
        <Plus size={12} /> Add another view
      </button>
    </div>
  );
}
