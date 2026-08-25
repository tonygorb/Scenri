import { describe, it, expect } from 'vitest';
import type { TreeNode } from '../src/api.js';
import {
  FEED_SORTS,
  LENSES,
  applyLens,
  byNewest,
  countLenses,
  filterFeed,
  isFeedSort,
  isLens,
  shotSearchText,
  sortFeed,
  type TokenNames,
} from '../src/feedRules.js';

let seq = 0;
function node(overrides: Partial<TreeNode> = {}): TreeNode {
  seq += 1;
  return {
    id: `n${seq}`,
    projectId: 'p1',
    parentId: null,
    kind: 'generation',
    prompt: 'a bottle on a plinth',
    engineId: 'engine-a',
    status: 'done',
    images: [],
    costUsd: 0,
    kept: false,
    error: null,
    createdAt: '2026-08-01T00:00:00Z',
    overlays: {},
    brief: null,
    archived: false,
    ...overrides,
  };
}

/** Resolves the ids the tests use; everything else is unknown. */
const names: TokenNames = {
  product: (id) => (id === 'prod-1' ? 'Glow Serum' : null),
  person: (id) => (id === 'cast-1' ? 'Maya Chen' : null),
  scene: (id) => (id === 'scene-1' ? 'Marble Bathroom' : null),
};

describe('byNewest', () => {
  it('orders descending by createdAt', () => {
    const old = node({ createdAt: '2026-01-01T00:00:00Z' });
    const recent = node({ createdAt: '2026-08-01T00:00:00Z' });
    expect([old, recent].sort(byNewest)).toEqual([recent, old]);
  });

  it('breaks a same-second tie by id, whichever order the rows arrived in', () => {
    // created_at is second-resolution on the server, so the tiebreak is what
    // keeps the feed from reshuffling between two loads
    const a = node({ id: 'node-aaa', createdAt: '2026-08-01T00:00:00Z' });
    const b = node({ id: 'node-bbb', createdAt: '2026-08-01T00:00:00Z' });
    expect([a, b].sort(byNewest).map((n) => n.id)).toEqual(['node-bbb', 'node-aaa']);
    expect([b, a].sort(byNewest).map((n) => n.id)).toEqual(['node-bbb', 'node-aaa']);
  });
});

describe('shotSearchText', () => {
  it('contains the prompt exactly once', () => {
    const text = shotSearchText(node({ prompt: 'unique-marker-prompt' }), names);
    expect(text.split('unique-marker-prompt').length - 1).toBe(1);
  });

  it('resolves product, person and scene tokens to display names', () => {
    const n = node({
      brief: {
        tokens: [
          { t: 'product', id: 'prod-1' },
          { t: 'character', id: 'cast-1' },
          { t: 'template', id: 'scene-1' },
        ],
      },
    });
    const text = shotSearchText(n, names);
    expect(text).toContain('Glow Serum');
    expect(text).toContain('Maya Chen');
    expect(text).toContain('Marble Bathroom');
  });

  it('includes templateFields values, color name and hex, and engine display name', () => {
    const n = node({
      brief: {
        tokens: [{ t: 'color', hex: '#aabbcc', name: 'Dusty Blue' }],
        templateFields: { headline: 'Summer Sale' },
      },
    });
    const text = shotSearchText(n, names, 'Flux Pro');
    expect(text).toContain('Summer Sale');
    expect(text).toContain('Dusty Blue');
    expect(text).toContain('#aabbcc');
    expect(text).toContain('Flux Pro');
  });

  it('skips text tokens (their words already live in the compiled prompt)', () => {
    const n = node({
      prompt: 'compiled prompt',
      brief: { tokens: [{ t: 'text', v: 'duplicated-words' }] },
    });
    expect(shotSearchText(n, names)).not.toContain('duplicated-words');
  });

  it('resolves a legacy bare templateId with no template token', () => {
    const n = node({ brief: { tokens: [], templateId: 'scene-1' } });
    expect(shotSearchText(n, names)).toContain('Marble Bathroom');
  });

  it('never throws on unresolvable ids or a null brief', () => {
    const gone = node({ brief: { tokens: [{ t: 'product', id: 'deleted' }] } });
    expect(() => shotSearchText(gone, names)).not.toThrow();
    expect(shotSearchText(gone, names)).not.toContain('deleted');
    const bare = node({ prompt: 'still findable', brief: null });
    expect(shotSearchText(bare, names)).toContain('still findable');
  });
});

describe('filterFeed', () => {
  const textFor = (n: TreeNode) => shotSearchText(n, names);

  it('returns the input unchanged for an empty or whitespace query', () => {
    const nodes = [node(), node()];
    expect(filterFeed(nodes, '', textFor)).toBe(nodes);
    expect(filterFeed(nodes, '   ', textFor)).toBe(nodes);
  });

  it('matches case-insensitively against the prompt', () => {
    const hit = node({ prompt: 'Golden hour rooftop' });
    const miss = node({ prompt: 'studio white sweep' });
    expect(filterFeed([hit, miss], 'ROOFTOP', textFor)).toEqual([hit]);
  });

  it('matches a resolved product name', () => {
    const hit = node({ brief: { tokens: [{ t: 'product', id: 'prod-1' }] } });
    const miss = node();
    expect(filterFeed([hit, miss], 'glow serum', textFor)).toEqual([hit]);
  });

  it('composes matchesQuery semantics: multi-term AND and trailing plural', () => {
    const hit = node({ prompt: 'a serum bottle at golden hour' });
    expect(filterFeed([hit], 'serums golden', textFor)).toEqual([hit]);
    expect(filterFeed([hit], 'serum rooftop', textFor)).toEqual([]);
  });
});

