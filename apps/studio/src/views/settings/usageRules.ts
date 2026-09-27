export const bytes = (n: number) =>
  n > 1e9 ? `${(n / 1e9).toFixed(1)} GB` : n > 1e6 ? `${Math.round(n / 1e6)} MB` : `${Math.round(n / 1e3)} KB`;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function heatLevel(runs: number) {
  return runs === 0 ? 0 : runs < 3 ? 1 : runs < 6 ? 2 : runs < 12 ? 3 : 4;
}

/** A day as this computer's calendar names it: the key the server's local-day counts use. */
function dayKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * One square per day, Sunday-aligned, sized to a number of week columns, the
 * last of them this week up to today.
 *
 * The grid used to end on the most recent Sunday, so everything made since
 * then was missing: on a Saturday six days of work were not drawn, and a first
 * week of use read "Nothing made yet this year". `from` is the first day
 * drawn, so a total beside the grid can count exactly the days it shows.
 */
export function buildHeat(perDay: Map<string, number>, weeks: number) {
  const now = new Date();
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const start = new Date(end);
  start.setDate(end.getDate() - end.getDay() - (weeks - 1) * 7);
  const days = (weeks - 1) * 7 + end.getDay() + 1;
  const cells: { key: string; level: number; title: string }[] = [];
  const months: { key: string; label: string }[] = [];
  let lastMonth = -1;
  let sum = 0;
  for (let i = 0; i < days; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    const key = dayKey(d);
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
  return { cells, months, sum, from: dayKey(start) };
}
