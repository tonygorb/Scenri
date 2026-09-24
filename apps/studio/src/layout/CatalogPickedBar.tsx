import { Star, Trash, X } from '@phosphor-icons/react';
import type { ReactNode } from 'react';
import { Tip } from './Tip.js';
import type { CatalogMenuIcon } from './catalogMenu.js';

/**
 * What you can do with a handful of catalog cards.
 *
 * The shot bar's shelf, count, Select all and way out, with this wall's one
 * verb in the middle, and Keepers beside it. It does not ride in the composer
 * dock: these pages have no composer. Delete and Discard answer in red, the
 * way Archive does.
 */
export function CatalogPickedBar({
  count,
  loaded,
  tool,
  icon,
  danger,
  onAct,
  keep,
  onClear,
  onSelectAll,
}: {
  count: number;
  /** How many cards of this kind the wall is showing, which is what Select all can reach. */
  loaded: number;
  tool: string;
  icon: CatalogMenuIcon;
  danger?: boolean;
  onAct: () => void;
  /** Keepers for this pick. Drafts have none. */
  keep?: { label: string; filled: boolean; onAct: () => void } | null;
  onClear: () => void;
  onSelectAll: () => void;
}) {
  return (
    <div className="sc-picked" role="toolbar" aria-label="Selection">
      <span className="sc-picked-meta">
        <span className="sc-picked-n" role="status">
          {count}
          <span className="sc-vh"> selected</span>
        </span>
        {loaded > 1 && (
          <button type="button" className="sc-picked-all" onClick={count < loaded ? onSelectAll : onClear}>
            {count < loaded ? 'Select all' : 'Deselect all'}
          </button>
        )}
      </span>

      <span className="sc-picked-rule" aria-hidden />

      <span className="sc-picked-tools">
        {keep && (
          <Tool label={keep.label} onClick={keep.onAct}>
            <Star size={17} weight={keep.filled ? 'fill' : 'regular'} />
          </Tool>
        )}
        <Tool label={tool} tone={danger ? 'danger' : undefined} onClick={onAct}>
          <Glyph name={icon} />
        </Tool>
      </span>

      <span className="sc-picked-rule" aria-hidden />

      <span className="sc-picked-exit">
        <Tool label="Done" onClick={onClear}>
          <X size={16} weight="bold" />
        </Tool>
      </span>
    </div>
  );
}

/** Delete and Discard, at the bar's 17px. Keepers draws its own star. */
function Glyph(_: { name: CatalogMenuIcon }) {
  return <Trash size={17} />;
}

function Tool({
  label,
  tone,
  onClick,
  children,
}: {
  label: string;
  tone?: 'danger';
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Tip label={label}>
      <button type="button" className="sc-picked-tool" data-tone={tone} aria-label={label} onClick={onClick}>
        {children}
      </button>
    </Tip>
  );
}
