import { describe, it, expect, beforeEach } from 'vitest';
import type { ActivityNode, AssetBuild, CatalogImportJob } from '../src/api.js';
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
  runningPhrase,
  saveFeed,
  saveSeen,
  settled,
  taskFromAssetBuild,
  taskFromCatalogJob,
  taskFromNode,
  unreadCount,
  type NotificationItem,
  type Task,
} from '../src/tasks.js';

/** Only the slug is read: an href is spelled from it, never from the id. */
const brand = { slug: 'b1' };

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
  href: '/b1/create/shots/n1',
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
  href: '/b1/create/shots/n1',
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

describe('runningPhrase', () => {
  const t0 = Date.UTC(2026, 7, 4, 12, 0, 0);
  const at = '2026-08-04T12:00:00Z';
  it('is plain "generating" under 20s', () => {
    expect(runningPhrase(at, t0)).toBe('generating');
    expect(runningPhrase(at, t0 + 19_000)).toBe('generating');
  });
  it('becomes "still generating" from 20s up to 60s', () => {
    expect(runningPhrase(at, t0 + 20_000)).toBe('still generating');
    expect(runningPhrase(at, t0 + 59_000)).toBe('still generating');
  });
  it('becomes "taking longer than usual" at 60s and beyond', () => {
    expect(runningPhrase(at, t0 + 60_000)).toBe('taking longer than usual');
    expect(runningPhrase(at, t0 + 5 * 60_000)).toBe('taking longer than usual');
  });
});

describe('taskFromNode', () => {
  it('never invents a percent for a generation', () => {
    expect(taskFromNode(node(), brand).percent).toBeNull();
    expect(taskFromNode(node({ status: 'done', images: ['h1', 'h2'] }), brand).percent).toBeNull();
  });
  it('says where the work is and what came of it', () => {
    const done = taskFromNode(node({ status: 'done', images: ['h1', 'h2'] }), brand);
    expect(done.subtitle).toBe('Spring · 2 images');
    expect(done.thumb).toBe('h1');
    // the shot hangs off the hub, not off a project nobody named
    expect(done.href).toBe('/b1/create/shots/n1');
    expect(taskFromNode(node({ status: 'done', images: ['h1'] }), brand).subtitle).toBe('Spring · 1 image');
    expect(taskFromNode(node({ status: 'error', error: 'engine refused' }), brand).subtitle).toBe(
      'Spring · engine refused',
    );
  });
  it('marks an edit as an edit', () => {
    const t = taskFromNode(node({ kind: 'edit' }), brand);
    expect(t.kind).toBe('edit');
    expect(t.title.startsWith('Edit · ')).toBe(true);
  });
  it('says only what happened when the shot is in no set', () => {
    // the ordinary case now: no container to name, so no container is named
    expect(taskFromNode(node({ setNames: [], status: 'done', images: ['h1'] }), brand).subtitle).toBe('1 image');
    // the fixture's createdAt is long in the past, so the honest staged copy is this, not "generating"
    expect(taskFromNode(node({ setNames: [] }), brand).subtitle).toBe('taking longer than usual');
  });
  it('names every set a shot belongs to', () => {
    expect(
      taskFromNode(node({ setNames: ['Spring', 'Packshots'], status: 'done', images: ['h1'] }), brand).subtitle,
    ).toBe('Spring, Packshots · 1 image');
  });
  it('leaves the elapsed count to the time column', () => {
    // the row already carries the seconds on the right; twice is noise
    expect(taskFromNode(node({ status: 'running' }), brand).subtitle).toBe('Spring · taking longer than usual');
  });
  it('names a cancelled shot instead of reporting an image count of zero', () => {
    expect(taskFromNode(node({ setNames: [], status: 'cancelled' }), brand).subtitle).toBe('cancelled');
  });
  it('stages the running phrase by elapsed time', () => {
    const now = Date.parse('2026-08-04T12:00:10Z');
    expect(taskFromNode(node({ setNames: [], status: 'running' }), brand, now).subtitle).toBe('generating');
    const now30 = Date.parse('2026-08-04T12:00:30Z');
    expect(taskFromNode(node({ setNames: [], status: 'running' }), brand, now30).subtitle).toBe('still generating');
  });
});

describe('catalogPercent', () => {
  // the numbers the import progress row shows, before the formula moved here
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
    expect(taskFromCatalogJob(job({ stage: 'completed' }), brand).percent).toBe(100);
  });
  it('titles by host and maps stage to state', () => {
    expect(taskFromCatalogJob(job(), brand).title).toBe('acme.example');
    expect(taskFromCatalogJob(job({ stage: 'discovering' }), brand).state).toBe('running');
    expect(taskFromCatalogJob(job({ stage: 'completed' }), brand).state).toBe('done');
    expect(taskFromCatalogJob(job({ stage: 'partial' }), brand).state).toBe('partial');
    expect(taskFromCatalogJob(job({ stage: 'failed' }), brand).state).toBe('error');
  });
  it('survives a url it cannot parse', () => {
    expect(taskFromCatalogJob(job({ url: 'not a url' }), brand).title).toBe('not a url');
  });
  it('points a finished catalog import at the kit, where the products landed', () => {
    expect(taskFromCatalogJob(job({ stage: 'completed' }), brand).href).toBe('/b1/kit');
  });
});

