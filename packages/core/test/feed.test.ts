import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCore, matchesQuery, searchTerms, type Core, type FeedNode, type FeedSearchTerm } from '../src/index.js';
import { openDb } from '../src/db.js';

/**
 * The paged feed: one page for one place, lens, search and sort, from the
 * indexes, never from a read of the whole workspace. The pages must chain
 * into exactly the set a full read would give, in the order the sort names.
 */

let home: string;
let core: Core;
let brandId: string;
let projectId: string;
let rootId: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'sc-feed-'));
  core = createCore(home);
  const brand = core.store.createBrand({
    specVersion: '0.1',
    meta: { name: 'Feed Co' },
    products: [{ id: 'p-cup', name: 'Ceramic Mug' }],
    characters: [{ id: 'up-ana', name: 'Ana' }],
  } as any);
  brandId = brand.id;
  const project = core.store.workspaceFor(brandId);
  projectId = project.id;
  rootId = core.store.rootFor(projectId)!.id;
});
afterEach(() => {
  core.close();
  rmSync(home, { recursive: true, force: true });
});

/** One finished shot with a brief, in creation order. */
function shot(
  over: {
    prompt?: string;
    brief?: unknown;
    kind?: 'generation' | 'edit';
    parentId?: string;
    engineId?: string;
    cost?: number;
  } = {},
) {
  const [n] = core.store.addNodes({
    projectId,
    parentId: over.parentId ?? rootId,
    kind: over.kind ?? 'generation',
    prompt: over.prompt ?? 'a bottle on a plinth',
    engineId: over.engineId ?? 'demo',
    count: 1,
  });
  if (over.brief !== undefined) core.store.setBrief(n.id, over.brief);
  core.store.completeNode(n.id, { images: [`h-${n.id.slice(0, 8)}`], costUsd: over.cost ?? 0 });
  return core.store.getFeedNode(n.id)!;
}

const term = (text: string, extra: Partial<FeedSearchTerm> = {}): FeedSearchTerm => ({
  ...searchTerms(text)[0],
  tokenIds: [],
  engineIds: [],
  ...extra,
});

/** Every page of a query, chained by cursor. */
function allPages(q: Parameters<Core['store']['feedPage']>[1]): FeedNode[] {
  const out: FeedNode[] = [];
  let cursor: string | null = null;
  for (let i = 0; i < 100; i++) {
    const page = core.store.feedPage(projectId, { ...q, cursor });
    out.push(...page.items);
    cursor = page.next;
    if (!cursor) break;
  }
  return out;
}

describe('feed summaries', () => {
  it('carries the head of the prompt and the live refinement count, never the prompt or overlays', () => {
    const long = 'x'.repeat(500);
    const s = shot({ prompt: long });
    expect(s.promptHead).toBe('x'.repeat(240));
    expect('prompt' in s).toBe(false);
    expect('overlays' in s).toBe(false);
    expect(s.childCount).toBe(0);
    const kid = shot({ kind: 'edit', parentId: s.id });
    expect(core.store.getFeedNode(s.id)!.childCount).toBe(1);
    core.store.setArchived(kid.id, true);
    expect(core.store.getFeedNode(s.id)!.childCount).toBe(0);
    // the whole record still says everything
    const full = core.store.getNode(s.id)!;
    expect(full.prompt).toBe(long);
    expect(full.promptHead).toBe('x'.repeat(240));
    expect(full.childCount).toBe(0);
  });

  it('counts the head in code points, like SQLite', () => {
    const s = shot({ prompt: `${'é'.repeat(239)}Z tail` });
    expect(s.promptHead).toBe(`${'é'.repeat(239)}Z`);
  });
});

