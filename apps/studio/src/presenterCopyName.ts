const NAME_MAX = 60;

/**
 * The next free card name for a duplicate: `Maya copy`, then `Maya copy 2`.
 * A name that already ends in that series stays on the same stem, so
 * duplicating `Maya copy` does not become `Maya copy copy`.
 */
export function suggestedPresenterCopyName(name: string, taken: readonly string[], max = NAME_MAX): string {
  const trimmed = name.trim();
  const stem = (trimmed.match(/^(.*?)(?: copy(?: \d+)?)?$/i)?.[1] ?? trimmed).trim() || trimmed;
  const used = new Set(taken.map((n) => n.trim().toLowerCase()).filter(Boolean));
  for (let n = 1; n < 10_000; n++) {
    const suffix = n === 1 ? ' copy' : ` copy ${n}`;
    const room = Math.max(1, max - suffix.length);
    const candidate = `${stem.slice(0, room).trimEnd()}${suffix}`;
    if (!used.has(candidate.toLowerCase())) return candidate;
  }
  return `${stem.slice(0, Math.max(1, max - 5)).trimEnd()} copy`;
}
