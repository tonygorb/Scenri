import { useEffect, useMemo, useState } from 'react';
import { Plus } from '@phosphor-icons/react';
import type { Candidate, IngredientKind } from '../../composer/ingredientOptions.js';
import { RAIL_BATCH, RAIL_COMPACT, RAIL_EXPANDED, railSlice } from '../railSections.js';
import { AssetCard } from './AssetCard.js';
import { Group } from './Group.js';
import type { SectionMode } from './useShape.js';

export function Section({
  kind,
  title,
  items,
  attached,
  mode,
  onToggle,
  onPick,
  moreLabel,
  createLabel,
  onCreate,
}: {
  kind: IngredientKind;
  title: string;
  items: Candidate[];
  attached: string[];
  mode: SectionMode;
  onToggle: (key: string) => void;
  onPick: (id: string) => void;
  moreLabel: string;
  createLabel: string;
  onCreate: () => void;
}) {
  const on = useMemo(() => new Set(attached), [attached]);
  const [shown, setShown] = useState(RAIL_EXPANDED);
  // A section you closed and reopened starts at the top again. Coming back to
  // find four hundred tiles still unrolled from ten minutes ago is a section
  // that remembers something nobody asked it to.
  useEffect(() => {
    if (mode !== 'open') setShown(RAIL_EXPANDED);
  }, [mode]);

  // A search that turned nothing up in this kind takes the whole section with
  // it. A row of headings over five empty shelves is a worse answer than one
  // sentence saying so.
  if (mode === 'result' && items.length === 0) return null;

  return (
    <Group
      name={title}
      count={items.length}
      mode={mode}
      onToggle={() => onToggle(kind)}
      action={
        <button type="button" className="sc-aadd" title={createLabel} aria-label={createLabel} onClick={onCreate}>
          <Plus size={10} />
        </button>
      }
    >
      {(shape) => {
        const { visible, more } = railSlice(items, on, shape === 'open' ? shown : RAIL_COMPACT);
        return (
          <div className={shape === 'open' ? 'sc-acard-grid' : 'sc-arow'}>
            {visible.map((c) => (
              <AssetCard
                key={c.id}
                candidate={c}
                on={on.has(c.id)}
                named={shape === 'open'}
                onClick={() => onPick(c.id)}
              />
            ))}
            {shape === 'open' && more > 0 && (
              <button
                type="button"
                className="sc-amore-tile"
                onClick={() => setShown((n) => n + RAIL_BATCH)}
                aria-label={`Show ${Math.min(more, RAIL_BATCH)} more ${moreLabel}`}
              >
                <span className="sc-amore-n">+{more}</span>
                <span className="sc-amore-t">more</span>
              </button>
            )}
          </div>
        );
      }}
    </Group>
  );
}

/** A tile. One click attaches it; there is nothing else it does. */