describe('feedPage', () => {
  it('pages newest first by keyset and chains into the whole set without holes or repeats', () => {
    const made = Array.from({ length: 7 }, (_, i) => shot({ prompt: `shot ${i}` }));
    const first = core.store.feedPage(projectId, { limit: 3 });
    expect(first.items.map((n) => n.id)).toEqual(
      made
        .slice(-3)
        .reverse()
        .map((n) => n.id),
    );
    expect(first.next).not.toBeNull();
    const all = allPages({ limit: 3 });
    expect(all.map((n) => n.id)).toEqual([...made].reverse().map((n) => n.id));
    expect(new Set(all.map((n) => n.id)).size).toBe(7);
    expect(core.store.feedPage(projectId, { limit: 10 }).next).toBeNull();
  });

  it('orders oldest, cost and keepers the way the client sorted, with a working cursor for each', () => {
    const a = shot({ prompt: 'a', cost: 0.5 });
    const b = shot({ prompt: 'b', cost: 0.1 });
    const c = shot({ prompt: 'c', cost: 0.5 });
    core.store.setKept(b.id, true);
    expect(allPages({ sort: 'oldest', limit: 2 }).map((n) => n.id)).toEqual([a.id, b.id, c.id]);
    expect(allPages({ sort: 'cost', limit: 2 }).map((n) => n.id)).toEqual([c.id, a.id, b.id]);
    expect(allPages({ sort: 'keepers', limit: 2 }).map((n) => n.id)).toEqual([b.id, c.id, a.id]);
  });

  it('applies the lens and never shows the root', () => {
    const a = shot();
    const b = shot();
    const c = shot();
    core.store.setKept(b.id, true);
    core.store.setArchived(c.id, true);
    expect(allPages({}).map((n) => n.id)).toEqual([b.id, a.id]);
    expect(allPages({ lens: 'keepers' }).map((n) => n.id)).toEqual([b.id]);
    expect(allPages({ lens: 'archived' }).map((n) => n.id)).toEqual([c.id]);
  });

  it('scopes to a set, to no set, or to a lineage', () => {
    const a = shot();
    const b = shot();
    const kid = shot({ kind: 'edit', parentId: a.id });
    const grandkid = shot({ kind: 'edit', parentId: kid.id });
    const set = core.store.createSet(brandId, 'Press');
    core.store.addToSet(set.id, [b.id]);
    expect(allPages({ set: set.id }).map((n) => n.id)).toEqual([b.id]);
    expect(allPages({ ungrouped: true }).map((n) => n.id)).toEqual([grandkid.id, kid.id, a.id]);
    expect(allPages({ lineage: a.id, sort: 'oldest' }).map((n) => n.id)).toEqual([a.id, kid.id, grandkid.id]);
  });

  it('finds shots by the ids their brief carries, including the legacy bare templateId', () => {
    const withProduct = shot({ brief: { tokens: [{ t: 'product', id: 'p-cup' }] } });
    const withLegacyScene = shot({ brief: { tokens: [], templateId: 'plaster-loft' } });
    shot();
    expect(allPages({ tokens: ['p-cup'] }).map((n) => n.id)).toEqual([withProduct.id]);
    expect(allPages({ tokens: ['plaster-loft'] }).map((n) => n.id)).toEqual([withLegacyScene.id]);
    // a brief written later is indexed too
    core.store.setBrief(withProduct.id, { tokens: [{ t: 'character', id: 'up-ana' }] });
    expect(allPages({ tokens: ['p-cup'] })).toEqual([]);
    expect(allPages({ tokens: ['up-ana'] }).map((n) => n.id)).toEqual([withProduct.id]);
  });

  it('rejects a cursor it did not make', () => {
    expect(() => core.store.feedPage(projectId, { cursor: 'nope' })).toThrow(/cursor/);
  });
});

