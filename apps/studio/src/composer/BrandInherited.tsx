import { useEffect, useState } from 'react';
import { CaretDown, PaintBrushBroad } from '@phosphor-icons/react';
import { api } from '../api.js';

/**
 * The brand's standing rules, and the fact that they apply.
 *
 * Rules are the one part of a brand that reaches a picture without being asked
 * for — a prohibition the user wrote is a boundary, not taste. This line is
 * what stops that being invisible: something that applies to every shot has to
 * be visible on every shot, or it is the silent-append problem all over again.
 *
 * Opens to the exact text, read from the server rather than re-worded here, so
 * what this claims and what the compiler appends can never drift.
 *
 * Silent when the brand has no rules: a line reading "0 rules" helps nobody.
 */
export function BrandInherited({
  brandId,
  revision,
}: {
  brandId: string;
  /** Bumped when the brand row changes, so an edit in Settings shows up here. */
  revision: string;
}) {
  const [directives, setDirectives] = useState<string[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let live = true;
    api
      .brandRules(brandId)
      .then((r) => live && setDirectives(r.directives))
      .catch(() => live && setDirectives([]));
    return () => {
      live = false;
    };
  }, [brandId, revision]);

  // Deliberately no count. `directives` is one line per *kind* of rule, not one
  // per rule — "1 brand rule applies" for a brand with four of them is worse
  // than no number at all, and the expanded body states them exactly anyway.
  if (!directives.length) return null;

  return (
    <div className="sc-inherit">
      <button type="button" className="sc-inherit-head" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <PaintBrushBroad size={12} />
        <span>Brand rules apply to every shot</span>
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
