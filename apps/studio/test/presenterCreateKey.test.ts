import { beforeEach, describe, expect, it } from 'vitest';
import { createKey } from '../src/create/presenter/useCreationFlow.js';

/**
 * What a draft is created under (PC1-X1). The server answers a create asked
 * again under the same key with the draft it already made, so the key has to
 * name one conversation at one set of answers, in one tab, and survive that
 * tab's reload.
 */
describe('the key a draft is created under', () => {
  beforeEach(() => sessionStorage.clear());

  it('is the same after a reload of the same tab, at the same answers', () => {
    expect(createKey('default', 7)).toBe(createKey('default', 7));
  });

  it('moves with the answers, so a draft made from old ones is never handed back', () => {
    expect(createKey('default', 8)).not.toBe(createKey('default', 7));
  });

  it('differs between two tabs opened straight on the page, which share the history key', () => {
    const first = createKey('default', 7);
    // another tab: its own session storage
    sessionStorage.clear();
    expect(createKey('default', 7)).not.toBe(first);
  });
});
