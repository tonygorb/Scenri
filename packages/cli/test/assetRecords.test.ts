import { describe, it, expect } from 'vitest';
import {
  customPresenterHeads,
  headOf,
  mintRevision,
  presenterChain,
  presenterRecordFrom,
  type CustomPresenter,
} from '../src/assetRecords.js';

const H = (c: string) => c.repeat(32);
const ok = (r: ReturnType<typeof presenterRecordFrom>) => {
  if (!r.ok) throw new Error(r.error);
  return r.presenter;
};

describe('presenterRecordFrom', () => {
  it('keeps where a person came from, their likeness confirmation and their facial prose', () => {
    const p = ok(
      presenterRecordFrom({
        name: 'Ilse',
        shotHashes: [H('a')],
        shotAngles: ['portrait'],
        source: 'photos',
        facial: 'oval face, high cheekbones',
        skin: 'olive, fine natural texture',
        build: 'slender',
        likeness: { attestedAt: '2026-09-08T00:00:00Z', version: 'v1' },
      }),
    );
    expect(p.source).toBe('photos');
    expect(p.facial).toBe('oval face, high cheekbones');
    expect(p.skin).toBe('olive, fine natural texture');
    expect(p.build).toBe('slender');
    expect(p.likeness).toEqual({ attestedAt: '2026-09-08T00:00:00Z', version: 'v1' });
  });

  it('drops a source it has no policy for, and a likeness with no date', () => {
    const p = ok(
      presenterRecordFrom({
        name: 'Ilse',
        shotHashes: [H('a')],
        source: 'celebrity',
        likeness: { version: 'v1' },
      }),
    );
    expect(p.source).toBeUndefined();
    expect(p.likeness).toBeUndefined();
  });

  it("a reorder by hash keeps every shot's angle", () => {
    const base = ok(
      presenterRecordFrom({ name: 'Ilse', shotHashes: [H('a'), H('b')], shotAngles: ['portrait', 'front'] }),
    );
    const re = ok(presenterRecordFrom({ shotHashes: [H('b'), H('a')] }, base));
    expect((re.shots ?? []).map((s) => s.angle)).toEqual(['front', 'portrait']);
  });

  it('an edit that never mentions them leaves source, likeness and facial prose as they were', () => {
    const base = ok(
      presenterRecordFrom({
        name: 'Ilse',
        shotHashes: [H('a')],
        source: 'synthetic',
        facial: 'oval face',
        skin: 'olive',
        build: 'slender',
      }),
    );
    const renamed = ok(presenterRecordFrom({ name: 'Ilse Marr' }, base));
    expect(renamed.name).toBe('Ilse Marr');
    expect(renamed.source).toBe('synthetic');
    expect(renamed.facial).toBe('oval face');
    expect(renamed.skin).toBe('olive');
    expect(renamed.build).toBe('slender');
  });
});

/**
 * A saved shot carries only the presenter's id, so an edit that changes a
 * picture or the identity prose is a new record with a fresh id: the old one
 * stays, marked superseded, and its shots keep refining against what they
 * were made from. These are the pure pieces of that rule.
 */
