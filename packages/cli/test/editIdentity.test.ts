import { describe, it, expect } from 'vitest';
import { inheritedIdentityTokens, type NodeLike } from '../src/editIdentity.js';
import type { BriefToken } from '../src/brief.js';

const product: BriefToken = { t: 'product', id: 'p1' } as BriefToken;
const person: BriefToken = { t: 'character', id: 'c1' } as BriefToken;
const ref: BriefToken = { t: 'ref', hash: 'r1' } as unknown as BriefToken;

const nodes = (list: NodeLike[]) => {
  const byId = new Map(list.map((n) => [n.id, n]));
  return (id: string) => byId.get(id);
};

const gen = (id: string, tokens: BriefToken[], parentId: string | null = 'root'): NodeLike => ({
  id,
  parentId,
  kind: 'generation',
  brief: { tokens },
});
const refine = (
  id: string,
  parentId: string,
  brief: object | null = { tokens: [{ t: 'text', v: 'warmer' }] },
): NodeLike => ({
  id,
  parentId,
  kind: 'edit',
  brief,
});
const root: NodeLike = { id: 'root', parentId: null, kind: 'root', brief: null };

describe('inheritedIdentityTokens', () => {
  it('borrows the parent generation identity in one hop', () => {
    const get = nodes([root, gen('g', [product, person])]);
    expect(inheritedIdentityTokens('g', get)).toEqual({ tokens: [product, person], truncated: false });
  });

  it('walks token-less refinements up to the generation the thread started from', () => {
    const get = nodes([root, gen('g', [product]), refine('e1', 'g'), refine('e2', 'e1')]);
    expect(inheritedIdentityTokens('e2', get).tokens).toEqual([product]);
  });

  it('reads the inherited record, so a modern chain resolves at its parent however deep it runs', () => {
    // Only g and e20's parent are ever visited: every refinement recorded the
    // union at creation, so the walk stops at hop one.
    const chain: NodeLike[] = [root, gen('g', [product, person])];
    for (let i = 1; i <= 20; i++) {
      chain.push(refine(`e${i}`, i === 1 ? 'g' : `e${i - 1}`, { tokens: [], inherited: [product, person] }));
    }
    const get = nodes(chain);
    expect(inheritedIdentityTokens('e20', get).tokens).toEqual([product, person]);
  });

  it('a mid-chain refinement with its own ref no longer sheds the product above it', () => {
    // The old walk stopped at the first ancestor with ANY identity token, so a
    // refine that attached a mood image became the thread's whole identity.
    const get = nodes([
      root,
      gen('g', [product]),
      refine('e1', 'g', { tokens: [ref], inherited: [product] }),
      refine('e2', 'e1'),
    ]);
    expect(inheritedIdentityTokens('e2', get).tokens).toEqual([ref, product]);
  });

  it('dedupes a token that is both own and inherited', () => {
    const get = nodes([root, gen('g', [product]), refine('e1', 'g', { tokens: [product], inherited: [product] })]);
    expect(inheritedIdentityTokens('e1', get).tokens).toEqual([product]);
  });

  it('a legacy chain deeper than the cap reports truncation instead of silence', () => {
    const chain: NodeLike[] = [root, gen('g', [product])];
    for (let i = 1; i <= 70; i++) chain.push(refine(`e${i}`, i === 1 ? 'g' : `e${i - 1}`));
    const get = nodes(chain);
    const out = inheritedIdentityTokens('e70', get);
    expect(out.tokens).toEqual([]);
    expect(out.truncated).toBe(true);
  });

  it('a bare thread has nothing to borrow, and says so without truncation', () => {
    const get = nodes([root, gen('g', []), refine('e1', 'g')]);
    expect(inheritedIdentityTokens('e1', get)).toEqual({ tokens: [], truncated: false });
  });

  it('a cycle terminates instead of walking forever', () => {
    const a = refine('a', 'b');
    const b = refine('b', 'a');
    const get = nodes([a, b]);
    expect(inheritedIdentityTokens('a', get)).toEqual({ tokens: [], truncated: false });
  });
});
