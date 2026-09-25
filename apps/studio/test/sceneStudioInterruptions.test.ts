import { afterEach, describe, expect, it } from 'vitest';
import type { ScenePatch, StudioWork } from '../src/apiTypes.js';
import { markSceneFinished, sceneDraftOf, sceneDrafts, sceneFinishedIn } from '../src/create/scene/sceneDrafts.js';
import {
  deserializeSetup,
  EMPTY_SETUP,
  isHeic,
  reduceSetup,
  type SetupState,
  serializeSetup,
} from '../src/create/scene/sceneSetup.js';
import {
  type Action,
  changedFrom,
  deserialize,
  EMPTY,
  reduce,
  serialize,
  type StudioState,
} from '../src/create/scene/sceneStudioRules.js';

/**
 * The scene studio when something goes wrong half way: a Stop or a press that
 * never reached the server, a reload in the middle of a change, two uploads
 * landing at once, an edit saved over a rename made elsewhere, a conversation
 * opened again after it finished.
 */
const H = (c: string) => c.repeat(32);
const run = (s: StudioState, ...as: Action[]) => as.reduce(reduce, s);

describe('a Stop that never reached the server', () => {
  const stopping = run(
    EMPTY,
    { type: 'inputs', place: 'a shore', pictures: [] },
    { type: 'started', id: 'j1', kind: 'again', since: 't0' },
    { type: 'stopping', id: 'j1' },
  );

  it('gives the pill back, so Stop can be pressed again, and a reload finds it that way', () => {
    const s = reduce(stopping, { type: 'stop-failed', id: 'j1' });
    expect(s.job?.id).toBe('j1');
    expect(s.job?.stopping).toBeUndefined();
    expect(deserialize(serialize(s))).toEqual(s);
    // pressed again, it says Stopping again
    expect(reduce(s, { type: 'stopping', id: 'j1' }).job?.stopping).toBe(true);
  });

  it('changes nothing for other work, or for work not stopping', () => {
    expect(reduce(stopping, { type: 'stop-failed', id: 'j9' })).toBe(stopping);
    const s = reduce(stopping, { type: 'stop-failed', id: 'j1' });
    expect(reduce(s, { type: 'stop-failed', id: 'j1' })).toBe(s);
  });
});

describe('a press for the place in use that never started a run', () => {
  it('makes the offer it answered again, the place in use or the three more', () => {
    const drawnSet = run(EMPTY, { type: 'saved', id: 'us-1' }, { type: 'set-drawn' });
    expect(reduce(drawnSet, { type: 'set-failed', more: false }).setDrawn).toBe(false);
    const asked = reduce(drawnSet, { type: 'ask-more' });
    const back = reduce(asked, { type: 'set-failed', more: true });
    expect(back.moreAsked).toBe(false);
    // the place in use was drawn; only the three more are offered again
    expect(back.setDrawn).toBe(true);
  });
});

describe('a reload in the middle of a change to an answer', () => {
  it('is Cancel: the answer as it stood comes back, not the half-changed one', () => {
    const given: SetupState = {
      ...EMPTY_SETUP,
      answers: { source: { door: 'photos' }, photos: { hashes: [H('a'), H('b')], done: true } },
    };
    let s = reduceSetup(given, { type: 'edit', id: 'photos' });
    s = reduceSetup(s, { type: 'photos', hashes: [H('b')] });
    expect(s.answers.photos?.hashes).toEqual([H('b')]);
    const back = deserializeSetup(JSON.parse(JSON.stringify(serializeSetup(s))));
    expect(back?.answers.photos).toEqual({ hashes: [H('a'), H('b')], done: true });
    expect(back?.editing).toBeNull();
  });
});

describe('pictures uploaded together', () => {
  it('keeps every one that lands, however close together they land', () => {
    let s: SetupState = { ...EMPTY_SETUP, answers: { source: { door: 'photos' } } };
    // two uploads whose answers arrive before the page has drawn either
    s = reduceSetup(s, { type: 'photo', hash: H('a') });
    s = reduceSetup(s, { type: 'photo', hash: H('b') });
    expect(s.answers.photos?.hashes).toEqual([H('a'), H('b')]);
  });

  it('says HEIC rather than sending it, whatever the file claims to be', () => {
    expect(isHeic({ type: 'image/heic', name: 'IMG_0001.HEIC' })).toBe(true);
    expect(isHeic({ type: '', name: 'IMG_0002.heif' })).toBe(true);
    expect(isHeic({ type: 'image/jpeg', name: 'IMG_0003.jpg' })).toBe(false);
  });
});

describe('an edit saved while the scene changed elsewhere', () => {
  const was: ScenePatch = {
    name: 'Harbor Room',
    verticals: ['Beverage'],
    prompt: 'A harbour room.',
    previewHash: H('a'),
    anchor: true,
  };

  it('sends only what the editor changed, so a rename made elsewhere stands', () => {
    expect(changedFrom({ ...was }, was)).toEqual({});
    expect(changedFrom({ ...was, prompt: 'A harbour room at night.' }, was)).toEqual({
      prompt: 'A harbour room at night.',
    });
  });

  it('sends a new picture with what it is', () => {
    expect(changedFrom({ ...was, previewHash: H('b') }, was)).toEqual({ previewHash: H('b'), anchor: true });
    expect(
      changedFrom({ ...was, heroHash: H('c'), heroWith: { product: 'p1' } }, { ...was, heroWith: { product: 'p1' } }),
    ).toEqual({ heroHash: H('c'), heroWith: { product: 'p1' } });
  });
});

describe('a conversation that finished', () => {
  afterEach(() => localStorage.clear());

  it('leaves its scene under its address, and is never a draft', () => {
    const key = 'scenri:scene-studio:b1:c0ffee';
    expect(sceneFinishedIn('b1', 'c0ffee')).toBeNull();
    markSceneFinished(key, 'us-1');
    expect(sceneFinishedIn('b1', 'c0ffee')).toBe('us-1');
    expect(sceneDraftOf('c0ffee', localStorage.getItem(key))).toBeNull();
  });

  it('is not a draft for work another tab still runs in it', () => {
    const running: StudioWork = {
      id: 'scene:j7',
      kind: 'scene',
      status: 'running',
      step: 'changing',
      job: 'change',
      name: 'Twin Cyc',
      thumb: null,
      startedAt: '2026-09-26T00:00:00Z',
      finishedAt: null,
      error: null,
      conversation: 'c0ffee',
    };
    expect(sceneDrafts([], [running])).toHaveLength(1);
    markSceneFinished('scenri:scene-studio:b1:c0ffee', 'us-1');
    expect(sceneDrafts([], [running])).toEqual([]);
  });

  it('is not mistaken for one still open', () => {
    localStorage.setItem('scenri:scene-studio:b1:open', JSON.stringify({ at: 1, sceneId: 'us-2', session: '{}' }));
    expect(sceneFinishedIn('b1', 'open')).toBeNull();
  });
});
