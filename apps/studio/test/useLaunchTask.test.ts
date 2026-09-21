import { describe, it, expect } from 'vitest';
import { launchMove, type LaunchHere } from '../src/layout/useLaunchTask.js';
import type { GuideTaskId } from '../src/apiTypes.js';

const nowhere: LaunchHere = {
  onHub: false,
  onShot: false,
  onProducts: false,
  onScenes: false,
  onPresenters: false,
  onStudio: false,
};

describe('launchMove', () => {
  it('a fresh start never navigates: they walk the way there', () => {
    for (const task of ['first-shot', 'reuse', 'refine', 'product', 'scene', 'presenter'] as GuideTaskId[])
      expect(launchMove(task, nowhere, [], null), task).toEqual({ kind: 'head' });
    expect(launchMove('refine', nowhere, ['go'], null)).toEqual({ kind: 'head' });
    expect(launchMove('product', nowhere, ['go'], null)).toEqual({ kind: 'head' });
  });

  it('already on the destination begins right there', () => {
    expect(launchMove('first-shot', { ...nowhere, onHub: true }, [], null)).toEqual({ kind: 'stay' });
    expect(launchMove('reuse', { ...nowhere, onHub: true }, [], null)).toEqual({ kind: 'stay' });
    expect(launchMove('refine', { ...nowhere, onHub: true }, [], null)).toEqual({ kind: 'stay' });
    expect(launchMove('refine', { ...nowhere, onShot: true }, [], null)).toEqual({ kind: 'stay' });
    expect(launchMove('product', { ...nowhere, onProducts: true }, [], null)).toEqual({ kind: 'stay' });
    expect(launchMove('scene', { ...nowhere, onScenes: true }, [], null)).toEqual({ kind: 'stay' });
    expect(launchMove('presenter', { ...nowhere, onPresenters: true }, [], null)).toEqual({ kind: 'stay' });
  });

  it('Continue restores a place they have already been', () => {
    expect(launchMove('first-shot', nowhere, ['go', 'product'], null)).toEqual({ kind: 'hub' });
    expect(launchMove('reuse', nowhere, ['product'], null)).toEqual({ kind: 'hub' });
    expect(launchMove('refine', nowhere, ['choose'], null)).toEqual({ kind: 'hub' });
    expect(launchMove('product', nowhere, ['new'], null)).toEqual({ kind: 'products' });
    expect(launchMove('product', nowhere, ['product'], null)).toEqual({ kind: 'dialog', asset: 'product' });
    expect(launchMove('scene', nowhere, ['new'], null)).toEqual({ kind: 'scenes' });
    expect(launchMove('scene', nowhere, ['scene'], null)).toEqual({ kind: 'dialog', asset: 'scene' });
    expect(launchMove('presenter', nowhere, ['new'], null)).toEqual({ kind: 'presenters' });
    expect(launchMove('presenter', nowhere, ['start'], null)).toEqual({ kind: 'studio' });
  });

  it('a presenter draft is resume, even when they never walked the way there', () => {
    expect(launchMove('presenter', nowhere, [], 'draft-1')).toEqual({ kind: 'studio' });
    expect(launchMove('presenter', { ...nowhere, onPresenters: true }, ['face'], 'draft-1')).toEqual({
      kind: 'studio',
    });
  });

  it('Start again has empty reached, so it walks again', () => {
    expect(launchMove('refine', nowhere, [], null)).toEqual({ kind: 'head' });
    expect(launchMove('product', nowhere, [], null)).toEqual({ kind: 'head' });
    expect(launchMove('presenter', nowhere, [], null)).toEqual({ kind: 'head' });
  });
});
