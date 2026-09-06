/**
 * What a refinement should still know about the shot it is refining.
 *
 * The composer clears the sentence after every send, so a refine brief is a
 * format token and a line of text. The compiler builds attachments out of
 * product, character, ref and mark tokens, so a refine compiled to nothing:
 * no product reference, no presenter reference, and therefore none of the
 * fidelity language that is keyed on them. The product in the picture had
 * nothing to anchor to except pixels the model was free to redraw, which is
 * why measured product fidelity fell from 7.5 on a first generation to 4.7
 * after a single refine.
 *
 * The fix is to look up the shot being refined and borrow its identity. A
 * node's identity is the union of its own tokens and the `inherited` record
 * its brief carries — the server writes that record onto every refinement at
 * creation, so a modern chain resolves in one hop however deep it runs, and
 * each new refinement re-records the union for the next one. The walk only
 * climbs for older nodes made before the record existed, and for a mid-chain
 * refinement that attached something of its own: its ref token used to stop
 * the walk cold and shed the product two hops up, which the union also fixes.
 */
import type { BriefToken } from './brief.js';

/**
 * How far up a thread of refinements to look before giving up. Only a legacy
 * chain with no `inherited` records can ever walk this far; a modern one
 * stops at its parent. The old cap was 8 and silent, and the ninth
 * consecutive refine of a thread quietly lost every identity reference.
 */
const MAX_HOPS = 64;

export interface NodeLike {
  id: string;
  parentId: string | null;
  kind: string;
  brief: unknown | null;
}

const IDENTITY_KINDS = new Set(['product', 'character', 'mark', 'ref']);

const identityOf = (list: unknown): BriefToken[] =>
  Array.isArray(list) ? (list as BriefToken[]).filter((t) => IDENTITY_KINDS.has(t?.t)) : [];

/**
 * The one identity key for server-side token dedupe, matching the studio's
 * rule (composer line/tokens.ts `identityKeyOf`): a product keys on its id
 * alone — its angle is presentation, so an angled token and its plain twin
 * are the same product, never two — and every other kind on its full shape.
 * Raw JSON.stringify was the old rule, and it silently disagreed with the
 * studio the moment a product token carried an angle.
 */
export const identityTokenKey = (t: BriefToken): string =>
  t?.t === 'product' ? `p:${(t as { id: string }).id}` : JSON.stringify(t);

/**
 * The key a carried identity is named by on the wire when a refinement
 * leaves it out: what the studio sends in `drop`, one per chip. Stable and
 * readable rather than the dedupe key above, which serialises the whole
 * token: a product by id, a person by id, a mark or a reference by hash.
 */
export const carriedKey = (t: BriefToken): string => {
  const x = t as { t: string; id?: string; imageHash?: string };
  if (x.t === 'product') return `p:${x.id}`;
  if (x.t === 'character') return `c:${x.id}`;
  if (x.t === 'mark') return `m:${x.imageHash}`;
  if (x.t === 'ref') return `r:${x.imageHash}`;
  return JSON.stringify(t);
};

export interface InheritedIdentity {
  tokens: BriefToken[];
  /** The walk hit the ceiling with tokens possibly still above it. */
  truncated: boolean;
}

/**
 * The product, presenter, brand mark and reference tokens of the nearest
 * ancestor that has any — where "has any" reads the node's own tokens AND the
 * `inherited` record its brief carries, deduped, own tokens first.
 *
 * References ride too: a mood image the user attached on the first
 * generation is as much a part of the thread's identity as the product is,
 * and a refine that silently forgot it was the reported contract failure.
 * The attachment budget still decides what actually fits an engine's cap;
 * this only decides what the refinement KNOWS about.
 *
 * Returns an empty list rather than throwing when the thread has none, which
 * is the ordinary case for a shot made from a bare sentence.
 */
export function inheritedIdentityTokens(
  parentId: string | null,
  getNode: (id: string) => NodeLike | null | undefined,
): InheritedIdentity {
  let id = parentId;
  const visited = new Set<string>();
  for (let hop = 0; hop < MAX_HOPS && id; hop++) {
    if (visited.has(id)) return { tokens: [], truncated: false };
    visited.add(id);
    const node = getNode(id);
    if (!node || node.kind === 'root') return { tokens: [], truncated: false };
    const brief = node.brief as { tokens?: unknown; inherited?: unknown } | null;
    const own = identityOf(brief?.tokens);
    const carried = identityOf(brief?.inherited);
    if (own.length || carried.length) {
      const seen = new Set<string>();
      const tokens: BriefToken[] = [];
      for (const t of [...own, ...carried]) {
        const key = identityTokenKey(t);
        if (seen.has(key)) continue;
        seen.add(key);
        tokens.push(t);
      }
      return { tokens, truncated: false };
    }
    id = node.parentId;
  }
  return { tokens: [], truncated: id !== null };
}
