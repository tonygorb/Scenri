import { describe, it, expect, beforeEach } from 'vitest';
import type { ActivityNode, CatalogImportJob } from '../src/api.js';
import {
  agoLabel,
  catalogPercent,
  elapsedLabel,
  elapsedSec,
  loadFeed,
  loadSeen,
  mergeFeed,
  orderTasks,
  parseTime,
  saveFeed,
  saveSeen,
  settled,
  taskFromCatalogJob,
  taskFromNode,
  unreadCount,
  type NotificationItem,
  type Task,
} from '../src/tasks.js';

const node = (over: Partial<ActivityNode> = {}): ActivityNode => ({
  id: 'n1',
  projectId: 'p1',
  setNames: ['Spring'],
  parentId: null,
  kind: 'generation',
  prompt: 'golden hour on the roof',
  engineId: 'demo',
  status: 'running',
  images: [],
  costUsd: 0,
  kept: false,
  error: null,
  createdAt: '2026-08-04 12:00:00',
  overlays: {},
  brief: null,
  ...over,
});

const job = (over: Partial<CatalogImportJob> = {}): CatalogImportJob => ({
  id: 'j1',
  brandId: 'b1',
  sourceId: null,
  url: 'https://www.acme.example/collections/all',
  platform: 'shopify',
  stage: 'queued',
  discovered: 0,
  fetched: 0,
  upserted: 0,
  imagesDone: 0,
  imagesTotal: 0,
  errors: [],
  warnings: [],
  message: null,
  createdAt: '2026-08-04 12:00:00',
  updatedAt: '2026-08-04 12:00:00',
  finishedAt: null,
  ...over,
});

const task = (over: Partial<Task> = {}): Task => ({
  id: 'node:n1',
  kind: 'generation',
  state: 'running',
  title: 'golden hour',
  subtitle: 'Spring · generating, 2s',
  thumb: null,
  percent: null,
  startedAt: '2026-08-04 12:00:00',
  href: '/b/b1/p/p1/n/n1',
  ...over,
});

const notif = (over: Partial<NotificationItem> = {}): NotificationItem => ({
  id: 'node:n1',
  kind: 'generation',
  state: 'done',
  title: 'golden hour',
  subtitle: 'Spring · 2 images',
  thumb: null,
  at: '2026-08-04T12:00:00.000Z',
  href: '/b/b1/p/p1/n/n1',
  ...over,
});

describe('time', () => {
  it('reads SQLite datetime as UTC, not local', () => {
    // the same instant, written both ways: they must not differ by the offset
    expect(parseTime('2026-08-04 12:00:00')).toBe(parseTime('2026-08-04T12:00:00Z'));
    expect(parseTime('2026-08-04 12:00:00')).toBe(Date.UTC(2026, 7, 4, 12, 0, 0));
  });
  it('never reports negative elapsed for a clock skewed into the future', () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    expect(elapsedSec(future)).toBe(0);
  });
  it('labels elapsed and ago at each threshold', () => {
    const t0 = Date.UTC(2026, 7, 4, 12, 0, 0);
    const at = '2026-08-04T12:00:00Z';
    expect(elapsedLabel(at, t0 + 42_000)).toBe('42s');
    expect(elapsedLabel(at, t0 + 4 * 60_000)).toBe('4m');
    expect(elapsedLabel(at, t0 + 62 * 60_000)).toBe('1h 2m');
    expect(agoLabel(at, t0 + 10_000)).toBe('just now');
    expect(agoLabel(at, t0 + 4 * 60_000)).toBe('4m ago');
    expect(agoLabel(at, t0 + 5 * 3600_000)).toBe('5h ago');
    expect(agoLabel(at, t0 + 86_400_000)).toBe('Yesterday');
    expect(agoLabel(at, t0 + 3 * 86_400_000)).toBe('3d ago');
  });
});

