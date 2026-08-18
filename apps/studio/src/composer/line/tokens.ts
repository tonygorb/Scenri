export type SentenceToken =
  | { t: 'text'; v: string }
  | { t: 'product'; id: string; angle?: string }
  | { t: 'character'; id: string }
  | { t: 'color'; hex: string; name?: string }
  | { t: 'ref'; imageHash: string }
  | { t: 'mark'; imageHash: string }
  | { t: 'template'; id: string };

/** Size lives on the composer, not in the sentence: it renders as nothing. */
export type FormatToken = { t: 'format'; id: string; w: number; h: number };
export type BriefToken = SentenceToken | FormatToken;

export const isSentence = (t: BriefToken): t is SentenceToken => t.t !== 'format';
export const emptySentence = (): SentenceToken[] => [{ t: 'text', v: '' }];

/**
 * A stored brief's tokens, ready to seed a sentence: its size is not sentence
 * content and is dropped, and a legacy brief's bare `templateId` (no token for
 * it yet) is folded into a real template token so the chip shows up. Shared by
 * the Composer's own initialBrief hydration and by anything that needs to
 * write a brief into the persisted per-brand draft using the exact same rules.
 */
export function briefTokens(brief: { tokens: BriefToken[]; templateId?: string }): SentenceToken[] {
  const carried = (brief.tokens ?? []).filter(isSentence);
  const body = carried.length ? carried : emptySentence();
  const hasTemplateToken = body.some((t) => t.t === 'template');
  return brief.templateId && !hasTemplateToken ? [{ t: 'template', id: brief.templateId }, ...body] : body;
}

export const CHIP = 'sc-token';
export const CHIP_SELECTOR = `.${CHIP}`;

// ---------------------------------------------------------------- tokens <-> attribute

export const encode = (t: SentenceToken): string =>
  t.t === 'template'
    ? `t:${t.id}`
    : t.t === 'product'
      ? // `angle` is the slot a recipe asked for (e.g. a macro example
        // pinning "material-closeup"). It used to be omitted here, so every
        // round-trip through the DOM silently reset the product to its default
        // angle and "Recreate this" could not reproduce its own tile.
        `p:${t.id}${t.angle ? `|${t.angle}` : ''}`
      : t.t === 'character'
        ? `h:${t.id}`
        : t.t === 'color'
          ? `c:${t.hex}|${t.name ?? ''}`
          : t.t === 'ref'
            ? `r:${t.imageHash}`
            : t.t === 'mark'
              ? `m:${t.imageHash}`
              : '';

export const decode = (s: string): SentenceToken | null => {
  const kind = s.slice(0, 1);
  const rest = s.slice(2);
  if (kind === 't') return rest ? { t: 'template', id: rest } : null;
  if (kind === 'p') {
    const [id, angle] = rest.split('|');
    return id ? { t: 'product', id, ...(angle ? { angle } : {}) } : null;
  }
  if (kind === 'h') return rest ? { t: 'character', id: rest } : null;
  if (kind === 'r') return rest ? { t: 'ref', imageHash: rest } : null;
  if (kind === 'm') return rest ? { t: 'mark', imageHash: rest } : null;
  // 'b' was the brand-kit chip. Brand rules apply on their own now, so a draft
  // saved while it existed decodes to nothing rather than to a dead token.
  if (kind === 'c') {
    const [hex, name] = rest.split('|');
    return hex ? { t: 'color', hex, name: name || undefined } : null;
  }
  return null;
};

export const groupOf = (t: SentenceToken): string | null =>
  t.t === 'template'
    ? 'Scenes'
    : t.t === 'product'
      ? 'Products'
      : t.t === 'character'
        ? 'Presenters'
        : t.t === 'color'
          ? 'Brand colors'
          : t.t === 'ref'
            ? 'Recent shots'
            : t.t === 'mark'
              ? 'Brand'
              : null;
