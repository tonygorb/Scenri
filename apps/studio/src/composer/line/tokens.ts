export type SentenceToken =
  | { t: 'text'; v: string }
  | { t: 'product'; id: string; angle?: string }
  | { t: 'character'; id: string }
  | { t: 'color'; hex: string; name?: string }
  | { t: 'ref'; imageHash: string; label?: string }
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
/**
 * A token's canonical identity, for collapsing own and carried context into
 * one chip per thing. A product's angle is presentation, not identity — the
 * same product carried at another angle is still the same chip — and every
 * other kind keys on its full encoded form. Text and format key to nothing.
 */
export const identityKeyOf = (t: SentenceToken): string =>
  t.t === 'product' ? `p:${t.id}` : t.t === 'ref' ? `r:${t.imageHash}` : encode(t);

/**
 * One chip per thing, across what was asked and what was carried: a token
 * that appears both asked-for and carried, or carried at another angle, is
 * the same ingredient. Own copies win, so the spoken order survives, and the
 * record and the composer agree because they both come through here.
 */
export function mergeCarried(
  tokens: readonly BriefToken[],
  inherited: readonly BriefToken[],
): { own: SentenceToken[]; carried: SentenceToken[] } {
  const seen = new Set<string>();
  const keep = (t: SentenceToken) => {
    const k = identityKeyOf(t);
    if (!k) return true;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  };
  const own = tokens.filter(isSentence).filter(keep);
  const carried = inherited.filter(isSentence).filter(keep);
  return { own, carried };
}

export function briefTokens(brief: {
  tokens: BriefToken[];
  templateId?: string;
  inherited?: BriefToken[];
}): SentenceToken[] {
  // Carried context is part of the setup. The detail view lists an inherited
  // mark or reference as an ingredient of the shot, so "reuse setup" has to
  // rebuild the brief with it or the two disagree about what the shot was.
  const { own, carried } = mergeCarried(brief.tokens ?? [], brief.inherited ?? []);
  const all = [...own, ...carried];
  const body = all.length ? all : emptySentence();
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
            ? // the label is what the chip says (a shot, a file's name); the
              // picture is the identity
              `r:${t.imageHash}${t.label ? `|${t.label}` : ''}`
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
  if (kind === 'r') {
    // the hash never holds a bar; a file's name might, so the label is the rest
    const bar = rest.indexOf('|');
    const imageHash = bar < 0 ? rest : rest.slice(0, bar);
    const label = bar < 0 ? '' : rest.slice(bar + 1);
    return imageHash ? { t: 'ref', imageHash, ...(label ? { label } : {}) } : null;
  }
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
