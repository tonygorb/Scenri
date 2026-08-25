import { describe, it, expect } from 'vitest';
import { allocateAttachments } from '../src/attachmentBudget.js';
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