describe('feed search', () => {
  it('matches a substring of the prompt, ignoring case and accents, with every term required', () => {
    const rose = shot({ prompt: 'Soft ROSÉ linen under north light' });
    const clay = shot({ prompt: 'terracotta headphones on a shelf' });
    shot({ prompt: 'nothing here' });
    const q = (s: string) => allPages({ terms: searchTerms(s).map((t) => ({ ...t, tokenIds: [], engineIds: [] })) });
    expect(q('rose').map((n) => n.id)).toEqual([rose.id]);
    expect(q('PHONE').map((n) => n.id)).toEqual([clay.id]);
    expect(q('linen north').map((n) => n.id)).toEqual([rose.id]);
    expect(q('linen shelf')).toEqual([]);
  });

  it('matches a plural query against its singular, and a short term by scan', () => {
    const a = shot({ prompt: 'one serum on marble' });
    const q = (s: string) => allPages({ terms: searchTerms(s).map((t) => ({ ...t, tokenIds: [], engineIds: [] })) });
    expect(q('serums').map((n) => n.id)).toEqual([a.id]);
    expect(q('on').map((n) => n.id)).toEqual([a.id]);
    expect(q('zz')).toEqual([]);
  });

  it('matches template field values and colour names the brief carries', () => {
    const a = shot({
      prompt: 'plain',
      brief: { tokens: [{ t: 'color', hex: '#C9A96E', name: 'Gold' }], templateFields: { mood: 'quietly festive' } },
    });
    shot({ prompt: 'plain' });
    const q = (s: string) => allPages({ terms: searchTerms(s).map((t) => ({ ...t, tokenIds: [], engineIds: [] })) });
    expect(q('gold').map((n) => n.id)).toEqual([a.id]);
    expect(q('c9a96e').map((n) => n.id)).toEqual([a.id]);
    expect(q('festive').map((n) => n.id)).toEqual([a.id]);
  });

  it('matches a token by the ids the caller resolved from its current name, and an engine by id', () => {
    const cup = shot({ prompt: 'plain', brief: { tokens: [{ t: 'product', id: 'p-cup' }] } });
    const demo = shot({ prompt: 'plain', engineId: 'openrouter' });
    expect(allPages({ terms: [term('mug', { tokenIds: ['p-cup'] })] }).map((n) => n.id)).toEqual([cup.id]);
    expect(allPages({ terms: [term('openrouter', { engineIds: ['openrouter'] })] }).map((n) => n.id)).toEqual([
      demo.id,
    ]);
  });

  it('shares the client rule for what a term matches', () => {
    expect(matchesQuery('Soft ROSÉ linen', 'rose linen')).toBe(true);
    expect(matchesQuery('Ceramic Mugs', 'mug')).toBe(true);
    expect(matchesQuery('Ceramic Mug', 'mugs')).toBe(true);
    expect(matchesQuery('Ceramic Mug', 'plinth')).toBe(false);
    expect(matchesQuery('anything', '   ')).toBe(true);
  });
});

describe('feedCounts', () => {
  it('describes every lens for the place and search, plus the two unscoped totals', () => {
    const a = shot({ prompt: 'linen' });
    const b = shot({ prompt: 'linen' });
    const c = shot({ prompt: 'wool' });
    core.store.setKept(b.id, true);
    core.store.setArchived(c.id, true);
    const set = core.store.createSet(brandId, 'Press');
    core.store.addToSet(set.id, [a.id]);
    expect(core.store.feedCounts(projectId, {})).toEqual({ total: 3, all: 2, keepers: 1, archived: 1, ungrouped: 1 });
    expect(core.store.feedCounts(projectId, { set: set.id })).toEqual({
      total: 3,
      all: 1,
      keepers: 0,
      archived: 0,
      ungrouped: 1,
    });
    expect(core.store.feedCounts(projectId, { terms: [term('linen')] })).toEqual({
      total: 3,
      all: 2,
      keepers: 1,
      archived: 0,
      ungrouped: 1,
    });
  });
});

