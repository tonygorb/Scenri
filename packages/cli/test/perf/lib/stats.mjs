/** p50/p95 over a sample; nearest-rank so a five-sample series still reports honestly. */
export function summarize(values) {
  const a = [...values].filter((v) => Number.isFinite(v)).sort((x, y) => x - y);
  if (!a.length) return { n: 0 };
  const p = (q) => a[Math.min(a.length - 1, Math.max(0, Math.ceil(q * a.length) - 1))];
  const mean = a.reduce((s, v) => s + v, 0) / a.length;
  return {
    n: a.length,
    min: a[0],
    p50: p(0.5),
    p95: p(0.95),
    max: a[a.length - 1],
    mean: Math.round(mean * 100) / 100,
  };
}

export const ms = (v) => (v === undefined || v === null ? '-' : `${Math.round(v * 10) / 10}`);
export const kb = (bytes) => (bytes === undefined || bytes === null ? '-' : `${Math.round(bytes / 102.4) / 10} KB`);
