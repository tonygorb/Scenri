import { describe, it, expect } from 'vitest';
import { briefChangeLine, briefChanges, briefProse, sourceImageOf } from '../src/briefDiff.js';
import type { TokenNames } from '../src/feedRules.js';
import type { TreeNode } from '../src/api.js';

const names: TokenNames = {
  product: (id) => ({ 'aurelia-serum': 'Aurelia serum', 'cold-brew': 'Cold brew can' })[id] ?? null,
  person: (id) => ({ mara: 'Mara', dax: 'Dax' })[id] ?? null,
  scene: (id) => ({ 'ice-core': 'Ice Core', 'salt-flat': 'Mirror Salt Flat' })[id] ?? null,
};

/** A stored brief, the same shape a shot carries. */
const brief = (...tokens: any[]): TreeNode['brief'] => ({ tokens });
const text = (v: string) => ({ t: 'text', v });

describe('briefChanges', () => {
  it('says nothing when the setup did not move', () => {
    const b = brief({ t: 'product', id: 'aurelia-serum' }, text('on wet rocks'));
    expect(briefChanges(b, brief(...(b?.tokens ?? [])), names)).toEqual([]);
  });

  it('reads one out and one in as a swap', () => {
    expect(briefChanges(brief({ t: 'character', id: 'mara' }), brief({ t: 'character', id: 'dax' }), names)).toEqual([
      'presenter Mara to Dax',
    ]);
  });

  it('names an ingredient that was added, and one that was dropped', () => {
    expect(briefChanges(brief(), brief({ t: 'template', id: 'ice-core' }), names)).toEqual(['scene Ice Core added']);
    expect(briefChanges(brief({ t: 'character', id: 'mara' }), brief(), names)).toEqual(['presenter Mara removed']);
  });

  it('counts colours and references rather than naming them', () => {
    const from = brief({ t: 'color', hex: '#D96C3B' });
    const to = brief({ t: 'color', hex: '#D96C3B' }, { t: 'ref', imageHash: 'abc' }, { t: 'ref', imageHash: 'def' });
    expect(briefChanges(from, to, names)).toEqual(['2 references added']);
  });

  it('quotes a short instruction and summarises a long one', () => {
    expect(briefChanges(brief(text('a')), brief(text('make it tighter')), names)).toEqual(['“make it tighter”']);
    const long = 'a'.repeat(70);
    expect(briefChanges(brief(text('a')), brief(text(long)), names)).toEqual(['wording changed']);
  });

  it('still speaks when the catalog has forgotten the id', () => {
    expect(briefChanges(brief({ t: 'product', id: 'gone-2019' }), brief(), names)).toEqual([
      'product a product removed',
    ]);
  });

  it('counts carried context as present, not removed', () => {
    // a refinement stores the parent's mark and ref under `inherited`, not
    // `tokens` — the change line must read them as still there
    const from = brief({ t: 'mark', imageHash: 'm1' }, { t: 'ref', imageHash: 'r1' }, text('a serum bottle'));
    const to = {
      tokens: [text('warmer light')],
      inherited: [
        { t: 'mark', imageHash: 'm1' },
        { t: 'ref', imageHash: 'r1' },
      ],
    } as TreeNode['brief'];
    expect(briefChanges(from, to, names)).toEqual(['“warmer light”']);
  });

  it('treats an unknown before as no change, not as everything changing', () => {
    // shots made before briefs existed carry null, and inventing a diff against
    // nothing would put a confident sentence under every one of them
    expect(briefChanges(null, brief({ t: 'product', id: 'aurelia-serum' }), names)).toEqual([]);
    expect(briefChanges(brief({ t: 'product', id: 'aurelia-serum' }), null, names)).toEqual([]);
  });

  it('reports several ingredients in the order a person notices them', () => {
    const from = brief({ t: 'product', id: 'aurelia-serum' }, { t: 'template', id: 'ice-core' });
    const to = brief(
      { t: 'product', id: 'cold-brew' },
      { t: 'character', id: 'mara' },
      { t: 'template', id: 'salt-flat' },
    );
    expect(briefChanges(from, to, names)).toEqual([
      'product Aurelia serum to Cold brew can',
      'presenter Mara added',
      'scene Ice Core to Mirror Salt Flat',
    ]);
  });
});

