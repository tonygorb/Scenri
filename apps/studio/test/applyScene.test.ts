import { describe, it, expect } from 'vitest';
import { resolveSceneSwitch } from '../src/composer/applyScene.js';

describe('resolveSceneSwitch', () => {
  it('is a true no-op when re-picking the currently-attached scene', () => {
    const result = resolveSceneSwitch('scene-a', 'scene-a', 'Scene A', null, null);
    expect(result).toEqual({ changed: false, toast: null });
  });

  it('is a true no-op even with an active branch target, when re-picking the same scene', () => {
    const result = resolveSceneSwitch('scene-a', 'scene-a', 'Scene A', 'n1', 'that shot');
    expect(result).toEqual({ changed: false, toast: null });
  });

  it('attaches silently when there is no existing scene and no branch target', () => {
    const result = resolveSceneSwitch(null, 'scene-a', 'Scene A', null, null);
    expect(result).toEqual({ changed: true, toast: null });
  });

  it('switching from one scene to another shows a toast naming only the scene', () => {
    const result = resolveSceneSwitch('scene-a', 'scene-b', 'Scene B', null, null);
    expect(result.changed).toBe(true);
    expect(result.toast).toEqual({ title: 'Switched to Scene B.', prevSceneId: 'scene-a', branchWasCleared: false });
  });

  it('a first attach that also clears an active branch target is announced, not silent', () => {
    const result = resolveSceneSwitch(null, 'scene-a', 'Scene A', 'n1', 'the red chair');
    expect(result.changed).toBe(true);
    expect(result.toast).toEqual({
      title: 'Switched to Scene A. This starts a new shot instead of refining the red chair.',
      prevSceneId: null,
      branchWasCleared: true,
    });
  });

  it('names both facts when a scene switch also drops a branch target', () => {
    const result = resolveSceneSwitch('scene-a', 'scene-b', 'Scene B', 'n1', 'the red chair');
    expect(result.toast?.title).toBe('Switched to Scene B. This starts a new shot instead of refining the red chair.');
    expect(result.toast?.prevSceneId).toBe('scene-a');
    expect(result.toast?.branchWasCleared).toBe(true);
  });

  it('falls back to a generic phrase when the branch target has no label', () => {
    const result = resolveSceneSwitch(null, 'scene-a', 'Scene A', 'n1', null);
    expect(result.toast?.title).toBe('Switched to Scene A. This starts a new shot instead of refining that shot.');
  });
});
