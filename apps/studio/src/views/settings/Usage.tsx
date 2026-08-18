import { useMemo } from 'react';
import type { TreeNode } from '../../api.js';
import { Group } from './Group.js';
import { buildHeat } from './usageRules.js';

function HeatRange({
  weeks,
  months,
  cells,
}: {
  weeks: number;
  months: { key: string; label: string }[];
  cells: { key: string; level: number; title: string }[];
}) {
  return (
    <div className="sc-heat-range" data-weeks={weeks}>
      <div className="sc-heat-months">
        {months.map((m) => (
          <span key={m.key}>{m.label}</span>
        ))}
      </div>
      <div className="sc-heat-grid">
        {cells.map((c) => (
          <i key={c.key} data-l={c.level || undefined} title={c.title} />
        ))}
      </div>
    </div>
  );
}

/**
 * A year of real runs, one square per day.
 *
 * This used to fetch up to forty project trees to draw one grid, and silently
 * told the truth about only the first forty. The brand's shots are already in
 * hand upstairs, so it now counts what it was given.
 */
export function Usage({ shots }: { shots: TreeNode[] }) {
  const nodes = useMemo(() => shots.filter((n) => n.kind !== 'root'), [shots]);

  const { year, quarter, total, byKind } = useMemo(() => {
    const perDay = new Map<string, number>();
    const kinds = { generation: 0, edit: 0 };
    for (const n of nodes ?? []) {
      const day = String(n.createdAt).slice(0, 10);
      perDay.set(day, (perDay.get(day) ?? 0) + 1);
      if (n.kind === 'edit') kinds.edit++;
      else kinds.generation++;
    }
    const year = buildHeat(perDay, 53);
    const quarter = buildHeat(perDay, 13);
    return { year, quarter, total: year.sum, byKind: kinds };
  }, [nodes]);

  if (nodes === null) return <p className="sc-set-empty">Reading your library…</p>;

  const most = Math.max(byKind.generation, byKind.edit, 1);
  return (
    <>
      <Group title="The last year" sub="One square per day, counted from your own runs.">
        <div className="sc-heat">
          <div className="sc-heat-h">
            <b>{total.toLocaleString()} runs in the last year</b>
          </div>
          <HeatRange weeks={53} months={year.months} cells={year.cells} />
          <HeatRange weeks={13} months={quarter.months} cells={quarter.cells} />
        </div>
      </Group>
      <Group title="By activity">
        <div className="sc-bars">
          <div className="sc-bar">
            <span className="k">Generations</span>
            <span className="t">
              <i style={{ width: `${(byKind.generation / most) * 100}%` }} />
            </span>
            <span className="v">{byKind.generation}</span>
          </div>
          <div className="sc-bar">
            <span className="k">Edits</span>
            <span className="t">
              <i style={{ width: `${(byKind.edit / most) * 100}%` }} />
            </span>
            <span className="v">{byKind.edit}</span>
          </div>
        </div>
      </Group>
    </>
  );
}