describe('sortFeed', () => {
  it('newest orders descending by createdAt regardless of input order', () => {
    const a = node({ createdAt: '2026-03-01T00:00:00Z' });
    const b = node({ createdAt: '2026-05-01T00:00:00Z' });
    const c = node({ createdAt: '2026-01-01T00:00:00Z' });
    expect(sortFeed([a, b, c], 'newest')).toEqual([b, a, c]);
    expect(sortFeed([c, b, a], 'newest')).toEqual([b, a, c]);
  });

  it('oldest reverses newest', () => {
    const a = node({ createdAt: '2026-03-01T00:00:00Z' });
    const b = node({ createdAt: '2026-05-01T00:00:00Z' });
    expect(sortFeed([a, b], 'oldest')).toEqual([a, b]);
  });

  it('cost orders by costUsd descending with newest as tiebreak', () => {
    const cheap = node({ costUsd: 0.01, createdAt: '2026-06-01T00:00:00Z' });
    const dear = node({ costUsd: 0.2, createdAt: '2026-01-01T00:00:00Z' });
    const dearNewer = node({ costUsd: 0.2, createdAt: '2026-07-01T00:00:00Z' });
    expect(sortFeed([cheap, dear, dearNewer], 'cost')).toEqual([dearNewer, dear, cheap]);
  });

  it('keepers puts kept shots first, newest within each group', () => {
    const kept = node({ kept: true, createdAt: '2026-01-01T00:00:00Z' });
    const loose = node({ kept: false, createdAt: '2026-08-01T00:00:00Z' });
    const keptNewer = node({ kept: true, createdAt: '2026-06-01T00:00:00Z' });
    expect(sortFeed([kept, loose, keptNewer], 'keepers')).toEqual([keptNewer, kept, loose]);
  });

  it('does not mutate its input', () => {
    const a = node({ createdAt: '2026-01-01T00:00:00Z' });
    const b = node({ createdAt: '2026-08-01T00:00:00Z' });
    const input = [a, b];
    sortFeed(input, 'newest');
    expect(input).toEqual([a, b]);
  });
});

describe('isFeedSort', () => {
  it('accepts every listed sort and rejects junk', () => {
    for (const s of FEED_SORTS) expect(isFeedSort(s.id)).toBe(true);
    expect(isFeedSort('zzz')).toBe(false);
    expect(isFeedSort(undefined)).toBe(false);
    expect(isFeedSort(null)).toBe(false);
  });
});

describe('isLens', () => {
  it('accepts every listed lens and rejects junk', () => {
    for (const l of LENSES) expect(isLens(l.id)).toBe(true);
    expect(isLens('zzz')).toBe(false);
    expect(isLens(undefined)).toBe(false);
  });

  it('rejects "ungrouped", which is a place now and not a lens', () => {
    expect(isLens('ungrouped')).toBe(false);
  });
});

describe('applyLens', () => {
  const kept = node({ kept: true });
  const plain = node();
  const gone = node({ archived: true });

  it('shows the whole live half on all', () => {
    expect(applyLens([kept, plain], [gone], 'all')).toEqual([kept, plain]);
  });

  it('keeps only kept shots on keepers', () => {
    expect(applyLens([kept, plain], [gone], 'keepers')).toEqual([kept]);
  });

  it('swaps to the archived half rather than filtering the live one', () => {
    expect(applyLens([kept, plain], [gone], 'archived')).toEqual([gone]);
  });

  it('composes with a scope: keepers inside a set are that set\u2019s keepers', () => {
    const inSetKept = node({ kept: true });
    const inSetPlain = node();
    const elsewhereKept = node({ kept: true });
    const set = [inSetKept, inSetPlain];
    expect(applyLens(set, [], 'keepers')).toEqual([inSetKept]);
    expect(applyLens(set, [], 'keepers')).not.toContain(elsewhereKept);
  });

  it('never mutates either half', () => {
    const live = [kept, plain];
    const archived = [gone];
    applyLens(live, archived, 'keepers');
    expect(live).toEqual([kept, plain]);
    expect(archived).toEqual([gone]);
  });
});

describe('countLenses', () => {
  const textFor = (n: TreeNode) => n.prompt;
  const kept = node({ kept: true, prompt: 'denim jacket on a plinth' });
  const plain = node({ prompt: 'a bottle on a plinth' });
  const gone = node({ archived: true, prompt: 'denim offcut' });

  it('counts each lens over the scope it is given', () => {
    expect(countLenses([kept, plain], [gone], '', textFor)).toEqual({ all: 2, keepers: 1, archived: 1 });
  });

  it('follows the active search, so a tab says what a click would show', () => {
    expect(countLenses([kept, plain], [gone], 'denim', textFor)).toEqual({ all: 1, keepers: 1, archived: 1 });
    expect(countLenses([kept, plain], [gone], 'bottle', textFor)).toEqual({ all: 1, keepers: 0, archived: 0 });
  });

  it('is scoped: a narrower place reports narrower numbers', () => {
    expect(countLenses([plain], [], '', textFor)).toEqual({ all: 1, keepers: 0, archived: 0 });
  });
});