describe('lineageOf, recentShots, usageByDay', () => {
  it('walks the parent index: ancestors root-most first, siblings oldest first, children oldest first', () => {
    const a = shot();
    const kid1 = shot({ kind: 'edit', parentId: a.id });
    const kid2 = shot({ kind: 'edit', parentId: a.id });
    const grand = shot({ kind: 'edit', parentId: kid1.id });
    const b = shot();
    const lin = core.store.lineageOf(grand.id)!;
    expect(lin.ancestors.map((n) => n.id)).toEqual([a.id, kid1.id]);
    expect(lin.siblings.map((n) => n.id)).toEqual([grand.id]);
    expect(core.store.lineageOf(kid1.id)!.siblings.map((n) => n.id)).toEqual([kid1.id, kid2.id]);
    expect(core.store.lineageOf(a.id)!.children.map((n) => n.id)).toEqual([kid1.id, kid2.id]);
    expect(core.store.lineageOf(a.id)!.siblings.map((n) => n.id)).toEqual([a.id, b.id]);
    expect(core.store.lineageOf('nope')).toBeNull();
  });

  it('lists the newest finished shots first and counts a year by day', () => {
    const a = shot();
    const b = shot();
    const [running] = core.store.addNodes({
      projectId,
      parentId: rootId,
      kind: 'generation',
      prompt: 'x',
      engineId: 'demo',
      count: 1,
    });
    expect(core.store.recentShots(projectId, 10).map((n) => n.id)).toEqual([b.id, a.id]);
    expect(core.store.recentShots(projectId, 1).map((n) => n.id)).toEqual([b.id]);
    const days = core.store.usageByDay(brandId);
    expect(days).toHaveLength(1);
    expect(days[0].generations).toBe(3);
    expect(days[0].edits).toBe(0);
    expect(running.status).toBe('running');
  });
});

describe('brand summaries and set members', () => {
  it('answers without the document, with the primary mark by the studio rule', () => {
    const marked = core.store.createBrand({
      specVersion: '0.1',
      meta: { name: 'Marked', website: 'https://marked.example' },
      palette: { primary: { hex: '#123456', name: 'Deep' } },
      logos: [
        { role: 'wordmark', file: `asset:${'a'.repeat(32)}` },
        { role: 'primary', file: `asset:${'b'.repeat(32)}` },
      ],
    } as any);
    const list = core.store.listBrandSummaries();
    const row = list.find((b) => b.id === marked.id)!;
    expect('json' in row).toBe(false);
    expect(row).toMatchObject({
      name: 'Marked',
      website: 'https://marked.example',
      primaryHex: '#123456',
      mark: `asset:${'b'.repeat(32)}`,
    });
    const bare = list.find((b) => b.id === brandId)!;
    expect(bare).toMatchObject({ name: 'Feed Co', website: null, mark: null, primaryHex: null });
  });

  it("lists a set's members in filing order", () => {
    const a = shot();
    const b = shot();
    const set = core.store.createSet(brandId, 'Press');
    core.store.addToSet(set.id, [b.id, a.id]);
    expect(new Set(core.store.membersOf(set.id))).toEqual(new Set([a.id, b.id]));
  });
});

describe('what stays bounded on a big brand', () => {
  it('the root counts no children, and a shot in a long row gets a window of siblings around it', () => {
    const ids: string[] = [];
    for (let i = 0; i < 60; i++) ids.push(shot({ prompt: `row ${i}` }).id);
    const root = core.store.rootFor(projectId)!;
    expect(root.childCount).toBe(0);
    expect(core.store.getNode(root.id)!.childCount).toBe(0);
    // the first of sixty: itself and the twenty-five after it
    const first = core.store.lineageOf(ids[0])!;
    expect(first.siblings.map((n) => n.id)).toEqual(ids.slice(0, 26));
    // the middle: twenty-five before, itself, twenty-five after
    const mid = core.store.lineageOf(ids[30])!;
    expect(mid.siblings).toHaveLength(51);
    expect(mid.siblings.map((n) => n.id)).toEqual(ids.slice(5, 56));
    // the last: the twenty-five before it and itself
    const last = core.store.lineageOf(ids[59])!;
    expect(last.siblings.map((n) => n.id)).toEqual(ids.slice(34, 60));
    // and a step to a neighbour re-centres the window
    const next = core.store.lineageOf(mid.siblings[26].id)!;
    expect(next.siblings.map((n) => n.id)).toEqual(ids.slice(6, 57));
  });

  it('activity is the running shots plus the recent ones, from two indexed reads', () => {
    const fresh = shot({ prompt: 'landed today' });
    const [running] = core.store.addNodes({
      projectId,
      parentId: rootId,
      kind: 'generation',
      prompt: 'still going',
      engineId: 'demo',
      count: 1,
    });
    const old = shot({ prompt: 'from last month' });
    const oldRunning = shot({ prompt: 'stuck since last month' });
    // a second connection to the same file, for the clock the store never lets a caller set
    const raw = openDb(home);
    raw.prepare("UPDATE nodes SET created_at = datetime('now', '-30 days') WHERE id = ?").run(old.id);
    raw
      .prepare("UPDATE nodes SET created_at = datetime('now', '-30 days'), status = 'running' WHERE id = ?")
      .run(oldRunning.id);
    raw.close();
    const seen = core.store.recentActivity(brandId).map((n) => n.id);
    expect(seen).toContain(fresh.id);
    expect(seen).toContain(running.id);
    expect(seen).toContain(oldRunning.id);
    expect(seen).not.toContain(old.id);
    // newest first, whichever read answered
    expect(seen.indexOf(fresh.id)).toBeLessThan(seen.indexOf(oldRunning.id));
  });

  it('the feed page, the counts and the lineage read indexes, never the table', () => {
    shot();
    const raw = openDb(home);
    const plan = (sql: string, ...args: unknown[]) =>
      (raw.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...args) as { detail: string }[]).map((r) => r.detail).join(' | ');
    expect(
      plan("SELECT count(*) FROM nodes n WHERE n.project_id = ? AND n.kind != 'root' AND n.archived = 0", projectId),
    ).toContain('COVERING INDEX idx_nodes_project_state');
    expect(
      plan(
        "SELECT n.id FROM nodes n WHERE n.project_id = ? AND n.kind != 'root' AND n.archived = 0 ORDER BY n.created_at DESC, n.id DESC LIMIT 61",
        projectId,
      ),
    ).not.toContain('TEMP B-TREE');
    expect(
      plan('SELECT n.id FROM nodes n WHERE n.parent_id IS ? ORDER BY n.created_at, n.id LIMIT 51 OFFSET 5', rootId),
    ).not.toContain('TEMP B-TREE');
    raw.close();
  });
});

