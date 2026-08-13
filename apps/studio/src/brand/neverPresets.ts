/**
 * The prohibitions almost every commercial brand wants, offered as one tap.
 *
 * "What we never show" is the one part of a brand kit an ordinary person can
 * answer without creative vocabulary — but only if they are reminded what the
 * question means. A blank field with a placeholder is still a blank page, and
 * the surrounding sections were removed precisely because they demanded
 * language most people do not have.
 *
 * Phrased as the instruction the model receives, not as a category, because
 * that is exactly what they become: `Brand rules — never: <these, joined>`.
 *
 * Suggestions, never defaults. A brand that disagrees simply does not tap one.
 *
 * Kept free of React so test/neverPresets.test.ts covers it directly, the same
 * reason layout/library/libraryRules.ts is a plain module.
 */
export const NEVER_PRESETS: string[] = [
  'competitor logos in frame',
  'visible text or wordmarks on clothing',
  'alcohol',
  'children',
  'visible clutter or mess',
  'heavy skin retouching',
  'neon or harsh colour',
  'pure white studio backgrounds',
];

const key = (s: string) => s.trim().toLowerCase();

/**
 * The presets not already on the list.
 *
 * Matched case- and whitespace-insensitively, so a rule typed by hand stops the
 * chip for the same rule from being offered again.
 */
export function unusedPresets(current: readonly string[] | undefined): string[] {
  const taken = new Set((current ?? []).map(key));
  return NEVER_PRESETS.filter((p) => !taken.has(key(p)));
}
