import { type KeyboardEvent, useEffect, useRef, useState } from 'react';
import { imgUrl, thumbUrl } from '../../api.js';
import { STUDIO_VIEWS, VIEW_LABEL, type DraftLike, type StudioView } from './studioRules.js';

/**
 * The person, before they are saved: the avatar the small surfaces will use,
 * the three references, a name, and optional filing. Nothing else stands
 * between the approved set and the library.
 */
export function StudioReview({
  draft,
  categories,
  name,
  facets,
  blocker,
  busy,
  onName,
  onFacets,
  onPick,
  onSave,
}: {
  draft: DraftLike;
  categories: string[];
  name: string;
  facets: string[];
  /** Why Save is not ready, or null. */
  blocker: string | null;
  busy: boolean;
  onName: (name: string) => void;
  onFacets: (facets: string[]) => void;
  /** Look at an approved view again, to redo it. */
  onPick: (view: StudioView) => void;
  onSave: () => void;
}) {
  const [touched, setTouched] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  // the name is the one thing left to type, so it takes the keyboard on arrival
  useEffect(() => {
    nameRef.current?.focus();
  }, []);
  const portrait = draft.views.portrait.hash;
  const submitOnEnter = (e: KeyboardEvent) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    if (!blocker && !busy) onSave();
  };
  return (
    <div className="sc-studio-review">
      {portrait && (
        <div className="sc-studio-review-avatar">
          <img src={imgUrl(portrait)} alt={`${name.trim() || 'The presenter'}, avatar`} />
        </div>
      )}
      <section className="sc-studio-review-refs" aria-label="Reference views">
        {STUDIO_VIEWS.map((v) => {
          const h = draft.views[v].hash;
          return (
            <button
              type="button"
              key={v}
              className="sc-studio-review-ref"
              aria-label={`${VIEW_LABEL[v]}, approved. Look again or redo.`}
              onClick={() => onPick(v)}
            >
              {h ? <img src={thumbUrl(h, 'tile')} alt="" loading="lazy" /> : null}
              <span>{VIEW_LABEL[v]}</span>
            </button>
          );
        })}
      </section>
      <div className="sc-studio-review-fields">
        <label className="sc-newdlg-seclabel" htmlFor="sc-studio-name">
          Name
        </label>
        <input
          id="sc-studio-name"
          ref={nameRef}
          className="sc-in"
          type="text"
          placeholder="Their name"
          maxLength={60}
          value={name}
          onChange={(e) => {
            setTouched(true);
            onName(e.target.value);
          }}
          onKeyDown={submitOnEnter}
        />
        {categories.length > 0 && (
          <fieldset className="sc-assetform-facets">
            <legend>Categories</legend>
            <div className="sc-assetform-facets-chips">
              {categories.map((c) => {
                const on = facets.includes(c);
                return (
                  <button
                    type="button"
                    key={c}
                    className="sc-chip"
                    data-on={on || undefined}
                    aria-pressed={on}
                    onClick={() => onFacets(on ? facets.filter((f) => f !== c) : [...facets, c])}
                  >
                    {c}
                  </button>
                );
              })}
            </div>
          </fieldset>
        )}
      </div>
      <div className="sc-studio-actions">
        <button
          type="button"
          className="sc-btn sc-btn-primary"
          aria-disabled={blocker ? 'true' : undefined}
          title={blocker ?? undefined}
          disabled={busy}
          onClick={() => {
            if (blocker) setTouched(true);
            else onSave();
          }}
        >
          Save presenter
        </button>
        {touched && blocker && <span className="sc-studio-blocker">{blocker}</span>}
      </div>
    </div>
  );
}