describe('taskFromNode', () => {
  it('never invents a percent for a generation', () => {
    expect(taskFromNode(node(), '/b/b1').percent).toBeNull();
    expect(taskFromNode(node({ status: 'done', images: ['h1', 'h2'] }), '/b/b1').percent).toBeNull();
  });
  it('says where the work is and what came of it', () => {
    const done = taskFromNode(node({ status: 'done', images: ['h1', 'h2'] }), '/b/b1');
    expect(done.subtitle).toBe('Spring · 2 images');
    expect(done.thumb).toBe('h1');
    // the shot hangs off the hub, not off a project nobody named
    expect(done.href).toBe('/b/b1/create/n/n1');
    expect(taskFromNode(node({ status: 'done', images: ['h1'] }), '/b/b1').subtitle).toBe('Spring · 1 image');
    expect(taskFromNode(node({ status: 'error', error: 'engine refused' }), '/b/b1').subtitle).toBe(
      'Spring · engine refused',
    );
  });
  it('marks an edit as an edit', () => {
    const t = taskFromNode(node({ kind: 'edit' }), '/b/b1');
    expect(t.kind).toBe('edit');
    expect(t.title.startsWith('Edit · ')).toBe(true);
  });
  it('says only what happened when the shot is in no set', () => {
    // the ordinary case now: no container to name, so no container is named
    expect(taskFromNode(node({ setNames: [], status: 'done', images: ['h1'] }), '/b/b1').subtitle).toBe('1 image');
    expect(taskFromNode(node({ setNames: [] }), '/b/b1').subtitle).toBe('generating');
  });
  it('names every set a shot belongs to', () => {
    expect(
      taskFromNode(node({ setNames: ['Spring', 'Packshots'], status: 'done', images: ['h1'] }), '/b/b1').subtitle,
    ).toBe('Spring, Packshots · 1 image');
  });
  it('leaves the elapsed count to the time column', () => {
    // the row already carries the seconds on the right; twice is noise
    expect(taskFromNode(node({ status: 'running' }), '/b/b1').subtitle).toBe('Spring · generating');
  });
});

describe('catalogPercent', () => {
  // the numbers CatalogImportDialog showed before the formula moved here
  it('reproduces every stage', () => {
    expect(catalogPercent(null)).toBe(0);
    expect(catalogPercent(job({ stage: 'queued' }))).toBe(5);
    expect(catalogPercent(job({ stage: 'discovering' }))).toBe(8);
    expect(catalogPercent(job({ stage: 'discovering', discovered: 10 }))).toBe(15);
    expect(catalogPercent(job({ stage: 'fetching_products', discovered: 10, fetched: 5 }))).toBe(38);
    expect(catalogPercent(job({ stage: 'fetching_products', discovered: 10, fetched: 10 }))).toBe(60);
    expect(catalogPercent(job({ stage: 'processing_assets', imagesTotal: 10, imagesDone: 5 }))).toBe(78);
    expect(catalogPercent(job({ stage: 'processing_assets', imagesTotal: 0, imagesDone: 0 }))).toBe(60);
    expect(catalogPercent(job({ stage: 'partial' }))).toBe(95);
    expect(catalogPercent(job({ stage: 'completed' }))).toBe(100);
    expect(catalogPercent(job({ stage: 'failed' }))).toBe(5);
  });
});

describe('taskFromCatalogJob', () => {
  it('gets a real percent, because it has real counters', () => {
    expect(taskFromCatalogJob(job({ stage: 'completed' }), '/b/b1').percent).toBe(100);
  });
  it('titles by host and maps stage to state', () => {
    expect(taskFromCatalogJob(job(), '/b/b1').title).toBe('acme.example');
    expect(taskFromCatalogJob(job({ stage: 'discovering' }), '/b/b1').state).toBe('running');
    expect(taskFromCatalogJob(job({ stage: 'completed' }), '/b/b1').state).toBe('done');
    expect(taskFromCatalogJob(job({ stage: 'partial' }), '/b/b1').state).toBe('partial');
    expect(taskFromCatalogJob(job({ stage: 'failed' }), '/b/b1').state).toBe('error');
  });
  it('survives a url it cannot parse', () => {
    expect(taskFromCatalogJob(job({ url: 'not a url' }), '/b/b1').title).toBe('not a url');
  });
});

describe('orderTasks', () => {
  it('puts running first regardless of age', () => {
    const out = orderTasks([
      task({ id: 'a', state: 'done', startedAt: '2026-08-04 13:00:00' }),
      task({ id: 'b', state: 'running', startedAt: '2026-08-04 09:00:00' }),
    ]);
    expect(out.map((t) => t.id)).toEqual(['b', 'a']);
  });
  it('caps the finished tail but never the running head', () => {
    const running = Array.from({ length: 5 }, (_, i) => task({ id: `r${i}`, state: 'running' }));
    const done = Array.from({ length: 30 }, (_, i) =>
      task({ id: `d${i}`, state: 'done', startedAt: `2026-08-04 12:${String(i).padStart(2, '0')}:00` }),
    );
    const out = orderTasks([...done, ...running], 12);
    expect(out.filter((t) => t.state === 'running')).toHaveLength(5);
    expect(out.filter((t) => t.state !== 'running')).toHaveLength(12);
    // newest finished first
    expect(out[5].id).toBe('d29');
  });
});