const build = (over: Partial<AssetBuild> = {}): AssetBuild => ({
  id: 'ab-1',
  brandId: 'b-1',
  kind: 'presenter',
  name: 'Mara',
  stage: 'building',
  step: 1,
  steps: 4,
  message: 'Building the studio views (1 of 4)',
  assetId: null,
  previewHash: null,
  warnings: [],
  coverage: [],
  facets: [],
  error: null,
  startedAt: '2026-08-04 12:00:00',
  finished: false,
  ...over,
});

describe('taskFromAssetBuild', () => {
  it('maps every stage to a state', () => {
    for (const stage of ['queued', 'analyzing', 'building', 'saving'] as const) {
      expect(taskFromAssetBuild(build({ stage }), brand).state).toBe('running');
    }
    expect(taskFromAssetBuild(build({ stage: 'done', finished: true }), brand).state).toBe('done');
    expect(taskFromAssetBuild(build({ stage: 'failed', finished: true }), brand).state).toBe('error');
    expect(taskFromAssetBuild(build({ stage: 'cancelled', finished: true }), brand).state).toBe('cancelled');
  });

  it('keeps the kind, so the row can wear the right glyph', () => {
    expect(taskFromAssetBuild(build(), brand).kind).toBe('presenter');
    expect(taskFromAssetBuild(build({ kind: 'scene' }), brand).kind).toBe('scene');
  });

  it('gets a real percent from real counters, and none when there are none', () => {
    expect(taskFromAssetBuild(build({ step: 1, steps: 4 }), brand).percent).toBe(25);
    expect(taskFromAssetBuild(build({ step: 4, steps: 4 }), brand).percent).toBe(100);
    expect(taskFromAssetBuild(build({ step: 0, steps: 0 }), brand).percent).toBeNull();
  });

  it('has nowhere to go until the asset exists, then points at its page', () => {
    expect(taskFromAssetBuild(build(), brand).href).toBeNull();
    expect(taskFromAssetBuild(build({ stage: 'done', finished: true, assetId: 'up-9' }), brand).href).toBe(
      '/b1/presenters/up-9',
    );
    expect(
      taskFromAssetBuild(build({ kind: 'scene', stage: 'done', finished: true, assetId: 'us-9' }), brand).href,
    ).toBe('/b1/scenes/us-9');
  });

  it('says the error when it failed, and the stage message while it runs', () => {
    expect(
      taskFromAssetBuild(build({ stage: 'failed', finished: true, error: 'codex exited 1' }), brand).subtitle,
    ).toBe('codex exited 1');
    expect(taskFromAssetBuild(build(), brand).subtitle).toBe('Building the studio views (1 of 4)');
  });

  it('surfaces a warning or a coverage note on the finished row, where it can still be read', () => {
    expect(
      taskFromAssetBuild(
        build({ stage: 'done', finished: true, warnings: ['The back view could not be drawn'] }),
        brand,
      ).subtitle,
    ).toBe('The back view could not be drawn');
    expect(
      taskFromAssetBuild(
        build({ stage: 'done', finished: true, coverage: ['A three-quarter photo would help'] }),
        brand,
      ).subtitle,
    ).toBe('A three-quarter photo would help');
  });

  it('namespaces its id so it cannot collide with a node or a catalog job', () => {
    expect(taskFromAssetBuild(build(), brand).id).toBe('build:ab-1');
  });

  it('shows the first drawn frame as soon as there is one', () => {
    expect(taskFromAssetBuild(build({ previewHash: 'a'.repeat(32) }), brand).thumb).toBe('a'.repeat(32));
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

describe('unread and watched work', () => {
  const item = (id: string, at: string, over: Partial<NotificationItem> = {}): NotificationItem => ({
    id,
    kind: 'generation',
    state: 'done',
    title: id,
    subtitle: '',
    thumb: null,
    at,
    href: null,
    ...over,
  });

  it('does not badge work that landed on the screen you were watching', () => {
    // the record keeps it; the bell just stops claiming it needs attention
    const feed = [item('a', '2026-08-14 10:00:00', { watched: true }), item('b', '2026-08-14 10:01:00')];
    expect(unreadCount(feed, '2026-08-14 09:00:00')).toBe(1);
  });

  it('counts everything unwatched when nothing has been seen yet', () => {
    const feed = [item('a', '2026-08-14 10:00:00', { watched: true }), item('b', '2026-08-14 10:01:00')];
    expect(unreadCount(feed, null)).toBe(1);
  });

  it('still badges a failure that happened while you were watching', () => {
    // errors are never marked watched at the call site, so they always count
    const feed = [item('a', '2026-08-14 10:00:00', { state: 'error' })];
    expect(unreadCount(feed, '2026-08-14 09:00:00')).toBe(1);
  });
});
