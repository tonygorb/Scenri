import type { FacetMode } from './libraryRules.js';

export interface FacetOption {
  value: string;
  label: string;
  count: number;
}

export interface FacetGroup {
  key: string;
  label: string;
  /** The "clear this facet" option, e.g. "Every product". */
  everyLabel: string;
  everyCount: number;
  options: FacetOption[];
  selected: string | null;
  onSelect: (value: string | null) => void;
}

/**
 * One facet, rendered as real inline tabs — the same `.sc-verticals` pattern
 * every library page uses, never hidden behind a "Filters" button. `.sc-verticals`
 * already scrolls horizontally, so a long value list (a roster's category
 * list, say) stays usable without collapsing into a menu.
 */
export function FacetFilter({ mode, group }: { mode: FacetMode; group?: FacetGroup }) {
  if (mode === 'none' || !group) return null;

  return (
    <div className="sc-verticals" role="tablist" aria-label={group.label}>
      <button
        type="button"
        role="tab"
        aria-selected={!group.selected}
        data-on={!group.selected ? '' : undefined}
        onClick={() => group.onSelect(null)}
      >
        {group.everyLabel} <span className="sc-vcount">{group.everyCount}</span>
      </button>
      {group.options.map((o) => (
        <button
          type="button"
          key={o.value}
          role="tab"
          aria-selected={group.selected === o.value}
          data-on={group.selected === o.value ? '' : undefined}
          onClick={() => group.onSelect(o.value)}
        >
          {o.label} <span className="sc-vcount">{o.count}</span>
        </button>
      ))}
    </div>
  );
}
