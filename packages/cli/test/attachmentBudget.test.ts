import { describe, it, expect } from 'vitest';
import { allocateAttachments, mergeEditAttachments } from '../src/attachmentBudget.js';
import type { Attachment } from '../src/brief.js';

const att = (role: Attachment['role'], hash: string, extra: Partial<Attachment> = {}): Attachment => ({
  role,
  hash,
  label: extra.label ?? hash,
  ...extra,
});

/** The brief that exposed the bug: product (3 angles) + presenter (2 views) + one hand-attached extra. */
const contested = (extra: Attachment): Attachment[] => [
  att('product', 'p1', { id: 'prod', label: 'Aurora Serum', essential: true }),
  att('product', 'p2', { id: 'prod', label: 'Aurora Serum' }),
  att('product', 'p3', { id: 'prod', label: 'Aurora Serum' }),
  att('character', 'c1', { id: 'pers', label: 'Priya', essential: true }),
  att('character', 'c2', { id: 'pers', label: 'Priya' }),
  extra,
];

describe('allocating attachments under an engine cap', () => {
  it('keeps a hand-attached reference ahead of corroboration angles', () => {
    const ref = att('reference', 'r1', { label: 'Reference shot' });
    const { kept, dropped } = allocateAttachments(contested(ref), 4);
    expect(kept.map((a) => a.hash)).toEqual(['p1', 'c1', 'p2', 'r1']);
    expect(dropped.map((a) => a.hash)).toEqual(['p3', 'c2']);
  });

  it('keeps a brand mark ahead of corroboration angles', () => {
    const mark = att('brand', 'm1', { label: 'Primary mark' });
    const { kept } = allocateAttachments(contested(mark), 4);
    // admitted in pass 2, but handed back in the legacy ordering discipline
    expect(kept.map((a) => a.hash)).toEqual(['p1', 'c1', 'p2', 'm1']);
  });

  it('still sheds inspiration before identity under real starvation', () => {
    const ref = att('reference', 'r1', { label: 'Reference shot' });
    const { kept, dropped } = allocateAttachments(contested(ref), 2);
    expect(kept.map((a) => a.hash)).toEqual(['p1', 'c1']);
    // nothing essential was lost, so the caller's refusal path stays quiet
    expect(dropped.some((a) => a.essential)).toBe(false);
    expect(dropped.map((a) => a.hash)).toContain('r1');
  });

  it('surfaces an unaffordable essential in dropped so the refusal fires', () => {
    const { dropped } = allocateAttachments(contested(att('reference', 'r1')), 1);
    expect(dropped.filter((a) => a.essential).map((a) => a.hash)).toEqual(['c1']);
  });

  it('keeps everything on a roomy engine, in the legacy order', () => {
    const ref = att('reference', 'r1', { label: 'Reference shot' });
    const { kept, dropped } = allocateAttachments(contested(ref), 6);
    expect(kept.map((a) => a.hash)).toEqual(['p1', 'c1', 'p2', 'p3', 'c2', 'r1']);
    expect(dropped).toEqual([]);
  });

  it('cap 0 drops everything and keeps nothing', () => {
    const { kept, dropped } = allocateAttachments(contested(att('reference', 'r1')), 0);
    expect(kept).toEqual([]);
    expect(dropped).toHaveLength(6);
  });

  it('treats each hand-attached reference as its own group', () => {
    const many = [
      att('product', 'p1', { id: 'prod', essential: true }),
      att('product', 'p2', { id: 'prod' }),
      att('reference', 'r1'),
      att('reference', 'r2'),
    ];
    const { kept } = allocateAttachments(many, 3);
    // both references are distinct groups, both outrank the second angle
    expect(kept.map((a) => a.hash)).toEqual(['p1', 'r1', 'r2']);
  });

  it('is deterministic under permuted insertion order of equals', () => {
    const forward = contested(att('reference', 'r1', { label: 'Reference shot' }));
    const shuffled = [forward[5], forward[3], forward[0], forward[4], forward[1], forward[2]];
    const a = allocateAttachments(forward, 4).kept.map((x) => x.hash);
    const b = allocateAttachments(shuffled, 4)
      .kept.map((x) => x.hash)
      .sort();
    expect([...a].sort()).toEqual(b);
  });
});

