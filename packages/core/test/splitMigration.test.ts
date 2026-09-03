import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../src/db.js';
import { createStore } from '../src/store.js';

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'sc-split-'));
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

const H = (c: string) => c.repeat(32);

/**
 * A legacy library shaped the old way: one generation node holding three
 * images, with everything that was secretly per-image hanging off indexes —
 * an overlays entry under "2", a rendered.sizes triple, and a child refined
 * from the second image via brief.sourceImage. Written with raw SQL because
 * no current code path can produce this shape any more.
 */
function writeLegacyFixture(db: ReturnType<typeof openDb>) {
  db.prepare("INSERT INTO brands (id, slug, json) VALUES ('b1','acme','{}')").run();
  db.prepare("INSERT INTO projects (id, brand_id, name, slug) VALUES ('p1','b1','Workspace','workspace')").run();
  db.prepare(
    "INSERT INTO nodes (id, project_id, kind, created_at) VALUES ('root1','p1','root','2026-01-01 10:00:00.000')",
  ).run();
  const brief = {
    tokens: [
      { t: 'product', id: 'aurelia' },
      { t: 'text', v: 'on wet rocks' },
    ],
    variants: 3,
    rendered: {
      sizes: [
        [1024, 1024],
        [1000, 1000],
        [990, 990],
      ],
      requested: 3,
      variantIndexes: [0, 1, 2],
      requestedSize: [1024, 1024],
    },
  };
  db.prepare(
    `INSERT INTO nodes (id, project_id, parent_id, kind, prompt, engine_id, status, images, cost_usd, kept,
       created_at, overlays, brief, archived, duration_ms)
     VALUES ('run1','p1','root1','generation','a product on wet rocks','demo','done',?,0.12,1,
       '2026-01-02 10:00:00.500',?,?,0,74250)`,
  ).run(JSON.stringify([H('a'), H('b'), H('c')]), JSON.stringify({ '2': [{ text: 'hello' }] }), JSON.stringify(brief));
  // a refinement made from the SECOND image of the run
  db.prepare(
    `INSERT INTO nodes (id, project_id, parent_id, kind, prompt, engine_id, status, images, created_at, brief)
     VALUES ('edit1','p1','run1','edit','warmer light','demo','done',?, '2026-01-02 11:00:00.000', ?)`,
  ).run(JSON.stringify([H('d')]), JSON.stringify({ tokens: [{ t: 'text', v: 'warmer light' }], sourceImage: H('b') }));
  db.prepare("INSERT INTO sets (id, brand_id, name, slug) VALUES ('s1','b1','Spring','spring')").run();
  db.prepare("INSERT INTO set_nodes (set_id, node_id) VALUES ('s1','run1')").run();
  // a library written before the split ran has no marker for it; the boot
  // that opened this file to seed it wrote one, so the seed takes it back
  db.prepare("DELETE FROM settings WHERE key = 'images_split'").run();
}

