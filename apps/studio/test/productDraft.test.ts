import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearProductDraft,
  loadProductDraft,
  productDraftKey,
  saveProductDraft,
} from '../src/create/product/productDraft.js';
import { initialStudio, reduce } from '../src/create/product/studioState.js';

/**
 * The product studio's draft survives a reload on purpose, including while a
 * view is being drawn: the work in it is minutes of generation, not a name
 * someone typed. Session-scoped like every creation draft, hashes only, and
 * never another brand's.
 */
const H = (c: string) => c.repeat(32);

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
});

describe('productDraft', () => {
  it('keys on the brand, and round-trips the studio state hashes and all', () => {
    expect(productDraftKey('b-1')).toBe('scenri:product-studio-b-1');
    let s = reduce(initialStudio('d1'), { t: 'photosAdded', hashes: [H('0')] });
    s = reduce(s, { t: 'candidateStarted', jobId: 'pc-1', angle: 'three-quarter', attempt: 1 });
    s = reduce(s, { t: 'nameChanged', name: 'Serum' });
    saveProductDraft('b-1', s);
    const back = loadProductDraft('b-1');
    expect(back?.photos).toEqual([{ hash: H('0'), angle: null }]);
    expect(back?.candidate).toMatchObject({ jobId: 'pc-1', angle: 'three-quarter' });
    expect(back?.name).toBe('Serum');
    expect(back?.draftId).toBe('d1');
  });

  it('is not written empty, and is gone after clear', () => {
    saveProductDraft('b-1', initialStudio('d1'));
    expect(loadProductDraft('b-1')).toBeNull();
    saveProductDraft('b-1', reduce(initialStudio('d1'), { t: 'photosAdded', hashes: [H('0')] }));
    expect(loadProductDraft('b-1')).not.toBeNull();
    clearProductDraft('b-1');
    expect(loadProductDraft('b-1')).toBeNull();
  });

  it('refuses another brand, a stale draft, and a shape it does not know', () => {
    saveProductDraft('b-1', reduce(initialStudio('d1'), { t: 'photosAdded', hashes: [H('0')] }));
    expect(loadProductDraft('b-2')).toBeNull();
    const raw = JSON.parse(sessionStorage.getItem(productDraftKey('b-1'))!);
    sessionStorage.setItem(productDraftKey('b-1'), JSON.stringify({ ...raw, updatedAt: '2020-01-01T00:00:00Z' }));
    expect(loadProductDraft('b-1')).toBeNull();
    sessionStorage.setItem(productDraftKey('b-1'), '{"v":9}');
    expect(loadProductDraft('b-1')).toBeNull();
    sessionStorage.setItem(productDraftKey('b-1'), 'not json');
    expect(loadProductDraft('b-1')).toBeNull();
  });
});
