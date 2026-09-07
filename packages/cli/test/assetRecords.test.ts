import { describe, it, expect } from 'vitest';
import { presenterRecordFrom } from '../src/assetRecords.js';

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