describe('revisions', () => {
  it('carries the accepted identity edits, trimmed, deduped and capped, and never invents supersededBy', () => {
    const p = ok(
      presenterRecordFrom({
        name: 'Ilse',
        shotHashes: [H('a')],
        identityEdits: [
          ' shorter hair ',
          'Shorter hair',
          'a fuller beard',
          ...Array.from({ length: 10 }, (_, i) => `edit ${i} ${'x'.repeat(200)}`),
        ],
        revisionOf: 'up-00000001',
        supersededBy: 'up-00000002',
      } as any),
    );
    expect(p.identityEdits).toHaveLength(8);
    expect(p.identityEdits?.slice(0, 2)).toEqual(['shorter hair', 'a fuller beard']);
    expect(p.identityEdits?.[2]).toHaveLength(120);
    expect(p.revisionOf).toBe('up-00000001');
    expect(p.supersededBy).toBeUndefined();
    // an edit that never mentions them keeps them; an empty list clears them
    const kept = ok(presenterRecordFrom({ name: 'Ilse Marr' }, p));
    expect(kept.identityEdits).toEqual(p.identityEdits);
    expect(kept.revisionOf).toBe('up-00000001');
    expect(ok(presenterRecordFrom({ identityEdits: [] }, p)).identityEdits).toBeUndefined();
  });

  it('a patch of a superseded record leaves it superseded', () => {
    const base: CustomPresenter = {
      ...ok(presenterRecordFrom({ name: 'Ilse', shotHashes: [H('a')] })),
      supersededBy: 'up-x',
    };
    expect(ok(presenterRecordFrom({ name: 'Ilse Marr' }, base)).supersededBy).toBe('up-x');
  });

  it('mintRevision mints a new id, keeps the base id as revisionOf, and may carry a new promptName', () => {
    const base = ok(
      presenterRecordFrom({
        name: 'Ilse',
        shotHashes: [H('a')],
        shotAngles: ['portrait'],
        promptName: 'a woman with long hair',
        source: 'synthetic',
        facial: 'oval face',
      }),
    );
    const rev = ok(
      mintRevision(base, { shotHashes: [H('b')], shotAngles: ['portrait'], promptName: 'a woman with short hair' }),
    );
    expect(rev.id).toMatch(/^up-[a-f0-9]{8}$/);
    expect(rev.id).not.toBe(base.id);
    expect(rev.revisionOf).toBe(base.id);
    expect(rev.supersededBy).toBeUndefined();
    expect(rev.origin).toBe('custom');
    expect(rev.name).toBe('Ilse');
    expect(rev.promptName).toBe('a woman with short hair');
    expect(rev.facial).toBe('oval face');
    expect(rev.source).toBe('synthetic');
    expect(rev.shots?.map((s) => s.file)).toEqual([`asset:${H('b')}`]);
    // the base is untouched: marking it superseded is the commit's job
    expect(base.supersededBy).toBeUndefined();
    // a revision of a superseded record is a head again
    const again = ok(mintRevision({ ...base, supersededBy: 'up-x' }, {}));
    expect(again.supersededBy).toBeUndefined();
    expect(again.revisionOf).toBe(base.id);
  });

  const chain = () => ({
    characters: [
      { id: 'up-1', name: 'Ilse', origin: 'custom', supersededBy: 'up-2' },
      { id: 'up-2', name: 'Ilse', origin: 'custom', revisionOf: 'up-1', supersededBy: 'up-3' },
      { id: 'up-3', name: 'Ilse', origin: 'custom', revisionOf: 'up-2' },
      { id: 'up-9', name: 'Noor', origin: 'custom' },
      { id: 'legacy', name: 'Old' },
    ],
  });

  it('headOf follows supersededBy to the current record, and answers the id itself when unknown', () => {
    expect(headOf(chain(), 'up-1')).toBe('up-3');
    expect(headOf(chain(), 'up-2')).toBe('up-3');
    expect(headOf(chain(), 'up-3')).toBe('up-3');
    expect(headOf(chain(), 'nobody')).toBe('nobody');
    // a pointer at a record that is gone stops at the last one that exists
    expect(headOf({ characters: [{ id: 'up-1', name: 'x', supersededBy: 'gone' }] }, 'up-1')).toBe('up-1');
    // a loop ends
    const loop = {
      characters: [
        { id: 'a', name: 'x', supersededBy: 'b' },
        { id: 'b', name: 'x', supersededBy: 'a' },
      ],
    };
    expect(['a', 'b']).toContain(headOf(loop, 'a'));
  });

  it('presenterChain lists the head back through revisionOf, from any id in the chain', () => {
    expect(presenterChain(chain(), 'up-1')).toEqual(['up-3', 'up-2', 'up-1']);
    expect(presenterChain(chain(), 'up-3')).toEqual(['up-3', 'up-2', 'up-1']);
    expect(presenterChain(chain(), 'up-9')).toEqual(['up-9']);
    expect(presenterChain(chain(), 'nobody')).toEqual(['nobody']);
  });

  it('customPresenterHeads leaves out the superseded records and the legacy roster', () => {
    expect(customPresenterHeads(chain()).map((c) => c.id)).toEqual(['up-3', 'up-9']);
  });
});