describe('settled', () => {
  const now = new Date('2026-08-04T12:00:00Z');

  it('mints nothing before there is a baseline', () => {
    // the first poll after a page load must not announce old history
    expect(settled(null, [task({ state: 'done' })], now)).toEqual([]);
  });
  it('mints from an empty-but-real baseline', () => {
    // a brand with no history is still a brand that has been looked at
    expect(settled(new Map(), [task({ state: 'done' })], now)).toHaveLength(1);
  });
  it('mints for work that began and ended between two polls', () => {
    // the case the old running -> terminal rule dropped on the floor: fire a
    // shot from Home, walk away, and the finish landed inside one interval
    const prev = new Map([['node:old', task({ id: 'node:old', state: 'done' })]]);
    const out = settled(prev, [task({ id: 'node:old', state: 'done' }), task({ id: 'node:new', state: 'done' })], now);
    expect(out.map((n) => n.id)).toEqual(['node:new']);
  });
  it('mints exactly one item per running -> terminal transition', () => {
    const prev = new Map([
      ['node:a', task({ id: 'node:a', state: 'running' })],
      ['node:b', task({ id: 'node:b', state: 'running' })],
    ]);
    const out = settled(prev, [task({ id: 'node:a', state: 'done' }), task({ id: 'node:b', state: 'error' })], now);
    expect(out.map((n) => [n.id, n.state])).toEqual([
      ['node:a', 'done'],
      ['node:b', 'error'],
    ]);
    expect(out[0].at).toBe('2026-08-04T12:00:00.000Z');
  });
  it('mints nothing for a task that was already finished', () => {
    const prev = new Map([['node:a', task({ id: 'node:a', state: 'done' })]]);
    expect(settled(prev, [task({ id: 'node:a', state: 'done' })], now)).toEqual([]);
  });
  it('mints nothing for a task still running', () => {
    const prev = new Map([['node:a', task({ id: 'node:a', state: 'running' })]]);
    expect(settled(prev, [task({ id: 'node:a', state: 'running' })], now)).toEqual([]);
  });
  it('counts partial as settled', () => {
    const prev = new Map([['catalog:j', task({ id: 'catalog:j', state: 'running' })]]);
    expect(settled(prev, [task({ id: 'catalog:j', state: 'partial' })], now)).toHaveLength(1);
  });
});

describe('mergeFeed', () => {
  it('dedupes by id, newest first, capped', () => {
    const feed = [notif({ id: 'x', at: '2026-08-04T11:00:00Z', title: 'stale' })];
    const out = mergeFeed(feed, [notif({ id: 'x', at: '2026-08-04T12:00:00Z', title: 'fresh' })]);
    expect(out).toHaveLength(1);
    expect(out[0].title).toBe('fresh');
  });
  it('caps at 50', () => {
    const many = Array.from({ length: 80 }, (_, i) =>
      notif({ id: `n${i}`, at: `2026-08-04T${String(i % 24).padStart(2, '0')}:00:00Z` }),
    );
    expect(mergeFeed([], many)).toHaveLength(50);
  });
  it('returns the same array when nothing arrived', () => {
    const feed = [notif()];
    expect(mergeFeed(feed, [])).toBe(feed);
  });
});

describe('unreadCount', () => {
  it('counts everything when nothing has been seen', () => {
    expect(unreadCount([notif({ id: 'a' }), notif({ id: 'b' })], null)).toBe(2);
  });
  it('counts only what arrived after the mark', () => {
    const feed = [notif({ id: 'a', at: '2026-08-04T13:00:00Z' }), notif({ id: 'b', at: '2026-08-04T11:00:00Z' })];
    expect(unreadCount(feed, '2026-08-04T12:00:00Z')).toBe(1);
    expect(unreadCount(feed, '2026-08-04T14:00:00Z')).toBe(0);
  });
});

describe('storage', () => {
  beforeEach(() => localStorage.clear());

  it('round-trips per brand and does not leak across brands', () => {
    saveFeed('b1', [notif({ id: 'a' })]);
    saveSeen('b1', '2026-08-04T12:00:00Z');
    expect(loadFeed('b1')).toHaveLength(1);
    expect(loadSeen('b1')).toBe('2026-08-04T12:00:00Z');
    expect(loadFeed('b2')).toEqual([]);
    expect(loadSeen('b2')).toBeNull();
  });
  it('caps on write', () => {
    saveFeed(
      'b1',
      Array.from({ length: 80 }, (_, i) => notif({ id: `n${i}` })),
    );
    expect(loadFeed('b1')).toHaveLength(50);
  });
  it('survives malformed json and a non-array payload', () => {
    localStorage.setItem('scenri:notifications-b1', '{not json');
    expect(loadFeed('b1')).toEqual([]);
    localStorage.setItem('scenri:notifications-b1', '{"a":1}');
    expect(loadFeed('b1')).toEqual([]);
  });
  it('survives a localStorage that throws', () => {
    const real = Object.getOwnPropertyDescriptor(window, 'localStorage');
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('denied');
      },
    });
    expect(() => saveFeed('b1', [notif()])).not.toThrow();
    expect(loadFeed('b1')).toEqual([]);
    expect(loadSeen('b1')).toBeNull();
    if (real) Object.defineProperty(window, 'localStorage', real);
  });
});