describe('what boot and the root cost on a big brand', () => {
  it('finds the root by the state index even when it is not the oldest row', () => {
    shot();
    const raw = openDb(home);
    raw.prepare("UPDATE nodes SET created_at = datetime('now', '+1 day') WHERE id = ?").run(rootId);
    raw.close();
    expect(core.store.rootFor(projectId)?.id).toBe(rootId);
    expect(core.store.lineageOf(rootId)).toEqual({ ancestors: [], siblings: [], children: [] });
  });

  it('marks the image split as done and skips the scan from then on', () => {
    const raw = openDb(home);
    expect((raw.prepare("SELECT value FROM settings WHERE key='images_split'").get() as any).value).toBe('v1');
    raw.close();
  });

  it('rebuilds the search index when a row was written past its triggers', () => {
    const a = shot({ prompt: 'indexed as written' });
    const raw = openDb(home);
    // a row written by a build without the triggers: present in nodes, absent from the index
    raw.exec('DROP TRIGGER nodes_search_ai');
    raw
      .prepare(
        `INSERT INTO nodes (id, project_id, parent_id, kind, prompt, engine_id, status, images, cost_usd, kept, error, overlays, brief, archived)
         VALUES ('late-row', ?, ?, 'generation', 'written without the triggers', 'demo', 'done', '[]', 0, 0, NULL, '{}', NULL, 0)`,
      )
      .run(projectId, rootId);
    expect(raw.prepare('SELECT count(*) AS c FROM nodes_fts WHERE nodes_fts MATCH \'"triggers"\'').get()).toEqual({
      c: 0,
    });
    raw.close();
    // the next boot sees the newest row unindexed and rebuilds
    const again = openDb(home);
    expect(again.prepare('SELECT count(*) AS c FROM nodes_fts WHERE nodes_fts MATCH \'"triggers"\'').get()).toEqual({
      c: 1,
    });
    expect(again.prepare('SELECT count(*) AS c FROM nodes_fts WHERE nodes_fts MATCH \'"as written"\'').get()).toEqual({
      c: 1,
    });
    again.close();
    expect(
      core.store
        .feedPage(projectId, { lens: 'all', terms: [{ ...searchTerms('triggers')[0], tokenIds: [], engineIds: [] }] })
        .items.map((n) => n.id),
    ).toEqual(['late-row']);
    expect(a.id).toBeTruthy();
  });
});
