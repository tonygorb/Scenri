import { useEffect, useState } from 'react';
import { api, type EngineInfo } from '../../api.js';
import { engineTitle } from '../../engines/active.js';
import { Group } from './Group.js';

export function Budget({
  engines,
  onSaved,
  thisComputer,
}: {
  engines: EngineInfo[];
  onSaved: () => void;
  thisComputer: boolean;
}) {
  const paid = engines.filter((e) => !e.free);
  const [caps, setCaps] = useState<Record<string, string>>({});
  useEffect(() => {
    setCaps(Object.fromEntries(paid.map((e) => [e.id, e.cap === null ? '' : String(e.cap)])));
  }, [engines]); // eslint-disable-line react-hooks/exhaustive-deps

  const commit = async (id: string) => {
    const raw = (caps[id] ?? '').trim();
    const parsed = raw === '' ? null : Number(raw);
    if (parsed !== null && (Number.isNaN(parsed) || parsed < 0)) return;
    await api.setCap(id, parsed);
    onSaved();
  };

  if (!paid.length) {
    return (
      <Group
        title="Monthly caps"
        sub="Nothing to cap yet. Caps apply to engines you pay for per image. Codex usage counts against your ChatGPT plan, which OpenAI meters, not Scenri."
      >
        <p className="sc-set-empty">Add a paid engine key and its cap appears here.</p>
      </Group>
    );
  }

  return (
    <Group
      title="Monthly caps"
      sub={
        // a cap guards the owner's keys, so like them it is set only on the
        // computer running Scenri; a phone holding the code reads it
        thisComputer
          ? 'Your own API budget. Generation stops before a cap is crossed, so a runaway loop cannot spend your month.'
          : 'Your own API budget. Generation stops before a cap is crossed. Caps are set on the computer running Scenri.'
      }
    >
      {paid.map((e) => {
        const left = e.generationsLeft;
        const total = e.generationsTotal;
        const pct = total && total > 0 ? Math.min(100, Math.round(((total - (left ?? 0)) / total) * 100)) : 0;
        const spend = `$${e.monthlySpend.toFixed(2)} this month`;
        return (
          <div className="sc-cap" key={e.id}>
            <div className="sc-cap-top">
              <span className="txt">
                <b>{engineTitle(e.displayName)}</b>
                <small>{left === null ? spend : `${spend} · ${left} left`}</small>
              </span>
              <div className="sc-cap-in">
                <span className="sc-cap-dollar">$</span>
                <input
                  className="sc-in"
                  inputMode="decimal"
                  placeholder="None"
                  value={caps[e.id] ?? ''}
                  onChange={(ev) => setCaps((c) => ({ ...c, [e.id]: ev.target.value }))}
                  onBlur={() => void commit(e.id)}
                  disabled={!thisComputer}
                  aria-label={`${engineTitle(e.displayName)} monthly cap in dollars`}
                />
              </div>
            </div>
            {total !== null && (
              <div className="sc-meter">
                <i style={{ width: `${pct}%` }} />
              </div>
            )}
          </div>
        );
      })}
    </Group>
  );
}
