import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  assetDraftKey,
  clearAssetDraft,
  isNonTrivial,
  loadAssetDraft,
  saveAssetDraft,
  shouldHydrate,
  type AssetDraft,
  type PendingState,
} from '../src/createDraft.js';

const BRAND = 'b-1234';

beforeEach(() => {
  localStorage.clear();
});

describe('assetDraftKey', () => {
  it('keys by brand id and kind, so three flows never overwrite each other', () => {
    expect(assetDraftKey(BRAND, 'product')).toBe('scenri:new-b-1234-product');
    expect(assetDraftKey(BRAND, 'presenter')).toBe('scenri:new-b-1234-presenter');
    expect(assetDraftKey(BRAND, 'scene')).toBe('scenri:new-b-1234-scene');
  });
});

describe('isNonTrivial', () => {
  it('is false for an untouched form', () => {
    expect(isNonTrivial({})).toBe(false);
    expect(isNonTrivial({ name: '', instruction: '', facets: [], imageHashes: [], importUrl: '' })).toBe(false);
  });
  it('ignores whitespace-only text', () => {
    expect(isNonTrivial({ name: '   ', instruction: '\n\t' })).toBe(false);
  });
  it('is true for a name alone', () => {
    expect(isNonTrivial({ name: 'House Blend' })).toBe(true);
  });
  it('is true for one uploaded image alone', () => {
    expect(isNonTrivial({ imageHashes: ['a'.repeat(32)] })).toBe(true);
  });
  it('is true for one chosen facet alone', () => {
    expect(isNonTrivial({ facets: ['Beauty'] })).toBe(true);
  });
  it('is true for a half-typed store URL alone', () => {
    expect(isNonTrivial({ importUrl: 'https://ex' })).toBe(true);
  });
});

describe('save then load', () => {
  it('round-trips every field', () => {
    saveAssetDraft(BRAND, 'presenter', {
      name: 'Mara',
      instruction: 'shot on film',
      facets: ['Beauty', 'Apparel'],
      imageHashes: ['a'.repeat(32), 'b'.repeat(32)],
    });
    const got = loadAssetDraft(BRAND, 'presenter');
    expect(got).toMatchObject({
      v: 1,
      brandId: BRAND,
      kind: 'presenter',
      name: 'Mara',
      instruction: 'shot on film',
      facets: ['Beauty', 'Apparel'],
      imageHashes: ['a'.repeat(32), 'b'.repeat(32)],
      importUrl: '',
      pending: null,
    });
  });

  it('defaults every absent field rather than returning holes', () => {
    saveAssetDraft(BRAND, 'product', { name: 'Tin' });
    expect(loadAssetDraft(BRAND, 'product')).toMatchObject({
      instruction: '',
      facets: [],
      imageHashes: [],
      importUrl: '',
      pending: null,
    });
  });

  it('returns null when nothing was ever stored', () => {
    expect(loadAssetDraft(BRAND, 'scene')).toBeNull();
  });

  it('clears only the kind it was asked to clear', () => {
    saveAssetDraft(BRAND, 'product', { name: 'Tin' });
    saveAssetDraft(BRAND, 'scene', { name: 'Shore' });
    clearAssetDraft(BRAND, 'product');
    expect(loadAssetDraft(BRAND, 'product')).toBeNull();
    expect(loadAssetDraft(BRAND, 'scene')?.name).toBe('Shore');
  });
});

