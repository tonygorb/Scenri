import { useEffect, useMemo, useState } from 'react';
import { api, type UsageDay } from '../../api.js';
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
export function Usage({ brandId }: { brandId: string }) {
  // Counted by the server, by day, in one query: this used to be handed every
  // shot in the brand to count for itself, so the whole workspace travelled
  // to a settings pane to draw fifty-three columns.
  const [days, setDays] = useState<UsageDay[] | null>(null);
  useEffect(() => {
    let alive = true;
    setDays(null);
    api
      .usage(brandId)
      .then((r) => alive && setDays(r.days))
      .catch(() => alive && setDays([]));
    return () => {
      alive = false;
    };
  }, [brandId]);

  const { year, quarter, total, byKind } = useMemo(() => {
    const perDay = new Map<string, number>();
    const kinds = { generation: 0, edit: 0 };
    for (const d of days ?? []) {
      perDay.set(d.day, (perDay.get(d.day) ?? 0) + d.generations + d.edits);
      kinds.generation += d.generations;
      kinds.edit += d.edits;
    }
    const year = buildHeat(perDay, 53);
    const quarter = buildHeat(perDay, 13);
    return { year, quarter, total: year.sum, byKind: kinds };
  }, [days]);

  if (days === null) return <p className="sc-set-empty">Reading your library…</p>;

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
