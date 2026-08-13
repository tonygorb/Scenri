import { describe, it, expect } from 'vitest';
import type { TreeNode } from '../src/api.js';
import {
  FEED_SORTS,
  byNewest,
  filterFeed,
  isFeedSort,
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