describe('rejection removes the key as well as returning null', () => {
  const stored = (over: Partial<AssetDraft>) => {
    const base: AssetDraft = {
      v: 1,
      brandId: BRAND,
      kind: 'scene',
      updatedAt: new Date().toISOString(),
      name: 'Shore',
      instruction: '',
      facets: [],
      imageHashes: [],
      importUrl: '',
      pending: null,
    };
    localStorage.setItem(assetDraftKey(BRAND, 'scene'), JSON.stringify({ ...base, ...over }));
  };

  it('drops an unparseable value', () => {
    localStorage.setItem(assetDraftKey(BRAND, 'scene'), '{not json');
    expect(loadAssetDraft(BRAND, 'scene')).toBeNull();
    expect(localStorage.getItem(assetDraftKey(BRAND, 'scene'))).toBeNull();
  });

  it('drops a version it does not know', () => {
    stored({ v: 2 as any });
    expect(loadAssetDraft(BRAND, 'scene')).toBeNull();
    expect(localStorage.getItem(assetDraftKey(BRAND, 'scene'))).toBeNull();
  });

  it('drops a draft written for another brand', () => {
    stored({ brandId: 'b-other' });
    expect(loadAssetDraft(BRAND, 'scene')).toBeNull();
    expect(localStorage.getItem(assetDraftKey(BRAND, 'scene'))).toBeNull();
  });

  it('drops a draft written for another kind', () => {
    stored({ kind: 'presenter' });
    expect(loadAssetDraft(BRAND, 'scene')).toBeNull();
    expect(localStorage.getItem(assetDraftKey(BRAND, 'scene'))).toBeNull();
  });

  it('drops one older than thirty days, and keeps one just inside', () => {
    const day = 24 * 60 * 60 * 1000;
    stored({ updatedAt: new Date(Date.now() - 31 * day).toISOString() });
    expect(loadAssetDraft(BRAND, 'scene')).toBeNull();
    expect(localStorage.getItem(assetDraftKey(BRAND, 'scene'))).toBeNull();

    stored({ updatedAt: new Date(Date.now() - 29 * day).toISOString() });
    expect(loadAssetDraft(BRAND, 'scene')?.name).toBe('Shore');
  });

  it('drops one with an unreadable timestamp', () => {
    stored({ updatedAt: 'whenever' });
    expect(loadAssetDraft(BRAND, 'scene')).toBeNull();
  });

  it('keeps only the strings out of an array that picked up junk', () => {
    stored({ facets: ['Beauty', 7, null] as any, imageHashes: [{ a: 1 }] as any });
    expect(loadAssetDraft(BRAND, 'scene')).toMatchObject({ facets: ['Beauty'], imageHashes: [] });
  });
});

describe('shouldHydrate', () => {
  const draft = (pending: string | null): AssetDraft => ({
    v: 1,
    brandId: BRAND,
    kind: 'presenter',
    updatedAt: new Date().toISOString(),
    name: 'Mara',
    instruction: '',
    facets: [],
    imageHashes: ['a'.repeat(32)],
    importUrl: '',
    pending,
  });

  it('is false with no draft at all', () => {
    expect(shouldHydrate(null, null)).toBe(false);
  });

  it('is true for a draft that was never sent, whatever the build state says', () => {
    for (const state of [null, 'running', 'done', 'failed'] as (PendingState | null)[]) {
      expect(shouldHydrate(draft(null), state)).toBe(true);
    }
  });

  it('refills after a failure or a cancellation — this is what Try again needs', () => {
    expect(shouldHydrate(draft('ab-1'), 'failed')).toBe(true);
    expect(shouldHydrate(draft('ab-1'), 'cancelled')).toBe(true);
  });

  it('refills when the server has forgotten the build, since nobody can watch it finish', () => {
    expect(shouldHydrate(draft('ab-1'), 'unknown')).toBe(true);
    expect(shouldHydrate(draft('ab-1'), null)).toBe(true);
  });

  it('stays blank while that build is still running or already landed', () => {
    expect(shouldHydrate(draft('ab-1'), 'running')).toBe(false);
    expect(shouldHydrate(draft('ab-1'), 'done')).toBe(false);
  });
});

describe('a storage that throws', () => {
  let setItem: typeof Storage.prototype.setItem;
  let getItem: typeof Storage.prototype.getItem;
  let removeItem: typeof Storage.prototype.removeItem;

  beforeEach(() => {
    setItem = Storage.prototype.setItem;
    getItem = Storage.prototype.getItem;
    removeItem = Storage.prototype.removeItem;
    const boom = () => {
      throw new Error('denied');
    };
    Storage.prototype.setItem = vi.fn(boom);
    Storage.prototype.getItem = vi.fn(boom);
    Storage.prototype.removeItem = vi.fn(boom);
  });
  afterEach(() => {
    Storage.prototype.setItem = setItem;
    Storage.prototype.getItem = getItem;
    Storage.prototype.removeItem = removeItem;
  });

  it('degrades to no draft instead of taking the dialog down with it', () => {
    expect(() => saveAssetDraft(BRAND, 'product', { name: 'Tin' })).not.toThrow();
    expect(loadAssetDraft(BRAND, 'product')).toBeNull();
    expect(() => clearAssetDraft(BRAND, 'product')).not.toThrow();
  });
});
