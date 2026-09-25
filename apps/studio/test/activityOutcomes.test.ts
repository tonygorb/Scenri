import { beforeEach, describe, expect, it } from 'vitest';
import type { ActivityNode, StudioWork } from '../src/api.js';
import {
  loadRunning,
  lostWork,
  resumeFrom,
  saveRunning,
  settled,
  studioSubtitle,
  taskFromNode,
  taskFromStudioWork,
  type Task,
} from '../src/tasks.js';

/**
 * What the bell says when work ends in a way other than a clean finish: a
 * restart that swept a shot or took studio work with it, a run that drew some
 * of what it was asked for, a change that drew nothing, and a finish that
 * happened while the person was in another brand or reloading.
 */

const brand = { slug: 'acme' };
const now = new Date('2026-09-26T10:00:00Z');

const task = (over: Partial<Task> = {}): Task => ({
  id: 'scene:j1',
  kind: 'scene',
  state: 'running',
  title: 'Restart Hall',
  subtitle: 'Drawing the picture',
  thumb: null,
  percent: null,
  startedAt: '2026-09-26 09:59:00',
  href: '/acme/scenes/new/c1',
  ...over,
});

const work = (over: Partial<StudioWork>): StudioWork => ({
  id: 'examples:x1',
  kind: 'examples',
  status: 'done',
  step: null,
  name: 'Counter Five',
  thumb: 'abc',
  startedAt: '2026-09-26 09:59:00',
  finishedAt: '2026-09-26 10:00:00',
  error: null,
  sceneId: 'us-9',
  done: 1,
  total: 2,
  ...over,
});

describe('a restart', () => {
  it('says a swept shot in plain words, never the log line', () => {
    const n = {
      id: 'n1',
      projectId: 'p1',
      setNames: [],
      parentId: null,
      kind: 'generation',
      prompt: 'restart shot',
      engineId: 'demo',
      status: 'error',
      images: [],
      costUsd: 0,
      kept: false,
      error: 'interrupted: server restarted mid-generation',
      createdAt: '2026-09-26 09:59:00',
      overlays: {},
      brief: null,
    } as unknown as ActivityNode;
    const t = taskFromNode(n, brand);
    expect(t.subtitle).not.toMatch(/interrupted/);
    expect(t.subtitle).toMatch(/Scenri restarted/);
    // any other error still says what the engine said
    expect(taskFromNode({ ...n, error: 'codex exited' }, brand).subtitle).toBe('codex exited');
  });

  it('turns studio work and builds that vanished while running into a failure', () => {
    const prev = new Map<string, Task>([
      ['scene:j1', task()],
      ['presenter:pd-1:r1', task({ id: 'presenter:pd-1:r1', kind: 'presenter', title: 'Rhea' })],
      ['build:b1', task({ id: 'build:b1', title: 'Old Hall' })],
      // a shot is swept to an error row by the server, so it never vanishes
      ['node:n1', task({ id: 'node:n1', kind: 'generation' })],
      // finished work that ages out of the list is not news
      ['scene:j2', task({ id: 'scene:j2', state: 'done' })],
    ]);
    const lost = lostWork(prev, []);
    expect(lost.map((t) => t.id).sort()).toEqual(['build:b1', 'presenter:pd-1:r1', 'scene:j1']);
    expect(lost.every((t) => t.state === 'error' && /Scenri restarted/.test(t.subtitle))).toBe(true);
    // born as notifications through the one place they are ever born
    const said = settled(prev, lost, now);
    expect(said.map((n) => [n.title, n.state])).toContainEqual(['Rhea', 'error']);
    expect(said.map((n) => n.title)).toContain('Restart Hall');
  });

  it('leaves work that is still listed alone', () => {
    const prev = new Map<string, Task>([['scene:j1', task()]]);
    expect(lostWork(prev, [task({ state: 'done' })])).toEqual([]);
    expect(lostWork(null, [])).toEqual([]);
  });
});

describe('a run that drew some of it', () => {
  it('is partial, not a clean success, and says how many did not draw', () => {
    const t = taskFromStudioWork(work({ error: '1 did not draw' }), brand);
    expect(t.state).toBe('partial');
    expect(t.subtitle).toBe('One example drawn · 1 did not draw');
    // the raw engine reason never becomes the row's words
    const raw = taskFromStudioWork(work({ error: 'OpenRouter HTTP 429: rate limited' }), brand);
    expect(raw.state).toBe('partial');
    expect(raw.subtitle).not.toMatch(/429/);
  });

  it('is partial for a presenter set that finished with an error too', () => {
    const p = work({
      id: 'presenter:pd-1:r1',
      kind: 'presenter',
      step: 'right',
      name: 'Rhea',
      draftId: 'pd-1',
      done: 5,
      total: 6,
      error: 'fetch failed',
    });
    expect(taskFromStudioWork(p, brand).state).toBe('partial');
  });

  it('stays a plain done when nothing failed', () => {
    const t = taskFromStudioWork(work({ done: 2, total: 2 }), brand);
    expect(t.state).toBe('done');
    expect(t.subtitle).toBe('2 examples drawn');
  });
});

describe('a words-only change', () => {
  it('says the words changed, never that a picture was drawn', () => {
    const words = work({ id: 'scene:j3', kind: 'scene', job: 'change', thumb: null, conversation: 'c1' });
    expect(studioSubtitle(words)).toBe('The words are changed');
    // a change that drew keeps saying so
    expect(studioSubtitle({ ...words, thumb: 'h1' })).toBe('The picture is drawn');
  });
});

describe('a finish while the person was away', () => {
  beforeEach(() => sessionStorage.clear());

  it('is news on the first answer back, and nothing else in that answer is', () => {
    saveRunning('b1', [task(), task({ id: 'node:n2', kind: 'generation', state: 'done' })]);
    const kept = loadRunning('b1');
    // only running work is kept
    expect(kept.map((t) => t.id)).toEqual(['scene:j1']);
    const next = [task({ state: 'done' }), task({ id: 'node:old', kind: 'generation', state: 'done' })];
    const said = settled(resumeFrom(kept, next), next, now);
    expect(said.map((n) => n.id)).toEqual(['scene:j1']);
  });

  it('is a plain baseline when nothing was running', () => {
    expect(resumeFrom(loadRunning('b2'), [task({ state: 'done' })])).toBeNull();
  });

  it('keeps each brand to itself', () => {
    saveRunning('b1', [task()]);
    expect(loadRunning('b2')).toEqual([]);
  });

  it('survives a snapshot that is not a list', () => {
    sessionStorage.setItem('scenri:activity-running-b1', '{not json');
    expect(loadRunning('b1')).toEqual([]);
  });
});
