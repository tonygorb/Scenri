import { describe, it, expect } from 'vitest';
import { canOneClick } from '../src/app/updateRules.js';
import type { UpdateStatus } from '../src/api.js';

const status = (over: Partial<UpdateStatus>): UpdateStatus => ({
  enabled: true,
  current: '0.1.0',
  latest: '0.2.0',
  available: true,
  kind: 'minor',
  attention: false,
  checkedAt: 1,
  notesUrl: null,
  error: null,
  canApply: true,
  blockReason: null,
  phase: 'idle',
  stagedVersion: null,
  ...over,
});

describe('canOneClick', () => {
  it('is false with no status yet', () => {
    expect(canOneClick(null)).toBe(false);
  });

  it('follows canApply while nothing is staged', () => {
    expect(canOneClick(status({}))).toBe(true);
    expect(canOneClick(status({ canApply: false, blockReason: 'no-npm' }))).toBe(false);
  });

  it('a staged, verified update needs only a supervisor to finish — a missing npm no longer matters', () => {
    expect(
      canOneClick(status({ phase: 'ready', stagedVersion: '0.2.0', canApply: false, blockReason: 'no-npm' })),
    ).toBe(true);
  });

  it('never one-clicks a checkout or an unsupervised serve, staged or not', () => {
    for (const blockReason of ['dev', 'unsupervised', 'launcher-too-old'] as const) {
      expect(canOneClick(status({ phase: 'ready', stagedVersion: '0.2.0', canApply: false, blockReason }))).toBe(false);
    }
  });
});
