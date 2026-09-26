import { describe, expect, it } from 'vitest';
import type { SceneReading, SceneStudioJob, StudioWork } from '../src/apiTypes.js';
import { sceneDraftOf, sceneDrafts, sceneDraftState } from '../src/create/scene/sceneDrafts.js';
import { packSession } from '../src/create/scene/sceneFlowRules.js';
import { EMPTY_SETUP } from '../src/create/scene/sceneSetup.js';
import { EMPTY, reduce, type StudioState } from '../src/create/scene/sceneStudioRules.js';

const R: SceneReading = {
  name: 'Night Shore',
  prompt: 'A shore at night.',
  lighting: 'Moonlight',
  subject: 'either',
  description: 'A shore.',
};
const job = (over: Partial<SceneStudioJob>): SceneStudioJob => ({
  id: 'j1',
  brandId: 'b',
  kind: 'make',
  status: 'done',
  phase: null,
  startedAt: 't',
  phaseAt: 't',
  finishedAt: 't',
  reading: R,
  coverage: [],
  hash: null,
  error: null,
  warnings: [],
  attachTo: null,
  ...over,
});
const kept = (studio: StudioState, sceneId: string | null = null) =>
  JSON.stringify({ at: 1000, sceneId, session: packSession(EMPTY_SETUP, studio) });

const read = [
  { type: 'inputs', place: 'a shore', pictures: [] },
  { type: 'started', id: 'j1', kind: 'make', since: 't' },
  { type: 'finished', job: job({}) },
].reduce((s, a) => reduce(s, a as any), EMPTY);
const drawing = reduce(read, { type: 'started', id: 'j2', kind: 'again', since: 't' });
const drawn = reduce(drawing, { type: 'finished', job: job({ id: 'j2', kind: 'again', hash: 'a'.repeat(32) }) });

const work = (over: Partial<StudioWork>): StudioWork => ({
  id: 'scene:j2',
  kind: 'scene',
  status: 'running',
  step: 'drawing',
  name: 'Night Shore',
  thumb: null,
  startedAt: '2026-09-22T01:00:00Z',
  finishedAt: null,
  error: null,
  conversation: 'c1',
  ...over,
});

describe('scenes still being made', () => {
  it('are the conversations with anything in them: a reading, a picture, a draw under way', () => {
    expect(sceneDraftOf('c1', kept(EMPTY))).toBeNull();
    expect(sceneDraftOf('c1', kept(read))).toMatchObject({ read: true, drawing: false, hash: null });
    expect(sceneDraftState(sceneDraftOf('c1', kept(read))!)).toBe('Not drawn yet');
    expect(sceneDraftOf('c1', kept(drawing))).toMatchObject({ convo: 'c1', drawing: true, jobId: 'j2', hash: null });
    expect(sceneDraftOf('c1', kept(drawn))).toMatchObject({
      drawing: false,
      hash: 'a'.repeat(32),
      name: 'Night Shore',
    });
  });

  it('are never an edit of a saved scene, or something unreadable', () => {
    expect(sceneDraftOf('c1', kept(drawn, 'us-1'))).toBeNull();
    expect(sceneDraftOf('c1', 'not json')).toBeNull();
    expect(sceneDraftOf('c1', null)).toBeNull();
  });

  it('take what the server knows about the work they started', () => {
    const d = sceneDraftOf('c1', kept(drawing))!;
    // still drawing
    expect(sceneDrafts([d], [work({})])[0]).toMatchObject({ drawing: true });
    // drawn while nobody was on the page: the card is the picture
    const done = sceneDrafts([d], [work({ status: 'done', thumb: 'b'.repeat(32) })])[0];
    expect(done).toMatchObject({ drawing: false, hash: 'b'.repeat(32) });
    expect(sceneDraftState(done)).toBe('Drawn, not used yet');
    // failed
    expect(sceneDraftState(sceneDrafts([d], [work({ status: 'failed' })])[0])).toBe('Did not finish');
    // a server that no longer knows the job (a restart): not drawing, and its words still stand
    expect(sceneDrafts([d], [])).toMatchObject([{ drawing: false, read: true }]);
  });

  it('keep a scene that failed before anything was read, named by what was said', () => {
    // Codex out of its limit on the very first read: no words, no picture, a failure
    const failed = [
      { type: 'inputs', place: 'a salt flat at blue hour with long shadows', pictures: [] },
      { type: 'started', id: 'j1', kind: 'make', since: 't' },
      { type: 'finished', job: job({ status: 'failed', reading: null, error: 'usage limit reached' }) },
    ].reduce((st, a) => reduce(st, a as any), EMPTY);
    const d = sceneDraftOf('c3', kept(failed))!;
    expect(d).toMatchObject({ failed: true, read: false, drawing: false, name: 'a salt flat at blue' });
    expect(sceneDraftState(d)).toBe('Did not finish');
    expect(sceneDrafts([d], [])).toHaveLength(1);
  });

  it('say a picture stands when the last Try again failed, rather than that nothing finished', () => {
    const tried = reduce(drawn, { type: 'started', id: 'j3', kind: 'again', since: 't' });
    const failedAgain = reduce(tried, {
      type: 'finished',
      job: job({ id: 'j3', kind: 'again', status: 'failed', error: 'the engine returned no picture' }),
    });
    const d = sceneDraftOf('c1', kept(failedAgain))!;
    expect(d).toMatchObject({ failed: true, hash: 'a'.repeat(32) });
    expect(sceneDraftState(d)).toBe('Drawn, not used yet');
    // the same when the server is the one that says the Try again failed
    const running = sceneDraftOf('c1', kept(tried))!;
    const told = sceneDrafts([running], [work({ id: 'scene:j3', status: 'failed' })])[0];
    expect(told).toMatchObject({ failed: true, hash: 'a'.repeat(32) });
    expect(sceneDraftState(told)).toBe('Drawn, not used yet');
  });

  it('include work running for a conversation this browser does not hold, and never an edit', () => {
    const other = sceneDrafts([], [work({ conversation: 'c9' })]);
    expect(other).toMatchObject([{ convo: 'c9', drawing: true, name: 'Night Shore' }]);
    expect(sceneDrafts([], [work({ conversation: 'c9', sceneId: 'us-1' })])).toEqual([]);
    expect(sceneDrafts([], [work({ conversation: 'c9', status: 'done' })])).toEqual([]);
  });
});