describe('briefChangeLine', () => {
  it('is null when there is nothing worth saying', () => {
    expect(briefChangeLine(brief(text('same')), brief(text('same')), names)).toBeNull();
  });

  it('caps what a glance carries and counts the rest', () => {
    const from = brief({ t: 'product', id: 'aurelia-serum' }, { t: 'character', id: 'mara' });
    const to = brief(
      { t: 'product', id: 'cold-brew' },
      { t: 'character', id: 'dax' },
      { t: 'template', id: 'ice-core' },
      { t: 'ref', imageHash: 'x' },
      text('and a whole new instruction'),
    );
    const line = briefChangeLine(from, to, names)!;
    expect(line.startsWith('Changed: ')).toBe(true);
    expect(line).toContain('and 2 more');
  });
});

describe('sourceImageOf', () => {
  const run = { id: 'run', images: ['a', 'b', 'c', 'd'] } as unknown as TreeNode;
  const editFrom = (hash?: string) =>
    ({ id: 'edit', brief: hash ? { tokens: [], sourceImage: hash } : { tokens: [] } }) as unknown as TreeNode;

  it('uses the frame the refinement was actually made from', () => {
    expect(sourceImageOf(editFrom('c'), run)).toBe('c');
  });

  it('falls back to the first frame for shots made before it was recorded', () => {
    // a guess, and the only one available — but it must not claim more
    expect(sourceImageOf(editFrom(undefined), run)).toBe('a');
  });

  it('ignores a recorded frame the parent no longer has', () => {
    expect(sourceImageOf(editFrom('gone'), run)).toBe('a');
  });

  it('has nothing to offer without a parent', () => {
    expect(sourceImageOf(editFrom('c'), null)).toBeUndefined();
  });
});

describe('briefProse', () => {
  const names = {
    product: (id: string) => (id === 'p' ? 'Amber Serum' : null),
    person: (id: string) => (id === 'c' ? 'Maren' : null),
    scene: () => null,
    mark: (hash: string) => (hash === 'm1' ? 'Acme wordmark' : null),
  };

  it('speaks the sentence with its nouns in place, not with holes where chips sat', () => {
    const node = {
      prompt: 'Amber bottle on rocks. The attached product images all show the exact same product...',
      brief: { tokens: [{ t: 'product', id: 'p' }, text(' on wet dark rocks at sunset')] },
    } as unknown as TreeNode;
    expect(briefProse(node, names)).toBe('Amber Serum on wet dark rocks at sunset');
  });

  it('names marks and references, and keeps punctuation attached to its word', () => {
    const node = {
      prompt: 'compiled',
      brief: {
        tokens: [
          text('add this '),
          { t: 'mark', imageHash: 'm1' },
          text(' to the '),
          { t: 'product', id: 'p' },
          text(' . like '),
          { t: 'ref', imageHash: 'r1' },
        ],
      },
    } as unknown as TreeNode;
    expect(briefProse(node, names)).toBe('add this Acme wordmark to the Amber Serum. like the attached reference');
  });

  it('speaks honest fallbacks for ids the catalogs no longer know', () => {
    const node = {
      prompt: 'compiled',
      brief: {
        tokens: [
          { t: 'product', id: 'gone' },
          { t: 'character', id: 'gone' },
          { t: 'mark', imageHash: 'x' },
        ],
      },
    } as unknown as TreeNode;
    expect(briefProse(node, names)).toBe('a product a presenter the brand mark');
  });

  it('falls back to the compiled prompt for shots made before briefs were stored', () => {
    const node = { prompt: 'an older shot', brief: null } as unknown as TreeNode;
    expect(briefProse(node, names)).toBe('an older shot');
  });
});
