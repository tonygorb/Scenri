import { describe, it, expect, beforeEach } from 'vitest';
import { dismissNode, dismissedIds, dismissedKey, isDismissed } from '../src/dismissed.js';

beforeEach(() => {
  localStorage.clear();
});

describe('dismissedIds', () => {
  it('is empty when nothing has ever been dismissed', () => {
    expect(dismissedIds('brand-a')).toEqual([]);
  });
  it('returns empty and does not throw on malformed stored JSON', () => {
    localStorage.setItem(dismissedKey('brand-a'), '{not json');
    expect(dismissedIds('brand-a')).toEqual([]);
  });
  it('returns empty when the stored value is not an array', () => {
    localStorage.setItem(dismissedKey('brand-a'), JSON.stringify({ oops: true }));
    expect(dismissedIds('brand-a')).toEqual([]);
  });
  it('filters out non-string entries', () => {
    localStorage.setItem(dismissedKey('brand-a'), JSON.stringify(['n1', 42, null, 'n2']));
    expect(dismissedIds('brand-a')).toEqual(['n1', 'n2']);
  });
});

describe('dismissNode', () => {
  it('adds an id and persists it', () => {
    dismissNode('brand-a', 'n1');
    expect(dismissedIds('brand-a')).toEqual(['n1']);
  });
  it('is idempotent: dismissing the same id twice does not duplicate it', () => {
    dismissNode('brand-a', 'n1');
    dismissNode('brand-a', 'n1');
    expect(dismissedIds('brand-a')).toEqual(['n1']);
  });
  it('accumulates multiple distinct ids', () => {
    dismissNode('brand-a', 'n1');
    dismissNode('brand-a', 'n2');
    expect(dismissedIds('brand-a')).toEqual(['n1', 'n2']);
  });
  it('keeps different brands in separate sets', () => {
    dismissNode('brand-a', 'n1');
    dismissNode('brand-b', 'n2');
    expect(dismissedIds('brand-a')).toEqual(['n1']);
    expect(dismissedIds('brand-b')).toEqual(['n2']);
  });
});

describe('isDismissed', () => {
  it('is false before a node is dismissed', () => {
    expect(isDismissed('brand-a', 'n1')).toBe(false);
  });
  it('is true after a node is dismissed', () => {
    dismissNode('brand-a', 'n1');
    expect(isDismissed('brand-a', 'n1')).toBe(true);
  });
  it('does not leak across brands', () => {
    dismissNode('brand-a', 'n1');
    expect(isDismissed('brand-b', 'n1')).toBe(false);
  });
});
