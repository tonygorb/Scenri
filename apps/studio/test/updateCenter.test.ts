import { describe, it, expect } from 'vitest';
import { canOneClick, floatState, floatVisible } from '../src/app/updateRules.js';
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

describe('floatVisible', () => {
  it('shows for a published install with an update available', () => {
    expect(floatVisible(status({}))).toBe(true);
  });

  it('never floats over a source checkout: About already tells the pull-and-rebuild story, and the only button the float could offer opens a pane with nothing to press', () => {
    expect(floatVisible(status({ canApply: false, blockReason: 'dev' }))).toBe(false);
  });

  it('still floats for an unsupervised or launcher-blocked install, where About offers the manual command', () => {
    expect(floatVisible(status({ canApply: false, blockReason: 'unsupervised' }))).toBe(true);
    expect(floatVisible(status({ canApply: false, blockReason: 'launcher-too-old' }))).toBe(true);
    expect(floatVisible(status({ canApply: false, blockReason: 'no-npm' }))).toBe(true);
  });

  it('is quiet with no status or nothing available', () => {
    expect(floatVisible(null)).toBe(false);
    expect(floatVisible(status({ available: false }))).toBe(false);
  });
});

describe('floatState', () => {
  it('announces an update, carrying whether one click can do the work', () => {
    expect(floatState(status({}))).toEqual({ kind: 'announce', oneClick: true });
    expect(floatState(status({ canApply: false, blockReason: 'dev' }))).toEqual({ kind: 'announce', oneClick: false });
  });

  it('narrates a background download', () => {
    expect(floatState(status({ phase: 'staging', stagedVersion: '0.2.0' }))).toEqual({ kind: 'downloading' });
  });

  it('offers the restart once a version is staged and verified', () => {
    expect(floatState(status({ phase: 'ready', stagedVersion: '0.2.0' }))).toEqual({
      kind: 'ready',
      version: '0.2.0',
    });
  });

  it('names the latest when a terminal-staged version carries no stagedVersion', () => {
    expect(floatState(status({ phase: 'ready', stagedVersion: null }))).toEqual({ kind: 'ready', version: '0.2.0' });
  });

  it('says a download failed only while an update is actually on offer', () => {
    expect(floatState(status({ phase: 'error', error: 'boom' }))).toEqual({ kind: 'stage-error' });
    expect(floatState(status({ phase: 'error', available: false, latest: null, kind: null }))).toEqual({
      kind: 'announce',
      oneClick: true,
    });
  });
});