describe('merging a refinement budget', () => {
  it('collapses duplicates to the own copy and boards own before inherited', () => {
    const own = [att('reference', 'r1', { label: 'Reference shot' })];
    const inherited = [
      att('reference', 'r1', { label: 'Reference shot' }),
      att('brand', 'm1', { label: 'Primary mark' }),
    ];
    const { kept } = mergeEditAttachments(own, inherited, 3);
    expect(kept.map((a) => a.hash)).toEqual(['m1', 'r1']);
    // the duplicated reference is the OWN copy, not the flagged carried one
    expect(kept.find((a) => a.hash === 'r1')?.inherited).toBeUndefined();
    expect(kept.find((a) => a.hash === 'm1')?.inherited).toBe(true);
  });

  it('starvation still keeps subject essentials before anything carried', () => {
    const own: ReturnType<typeof att>[] = [];
    const inherited = [
      att('product', 'p1', { id: 'prod', essential: true }),
      att('character', 'c1', { id: 'pers', essential: true }),
      att('brand', 'm1'),
      att('reference', 'r1'),
    ];
    const { kept, dropped } = mergeEditAttachments(own, inherited, 2);
    expect(kept.map((a) => a.hash)).toEqual(['p1', 'c1']);
    expect(dropped.map((a) => a.hash).sort()).toEqual(['m1', 'r1']);
  });
});

describe('corroboration alternates between identities', () => {
  it('a face keeps its second view before a product takes a third angle', () => {
    // Cap 5: essentials board (p1, c1), the hand-attached reference gets its
    // seat, then corroboration goes round-robin — p2, then c2. The old
    // straight role-priority drain gave both spare slots to the product.
    const { kept } = allocateAttachments(contested(att('reference', 'r1', { label: 'moodboard' })), 5);
    const hashes = kept.map((a) => a.hash);
    expect(hashes).toContain('c2');
    expect(hashes).not.toContain('p3');
  });

  it('a roomy engine still reads every angle in the legacy order', () => {
    const { kept, dropped } = allocateAttachments(contested(att('reference', 'r1', { label: 'moodboard' })), 12);
    expect(kept.map((a) => a.hash)).toEqual(['p1', 'c1', 'p2', 'p3', 'c2', 'r1']);
    expect(dropped).toEqual([]);
  });
});

