import { describe, it, expect, beforeEach } from 'vitest';
import type { SentenceToken } from '../src/composer/line.js';
import { clearDraft, draftKey, isNonTrivial, loadDraft, saveDraft, type PersistedDraft } from '../src/draft.js';

const tokens = (over: SentenceToken[] = [{ t: 'text', v: '' }]): SentenceToken[] => over;

describe('isNonTrivial', () => {
  it('is false for an untouched composer', () => {
    expect(isNonTrivial(tokens(), {}, null)).toBe(false);
  });
  it('is true for typed text', () => {
    expect(isNonTrivial(tokens([{ t: 'text', v: 'golden hour' }]), {}, null)).toBe(true);
  });
  it('is true for a blank line plus an attached token, even with no text', () => {
    expect(
      isNonTrivial(
        tokens([
          { t: 'text', v: '' },
          { t: 'product', id: 'p1' },
        ]),
        {},
        null,
      ),
    ).toBe(true);
  });
  it('is true for a filled template field alone', () => {
    expect(isNonTrivial(tokens(), { headline: 'Sale' }, null)).toBe(true);
  });
  it('ignores a template field that is only whitespace', () => {
    expect(isNonTrivial(tokens(), { headline: '   ' }, null)).toBe(false);
  });
  it('is true for a branch target alone, with nothing typed', () => {
    expect(isNonTrivial(tokens(), {}, 'n1')).toBe(true);
  });

  // A scene is the one chip that arrives on its own, from a link. On its own it
  // is a seed nobody built on, and storing it meant it came back silently on
  // every later cold load.
  it('is false for a scene chip alone', () => {
    expect(
      isNonTrivial(
        tokens([
          { t: 'text', v: '' },
          { t: 'template', id: 'action-motion-freeze' },
        ]),
        {},
        null,
      ),
    ).toBe(false);
  });
  it('is false for a scene chip with only whitespace typed around it', () => {
    expect(
      isNonTrivial(
        tokens([
          { t: 'text', v: '  ' },
          { t: 'template', id: 'action-motion-freeze' },
          { t: 'text', v: '\n' },
        ]),
        {},
        null,
      ),
    ).toBe(false);
  });
  it('is true for a scene chip once something was typed', () => {
    expect(
      isNonTrivial(
        tokens([
          { t: 'text', v: 'mid-pour' },
          { t: 'template', id: 'action-motion-freeze' },
        ]),
        {},
        null,
      ),
    ).toBe(true);
  });
  it('is true for a scene chip beside another ingredient', () => {
    expect(
      isNonTrivial(
        tokens([
          { t: 'text', v: '' },
          { t: 'template', id: 'action-motion-freeze' },
          { t: 'product', id: 'p1' },
        ]),
        {},
        null,
      ),
    ).toBe(true);
  });
  it('is true for a scene chip whose fields were filled in', () => {
    expect(
      isNonTrivial(
        tokens([
          { t: 'text', v: '' },
          { t: 'template', id: 'action-motion-freeze' },
        ]),
        { headline: 'Sale' },
        null,
      ),
    ).toBe(true);
  });
  it('is true for a scene chip with a branch target', () => {
    expect(
      isNonTrivial(
        tokens([
          { t: 'text', v: '' },
          { t: 'template', id: 'action-motion-freeze' },
        ]),
        {},
        'n1',
      ),
    ).toBe(true);
  });
});

describe('draftKey', () => {
  it('is namespaced per brand', () => {
    expect(draftKey('b1')).toBe('scenri:draft-b1');
    expect(draftKey('b2')).toBe('scenri:draft-b2');
  });
});

describe('saveDraft / loadDraft / clearDraft', () => {
  beforeEach(() => localStorage.clear());

  it('round-trips per brand and does not leak across brands', () => {
    saveDraft('b1', { tokens: tokens([{ t: 'text', v: 'hello' }]), tplFields: {}, branchId: null });
    const loaded = loadDraft('b1');
    expect(loaded?.tokens).toEqual([{ t: 'text', v: 'hello' }]);
    expect(loaded?.brandId).toBe('b1');
    expect(loadDraft('b2')).toBeNull();
  });

  it('clears on demand', () => {
    saveDraft('b1', { tokens: tokens([{ t: 'text', v: 'hi' }]), tplFields: {}, branchId: null });
    clearDraft('b1');
    expect(loadDraft('b1')).toBeNull();
  });

  it('carries branchId and setSlug through', () => {
    saveDraft('b1', { tokens: tokens(), tplFields: {}, branchId: 'n1', setSlug: 'spring' });
    const loaded = loadDraft('b1');
    expect(loaded?.branchId).toBe('n1');
    expect(loaded?.setSlug).toBe('spring');
  });

  it('defaults setSlug to null when omitted', () => {
    saveDraft('b1', { tokens: tokens(), tplFields: {}, branchId: null });
    expect(loadDraft('b1')?.setSlug).toBeNull();
  });

  it('rejects a draft written for a different brand', () => {
    saveDraft('b1', { tokens: tokens([{ t: 'text', v: 'hi' }]), tplFields: {}, branchId: null });
    // simulate a copy/paste of the wrong key onto another brand's slot
    const raw = localStorage.getItem(draftKey('b1'));
    if (raw) localStorage.setItem(draftKey('b2'), raw);
    expect(loadDraft('b2')).toBeNull();
  });

  it('rejects a future schema version and removes the dead key', () => {
    const bad: PersistedDraft = {
      v: 2 as unknown as 1,
      brandId: 'b1',
      updatedAt: new Date().toISOString(),
      tokens: tokens(),
      tplFields: {},
      branchId: null,
      setSlug: null,
    };
    localStorage.setItem(draftKey('b1'), JSON.stringify(bad));
    expect(loadDraft('b1')).toBeNull();
    expect(localStorage.getItem(draftKey('b1'))).toBeNull();
  });

  it('survives malformed json and a non-object payload', () => {
    localStorage.setItem(draftKey('b1'), '{not json');
    expect(loadDraft('b1')).toBeNull();
    localStorage.setItem(draftKey('b1'), '"just a string"');
    expect(loadDraft('b1')).toBeNull();
  });

  it('discards a draft older than 30 days', () => {
    const stale: PersistedDraft = {
      v: 1,
      brandId: 'b1',
      updatedAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString(),
      tokens: tokens([{ t: 'text', v: 'old' }]),
      tplFields: {},
      branchId: null,
      setSlug: null,
    };
    localStorage.setItem(draftKey('b1'), JSON.stringify(stale));
    expect(loadDraft('b1')).toBeNull();
  });

  it('keeps a draft just under the staleness threshold', () => {
    const fresh: PersistedDraft = {
      v: 1,
      brandId: 'b1',
      updatedAt: new Date(Date.now() - 29 * 24 * 60 * 60 * 1000).toISOString(),
      tokens: tokens([{ t: 'text', v: 'still good' }]),
      tplFields: {},
      branchId: null,
      setSlug: null,
    };
    localStorage.setItem(draftKey('b1'), JSON.stringify(fresh));
    expect(loadDraft('b1')?.tokens).toEqual([{ t: 'text', v: 'still good' }]);
  });

  it('survives a localStorage that throws', () => {
    const real = Object.getOwnPropertyDescriptor(window, 'localStorage');
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('denied');
      },
    });
    expect(() => saveDraft('b1', { tokens: tokens(), tplFields: {}, branchId: null })).not.toThrow();
    expect(loadDraft('b1')).toBeNull();
    expect(() => clearDraft('b1')).not.toThrow();
    if (real) Object.defineProperty(window, 'localStorage', real);
  });
});
