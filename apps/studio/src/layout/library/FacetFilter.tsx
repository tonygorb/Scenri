import { VerticalsTabs, type VerticalsTabItem } from '../VerticalsTabs.js';
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
 * One facet, rendered as real inline tabs — the shared VerticalsTabs rail
 * every library page uses, never hidden behind a "Filters" button.
 */
export function FacetFilter({ mode, group }: { mode: FacetMode; group?: FacetGroup }) {
  if (mode === 'none' || !group) return null;

  const items: VerticalsTabItem[] = [
    { value: null, label: group.everyLabel, count: group.everyCount },
    ...group.options.map((o) => ({ value: o.value, label: o.label, count: o.count })),
  ];

  return <VerticalsTabs aria-label={group.label} activeKey={group.selected} items={items} onSelect={group.onSelect} />;
}
