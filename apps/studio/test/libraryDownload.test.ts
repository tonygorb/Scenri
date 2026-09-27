import { describe, expect, it } from 'vitest';
import type { ContentState } from '../src/api.js';
import { catalogsStale, picturesArriving, sameContent } from '../src/app/contentRules.js';
import { keepIfSame, release } from '../src/catalogRead.js';
import { CONTENT_TASK_ID, leadTask, runningVerb, settled, type Task, taskFromContent } from '../src/tasks.js';

/**
 * The first-run library download as the studio sees it: pictures that land a
 * few at a time (the catalogs are read again as they do), a card that holds its
 * place for as long as one may still be coming, and one Activity row that
 * counts, fills, and says how the run ended exactly once.
 */

const running: ContentState = {
  arriving: true,
  installs: 0,
  landed: 12,
  total: 604,
  bytes: 30_000_000,
  totalBytes: 150_000_000,
  failed: 0,
  outcome: null,
  startedAt: '2026-09-27T10:00:00.000Z',
};

describe('what the studio makes of the download', () => {
  it('reads the catalogs again as pictures land and when the run ends, not on an unchanged answer', () => {
    expect(catalogsStale(null, { ...running, landed: 0 })).toBe(false);
    expect(catalogsStale(null, running)).toBe(true);
    expect(catalogsStale(running, { ...running })).toBe(false);
    expect(catalogsStale(running, { ...running, landed: 13 })).toBe(true);
    expect(catalogsStale(running, { ...running, arriving: false, outcome: 'complete', installs: 1 })).toBe(true);
    // an older server's answer, with no counts at all
    expect(catalogsStale({ arriving: true, installs: 0 }, { arriving: false, installs: 1 })).toBe(true);
  });

  it("holds a card's place until the first answer, while pictures come, and until the last read is in", () => {
    expect(picturesArriving(null, false)).toBe(true);
    expect(picturesArriving(running, false)).toBe(true);
    const done = { ...running, arriving: false, outcome: 'complete' as const };
    expect(picturesArriving(done, true)).toBe(true);
    expect(picturesArriving(done, false)).toBe(false);
  });

  it('keeps an unchanged answer, so nothing re-renders', () => {
    expect(sameContent(running, { ...running, bytes: running.bytes })).toBe(true);
    expect(sameContent(running, { ...running, landed: 13 })).toBe(false);
    expect(sameContent(null, running)).toBe(false);
  });
});

describe('the Activity row', () => {
  const since = '2026-09-27T09:59:59.000Z';

  it("counts the pictures and fills by bytes while it runs, from the server's own start", () => {
    const t = taskFromContent(running, since) as Task;
    expect(t).toMatchObject({
      id: CONTENT_TASK_ID,
      kind: 'library',
      state: 'running',
      title: 'Downloading the Scenri library',
      subtitle: '12 of 604 pictures',
      percent: 20,
      startedAt: running.startedAt,
    });
    // never says 100 while anything is still coming
    expect(taskFromContent({ ...running, bytes: running.totalBytes }, since)?.percent).toBe(99);
    // an older server with no counts: the clock and no share
    expect(taskFromContent({ arriving: true, installs: 0 }, since)).toMatchObject({ percent: null, startedAt: since });
  });

  it('says how the run ended, and is nothing when there is nothing to say', () => {
    expect(taskFromContent({ ...running, arriving: false, outcome: 'complete', installs: 1 }, since)).toMatchObject({
      state: 'done',
      title: 'Scenri library downloaded',
    });
    const partial = taskFromContent({ ...running, arriving: false, outcome: 'partial', failed: 3 }, since);
    expect(partial).toMatchObject({ state: 'partial', title: 'Scenri library partly downloaded' });
    expect(partial?.subtitle).toBe('3 pictures did not download. Scenri tries again when it next starts.');
    expect(taskFromContent({ ...running, arriving: false, outcome: null }, since)).toBeNull();
  });

  it('files the outcome once, from running to done', () => {
    const run = taskFromContent(running, since) as Task;
    const done = taskFromContent({ ...running, arriving: false, outcome: 'complete' }, since) as Task;
    const first = settled(new Map([[run.id, run]]), [done]);
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ id: CONTENT_TASK_ID, kind: 'library', state: 'done' });
    expect(settled(new Map([[done.id, done]]), [done])).toHaveLength(0);
  });

  it('lets a shot lead the bar over the download, and names what the lead is doing', () => {
    const lib = taskFromContent(running, since) as Task;
    const shot: Task = {
      ...lib,
      id: 'node:1',
      kind: 'generation',
      title: 'A shot',
      startedAt: '2026-09-27T10:05:00.000Z',
    };
    expect(leadTask([lib, shot])?.id).toBe('node:1');
    expect(leadTask([lib])?.id).toBe(CONTENT_TASK_ID);
    expect(leadTask([{ ...lib, state: 'done' }])).toBeNull();
    expect(runningVerb('library')).toBe('Downloading the library');
    expect(runningVerb('catalog')).toBe('Importing');
    expect(runningVerb('generation')).toBe('Rendering');
  });
});

describe('reading a catalog again', () => {
  it('keeps the held answer when the new one says the same', () => {
    const held = { showcase: [{ id: 'a', previewUrl: null }], loaded: true };
    expect(keepIfSame(held, { showcase: [{ id: 'a', previewUrl: null }], loaded: true })).toBe(held);
    const next = { showcase: [{ id: 'a', previewUrl: '/p.jpg' }], loaded: true };
    expect(keepIfSame(held, next)).toBe(next);
  });

  it('tells everyone waiting once, and only once', () => {
    let told = 0;
    const waiting = { current: [() => told++, () => told++] };
    release(waiting);
    release(waiting);
    expect(told).toBe(2);
    expect(waiting.current).toEqual([]);
  });
});