describe('splitMultiImageNodes', () => {
  it('splits a legacy three-image run into three first-class siblings, nothing lost', () => {
    const first = openDb(home);
    writeLegacyFixture(first);
    first.pragma('user_version = 1'); // a library written before the split existed
    first.close();

    const db = openDb(home);
    const store = createStore(db);
    const nodes = store.treeFor('p1');
    // root + 3 siblings + 1 edit
    expect(nodes).toHaveLength(5);

    const gens = nodes.filter((n) => n.kind === 'generation');
    expect(gens).toHaveLength(3);
    for (const g of gens) expect(g.images).toHaveLength(1);

    // the original id survives and holds the first image; slots read 0..2
    const byIndex = [...gens].sort((a, b) => a.batchIndex - b.batchIndex);
    expect(byIndex.map((g) => g.images[0])).toEqual([H('a'), H('b'), H('c')]);
    expect(byIndex[0].id).toBe('run1');
    for (const g of gens) expect(g.batchId).toBe('run1');

    // newest-first order = request order: slot 0 carries the newest stamp
    expect(byIndex[0].createdAt > byIndex[1].createdAt).toBe(true);
    expect(byIndex[1].createdAt > byIndex[2].createdAt).toBe(true);

    // per-image records travelled with their image
    expect(byIndex[2].overlays).toEqual({ '0': [{ text: 'hello' }] });
    expect(byIndex[0].overlays).toEqual({});
    expect((byIndex[0].brief as any).rendered.sizes).toEqual([[1024, 1024]]);
    expect((byIndex[1].brief as any).rendered.sizes).toEqual([[1000, 1000]]);
    expect((byIndex[2].brief as any).rendered.sizes).toEqual([[990, 990]]);
    expect((byIndex[1].brief as any).rendered.requested).toBeUndefined();
    expect((byIndex[1].brief as any).rendered.requestedSize).toEqual([1024, 1024]);
    expect((byIndex[1].brief as any).variants).toBe(3);

    // the whole run was kept, so every shot of it is kept
    for (const g of gens) expect(g.kept).toBe(true);
    // cost and duration were measured once, for the run
    expect(byIndex[0].costUsd).toBeCloseTo(0.12);
    expect(byIndex[0].durationMs).toBe(74250);
    expect(byIndex[1].costUsd).toBe(0);
    expect(byIndex[1].durationMs).toBeNull();

    // the refinement of image two follows its image
    const edit = nodes.find((n) => n.id === 'edit1')!;
    expect(edit.parentId).toBe(byIndex[1].id);
    expect(edit.parentId).not.toBe('run1');

    // membership is a label on the shot: all three are in the set
    const members = db.prepare("SELECT node_id FROM set_nodes WHERE set_id='s1'").all() as { node_id: string }[];
    expect(members.map((m) => m.node_id).sort()).toEqual(gens.map((g) => g.id).sort());

    // idempotent by shape: nothing multi-image remains, a reopen changes nothing
    db.close();
    const again = openDb(home);
    expect(createStore(again).treeFor('p1')).toHaveLength(5);
    again.close();
  });

  it('carries the batch columns through the status-check rebuild of a very old library', () => {
    // Hand-build a pre-'cancelled' nodes table: openDb must first ADD the batch
    // columns and then rebuild the table for the widened CHECK — if the
    // rebuild's hard-coded column lists ever miss the new columns, this loses
    // them and the assert below fails.
    const raw = new Database(join(home, 'scenri.db'));
    raw.exec(`
      CREATE TABLE brands (id TEXT PRIMARY KEY, slug TEXT NOT NULL, json TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')));
      CREATE TABLE projects (id TEXT PRIMARY KEY, brand_id TEXT NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
        name TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')));
      CREATE TABLE nodes (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        parent_id TEXT REFERENCES nodes(id),
        kind TEXT NOT NULL CHECK (kind IN ('root','generation','edit')),
        prompt TEXT NOT NULL DEFAULT '',
        engine_id TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running','done','error')),
        images TEXT NOT NULL DEFAULT '[]',
        cost_usd REAL NOT NULL DEFAULT 0,
        kept INTEGER NOT NULL DEFAULT 0,
        error TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO brands (id, slug, json) VALUES ('b1','acme','{}');
      INSERT INTO projects (id, brand_id, name) VALUES ('p1','b1','Workspace');
      INSERT INTO nodes (id, project_id, kind) VALUES ('root1','p1','root');
      INSERT INTO nodes (id, project_id, parent_id, kind, status, images)
        VALUES ('n1','p1','root1','generation','done','${JSON.stringify([H('a'), H('b')])}');
    `);
    raw.close();

    const db = openDb(home);
    const cols = (db.pragma('table_info(nodes)') as { name: string }[]).map((c) => c.name);
    expect(cols).toContain('batch_id');
    expect(cols).toContain('batch_index');
    const sql = (db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='nodes'").get() as any).sql;
    expect(sql).toContain("'cancelled'");
    // and the two-image node was split on the same open
    const gens = createStore(db)
      .treeFor('p1')
      .filter((n) => n.kind === 'generation');
    expect(gens).toHaveLength(2);
    for (const g of gens) expect(g.images).toHaveLength(1);
    expect(gens.every((g) => g.batchId === 'n1')).toBe(true);
    db.close();
  });
});