describe('a hand-attached reference outranks the scene', () => {
  // The user chose that exact picture for this shot; the scene plate is
  // conditioning the recipe derived. Under contention the scene is what
  // degrades to prose - quietly, by design.
  it('between a reference and a scene plate, the one placed first boards', () => {
    const ref = att('reference', 'r1', { label: 'Reference shot' });
    const scene = att('scene', 's1', { id: 'scn', label: 'Cracked Clay' });
    expect(allocateAttachments([ref, scene], 1).kept.map((a) => a.hash)).toEqual(['r1']);
    expect(allocateAttachments([scene, ref], 1).kept.map((a) => a.hash)).toEqual(['s1']);
    expect(allocateAttachments([scene, ref], 1).dropped.map((a) => a.hash)).toEqual(['r1']);
  });

  // Chips outnumber seats: the brief's own order decides, whatever the kind,
  // so the pictured chips are always the leading ones and a mark placed
  // last is the one left out.
  it('seats chips in brief order, whatever their kind', () => {
    const many = [
      att('product', 'p1', { id: 'a', label: 'Vase', essential: true }),
      att('character', 'c1', { id: 'b', label: 'Astrid', essential: true }),
      att('product', 'p2', { id: 'c', label: 'Watch', essential: true }),
      att('character', 'c2', { id: 'd', label: 'Bree', essential: true }),
      att('reference', 'r1', { label: 'Reference shot' }),
      att('product', 'p3', { id: 'e', label: 'Lamp', essential: true }),
      att('brand', 'm1', { label: 'Logo' }),
    ];
    const { kept, dropped } = allocateAttachments(many, 4);
    expect(kept.map((a) => a.hash).sort()).toEqual(['c1', 'c2', 'p1', 'p2']);
    expect(dropped.map((a) => a.hash).sort()).toEqual(['m1', 'p3', 'r1']);
    expect(
      allocateAttachments([many[6], ...many.slice(0, 6)], 4)
        .kept.map((a) => a.hash)
        .sort(),
    ).toEqual(['c1', 'm1', 'p1', 'p2']);
  });

  // The compiler marks every product and person essential, so the order has
  // to hold among essentials too, or a face never beats a vase.
  it('a person placed before a product is pictured before it, essential or not', () => {
    const brief = [
      att('character', 'c1', { id: 'b', essential: true }),
      att('product', 'p1', { id: 'a', essential: true }),
      att('product', 'p2', { id: 'c', essential: true }),
      att('character', 'c2', { id: 'd', essential: true }),
    ];
    expect(
      allocateAttachments(brief, 2)
        .kept.map((a) => a.hash)
        .sort(),
    ).toEqual(['c1', 'p1']);
    expect(
      allocateAttachments(brief, 3)
        .kept.map((a) => a.hash)
        .sort(),
    ).toEqual(['c1', 'p1', 'p2']);
  });

  it('a scene placed first is pictured before the identities after it', () => {
    const brief = [
      att('scene', 's1', { id: 'scn' }),
      att('product', 'p1', { id: 'a', essential: true }),
      att('character', 'c1', { id: 'b', essential: true }),
    ];
    expect(
      allocateAttachments(brief, 2)
        .kept.map((a) => a.hash)
        .sort(),
    ).toEqual(['p1', 's1']);
  });

  it('hands back the seated images in brief order too, for a second allocation', () => {
    const brief = [
      att('product', 'p1', { id: 'a', essential: true }),
      att('character', 'c1', { id: 'b', essential: true }),
      att('product', 'p2', { id: 'c', essential: true }),
    ];
    const r = allocateAttachments(brief, 3);
    expect(r.kept.map((a) => a.hash)).toEqual(['p1', 'p2', 'c1']);
    expect(r.seated.map((a) => a.hash)).toEqual(['p1', 'c1', 'p2']);
    // a tighter second pass from `seated` keeps the brief's order; from `kept` it would not
    expect(
      allocateAttachments(r.seated, 2)
        .kept.map((a) => a.hash)
        .sort(),
    ).toEqual(['c1', 'p1']);
  });

  it('moving a chip earlier moves its photo into the frame', () => {
    const later = [
      att('product', 'p1', { id: 'a' }),
      att('character', 'c1', { id: 'b' }),
      att('product', 'p2', { id: 'c' }),
    ];
    expect(
      allocateAttachments(later, 2)
        .kept.map((a) => a.hash)
        .sort(),
    ).toEqual(['c1', 'p1']);
    const earlier = [
      att('product', 'p2', { id: 'c' }),
      att('product', 'p1', { id: 'a' }),
      att('character', 'c1', { id: 'b' }),
    ];
    expect(
      allocateAttachments(earlier, 2)
        .kept.map((a) => a.hash)
        .sort(),
    ).toEqual(['p1', 'p2']);
  });

  it('with one seat left after the identities, the reference takes it and the scene does not', () => {
    const scene = att('scene', 's1', { id: 'scn', label: 'Cracked Clay' });
    const both = [...contested(att('reference', 'r1', { label: 'Reference shot' })), scene];
    const { kept, dropped } = allocateAttachments(both, 3);
    expect(kept.map((a) => a.hash)).toEqual(['p1', 'c1', 'r1']);
    expect(dropped.map((a) => a.hash)).toContain('s1');
  });
});
