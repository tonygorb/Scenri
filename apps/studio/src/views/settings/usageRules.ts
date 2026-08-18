export const bytes = (n: number) =>
  n > 1e9 ? `${(n / 1e9).toFixed(1)} GB` : n > 1e6 ? `${Math.round(n / 1e6)} MB` : `${Math.round(n / 1e3)} KB`;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function heatLevel(runs: number) {
  return runs === 0 ? 0 : runs < 3 ? 1 : runs < 6 ? 2 : runs < 12 ? 3 : 4;
}

/** One square per day, Sunday-aligned, sized to a number of week columns. */
export function buildHeat(perDay: Map<string, number>, weeks: number) {
  const days = weeks * 7;
  const end = new Date();
  const start = new Date(end);
  start.setDate(end.getDate() - (days - 1) - end.getDay());
  const cells: { key: string; level: number; title: string }[] = [];
  const months: { key: string; label: string }[] = [];
  let lastMonth = -1;
  let sum = 0;
  for (let i = 0; i < days; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    const key = d.toISOString().slice(0, 10);
    const runs = perDay.get(key) ?? 0;
    sum += runs;
    cells.push({
      key,
      level: heatLevel(runs),
      title: runs
        ? `${runs} run${runs === 1 ? '' : 's'} on ${d.getDate()} ${MONTHS[d.getMonth()]}`
        : `nothing on ${d.getDate()} ${MONTHS[d.getMonth()]}`,
    });
    if (d.getDay() === 0) {
      const opensMonth = d.getMonth() !== lastMonth && d.getDate() <= 7;
      if (opensMonth) lastMonth = d.getMonth();
      months.push({ key, label: opensMonth ? MONTHS[d.getMonth()] : '' });
    }
  }
  return { cells, months, sum };
}
