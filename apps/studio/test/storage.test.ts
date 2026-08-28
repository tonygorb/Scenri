import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { STALE_MS, local, session } from '../src/storage.js';

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

describe('the two lanes', () => {
  it('round-trips and deletes, on both', () => {
    for (const lane of [local, session]) {
      lane.set('k', 'v');
      expect(lane.get('k')).toBe('v');
      lane.del('k');
      expect(lane.get('k')).toBeNull();
    }
  });

  it('answers null for a key nobody wrote', () => {
    expect(local.get('missing')).toBeNull();
    expect(session.get('missing')).toBeNull();
  });

  it('cannot see each other, which is the whole reason there are two', () => {
    local.set('k', 'kept');
    session.set('k', 'this tab only');
    expect(localStorage.getItem('k')).toBe('kept');
    expect(sessionStorage.getItem('k')).toBe('this tab only');
    session.del('k');
    expect(local.get('k')).toBe('kept');
  });

  it('holds the shared staleness window both draft modules read', () => {
    expect(STALE_MS).toBe(30 * 24 * 60 * 60 * 1000);
  });
});

describe('a browser that refuses storage', () => {
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

  it('degrades to nothing stored rather than taking the caller down', () => {
    for (const lane of [local, session]) {
      expect(() => lane.set('k', 'v')).not.toThrow();
      expect(lane.get('k')).toBeNull();
      expect(() => lane.del('k')).not.toThrow();
    }
  });
});
