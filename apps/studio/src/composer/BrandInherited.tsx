import { useEffect, useState } from 'react';
import { CaretDown, PaintBrushBroad } from '@phosphor-icons/react';
import { api } from '../api.js';

/**
 * What the Brand kit chip is adding to this shot.
 *
 * Shown only while the chip is actually in the sentence — the kit is opt-in, so
 * a brief that did not ask for it has nothing to report. Opens to the exact
 * text, read from the server rather than re-worded here, so what this claims
 * and what the compiler appends can never drift.
 *
 * Silent when the kit is empty: a line reading "0 instructions" helps nobody.
 */
export function BrandInherited({
  brandId,
  revision,
  active,
}: {
  brandId: string;
  /** Bumped when the brand row changes, so an edit in Settings shows up here. */
  revision: string;
  /** True while a Brand kit chip sits in the sentence. */
  active: boolean;
}) {
  const [directives, setDirectives] = useState<string[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let live = true;
    api
      .brandDirectives(brandId)
      .then((r) => live && setDirectives(r.directives))
      .catch(() => live && setDirectives([]));
    return () => {
      live = false;
    };
  }, [brandId, revision]);

  if (!active || !directives.length) return null;
  const n = directives.length;

  return (
    <div className="sc-inherit">
      <button type="button" className="sc-inherit-head" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <PaintBrushBroad size={12} />
        <span>
          Brand kit adds {n} instruction{n === 1 ? '' : 's'} to this shot
        </span>
        <CaretDown size={10} weight="bold" />
      </button>
      {open && (
        <div className="sc-inherit-body">
          {directives.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </div>
      )}
    </div>
  );
}
