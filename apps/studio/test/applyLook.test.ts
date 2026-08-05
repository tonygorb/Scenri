import { describe, it, expect } from 'vitest';
import { resolveLookSwitch } from '../src/composer/applyLook.js';

describe('resolveLookSwitch', () => {
  it('is a true no-op when re-picking the currently-attached look', () => {
    const result = resolveLookSwitch('look-a', 'look-a', 'Look A', null, null);
    expect(result).toEqual({ changed: false, toast: null });
  });

  it('is a true no-op even with an active branch target, when re-picking the same look', () => {
    const result = resolveLookSwitch('look-a', 'look-a', 'Look A', 'n1', 'that shot');
    expect(result).toEqual({ changed: false, toast: null });
  });

  it('attaches silently when there is no existing look and no branch target', () => {
    const result = resolveLookSwitch(null, 'look-a', 'Look A', null, null);
    expect(result).toEqual({ changed: true, toast: null });
  });

  it('switching from one look to another shows a toast naming only the look', () => {
    const result = resolveLookSwitch('look-a', 'look-b', 'Look B', null, null);
    expect(result.changed).toBe(true);
    expect(result.toast).toEqual({ title: 'Switched to Look B.', prevLookId: 'look-a', branchWasCleared: false });
  });

  it('a first attach that also clears an active branch target is announced, not silent', () => {
    const result = resolveLookSwitch(null, 'look-a', 'Look A', 'n1', 'the red chair');
    expect(result.changed).toBe(true);
    expect(result.toast).toEqual({
      title: 'Switched to Look A. This starts a new shot instead of refining the red chair.',
      prevLookId: null,
      branchWasCleared: true,
    });
  });

  it('names both facts when a look switch also drops a branch target', () => {
    const result = resolveLookSwitch('look-a', 'look-b', 'Look B', 'n1', 'the red chair');
    expect(result.toast?.title).toBe('Switched to Look B. This starts a new shot instead of refining the red chair.');
    expect(result.toast?.prevLookId).toBe('look-a');
    expect(result.toast?.branchWasCleared).toBe(true);
  });

  it('falls back to a generic phrase when the branch target has no label', () => {
    const result = resolveLookSwitch(null, 'look-a', 'Look A', 'n1', null);
    expect(result.toast?.title).toBe('Switched to Look A. This starts a new shot instead of refining that shot.');
  });
});
