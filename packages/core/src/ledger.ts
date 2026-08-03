import type { DB } from './db.js';

export class SpendCapError extends Error {
  constructor(engineId: string, cap: number, spent: number, estimate: number) {
    super(
      `Spend cap for ${engineId}: $${cap.toFixed(2)}/mo. Spent $${spent.toFixed(2)}, next ~$${estimate.toFixed(2)} would exceed it.`,
    );
    this.name = 'SpendCapError';
  }
}

export interface Ledger {
  recordCost(engineId: string, nodeId: string | null, usd: number): void;
  monthlySpend(engineId: string): number;
  totalSpendByEngine(): Record<string, number>;
  setCap(engineId: string, capUsd: number | null): void;
  capFor(engineId: string): number | null;
  caps(): Record<string, number>;
  assertUnderCap(engineId: string, nextEstimate: number): void;
}

export function createLedger(db: DB): Ledger {
  const monthStart = () => {
    const d = new Date();
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`;
  };
  return {
    recordCost(engineId, nodeId, usd) {
      if (usd > 0)
        db.prepare('INSERT INTO cost_events (engine_id, node_id, cost_usd) VALUES (?,?,?)').run(engineId, nodeId, usd);
    },
    monthlySpend(engineId) {
      const row = db
        .prepare('SELECT COALESCE(SUM(cost_usd),0) s FROM cost_events WHERE engine_id=? AND ts >= ?')
        .get(engineId, monthStart()) as { s: number };
      return row.s;
    },
    totalSpendByEngine() {
      const rows = db
        .prepare('SELECT engine_id, COALESCE(SUM(cost_usd),0) s FROM cost_events WHERE ts >= ? GROUP BY engine_id')
        .all(monthStart()) as { engine_id: string; s: number }[];
      return Object.fromEntries(rows.map((r) => [r.engine_id, r.s]));
    },
    setCap(engineId, capUsd) {
      if (capUsd === null) db.prepare('DELETE FROM spend_caps WHERE engine_id=?').run(engineId);
      else
        db.prepare(
          'INSERT INTO spend_caps (engine_id, monthly_cap_usd) VALUES (?,?) ON CONFLICT(engine_id) DO UPDATE SET monthly_cap_usd=excluded.monthly_cap_usd',
        ).run(engineId, capUsd);
    },
    capFor(engineId) {
      const row = db.prepare('SELECT monthly_cap_usd c FROM spend_caps WHERE engine_id=?').get(engineId) as
        | { c: number }
        | undefined;
      return row ? row.c : null;
    },
    caps() {
      const rows = db.prepare('SELECT engine_id, monthly_cap_usd c FROM spend_caps').all() as {
        engine_id: string;
        c: number;
      }[];
      return Object.fromEntries(rows.map((r) => [r.engine_id, r.c]));
    },
    assertUnderCap(engineId, nextEstimate) {
      const cap = this.capFor(engineId);
      if (cap === null) return;
      const spent = this.monthlySpend(engineId);
      if (spent + nextEstimate > cap) throw new SpendCapError(engineId, cap, spent, nextEstimate);
    },
  };
}
