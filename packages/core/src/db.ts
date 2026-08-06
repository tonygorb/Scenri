import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { firstFree, slugifyWithId } from './slug.js';

export type DB = Database.Database;

const MIGRATIONS = `
CREATE TABLE IF NOT EXISTS brands (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL,
  json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  brand_id TEXT NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  slug TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS nodes (
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
CREATE INDEX IF NOT EXISTS idx_nodes_project ON nodes(project_id);
CREATE TABLE IF NOT EXISTS sets (
  id TEXT PRIMARY KEY,
  brand_id TEXT NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sets_slug ON sets(brand_id, slug);
CREATE TABLE IF NOT EXISTS set_nodes (
  set_id TEXT NOT NULL REFERENCES sets(id) ON DELETE CASCADE,
  node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  added_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (set_id, node_id)
);
CREATE INDEX IF NOT EXISTS idx_set_nodes_node ON set_nodes(node_id);
CREATE TABLE IF NOT EXISTS cost_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  engine_id TEXT NOT NULL,
  node_id TEXT,
  cost_usd REAL NOT NULL,
  ts TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS spend_caps (
  engine_id TEXT PRIMARY KEY,
  monthly_cap_usd REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS catalog_sources (
  id TEXT PRIMARY KEY,
  brand_id TEXT NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  platform TEXT NOT NULL DEFAULT 'unknown',
  status TEXT NOT NULL DEFAULT 'idle',
  last_import_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(brand_id, url)
);
CREATE TABLE IF NOT EXISTS catalog_products (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES catalog_sources(id) ON DELETE CASCADE,
  brand_id TEXT NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  external_key TEXT NOT NULL,
  title TEXT NOT NULL,
  description_html TEXT,
  url TEXT NOT NULL,
  handle TEXT,
  vendor TEXT,
  product_type TEXT,
  tags TEXT NOT NULL DEFAULT '[]',
  category TEXT,
  price REAL,
  compare_at_price REAL,
  currency TEXT,
  available INTEGER,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','unavailable')),
  raw TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(source_id, external_key)
);
CREATE INDEX IF NOT EXISTS idx_catalog_products_brand ON catalog_products(brand_id);
CREATE TABLE IF NOT EXISTS catalog_variants (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES catalog_products(id) ON DELETE CASCADE,
  external_key TEXT NOT NULL,
  title TEXT,
  sku TEXT,
  price REAL,
  compare_at_price REAL,
  currency TEXT,
  available INTEGER,
  options TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS catalog_images (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES catalog_products(id) ON DELETE CASCADE,
  source_url TEXT NOT NULL,
  asset_ref TEXT,
  width INTEGER,
  height INTEGER,
  position INTEGER NOT NULL DEFAULT 0,
  alt TEXT
);
CREATE INDEX IF NOT EXISTS idx_catalog_images_product ON catalog_images(product_id);
CREATE TABLE IF NOT EXISTS catalog_collections (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES catalog_sources(id) ON DELETE CASCADE,
  external_key TEXT NOT NULL,
  title TEXT NOT NULL,
  url TEXT,
  UNIQUE(source_id, external_key)
);
CREATE TABLE IF NOT EXISTS catalog_collection_products (
  collection_id TEXT NOT NULL REFERENCES catalog_collections(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES catalog_products(id) ON DELETE CASCADE,
  PRIMARY KEY (collection_id, product_id)
);
CREATE TABLE IF NOT EXISTS import_jobs (
  id TEXT PRIMARY KEY,
  brand_id TEXT NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  source_id TEXT REFERENCES catalog_sources(id) ON DELETE SET NULL,
  url TEXT NOT NULL,
  platform TEXT NOT NULL DEFAULT 'unknown',
  stage TEXT NOT NULL DEFAULT 'queued',
  discovered INTEGER NOT NULL DEFAULT 0,
  fetched INTEGER NOT NULL DEFAULT 0,
  upserted INTEGER NOT NULL DEFAULT 0,
  images_done INTEGER NOT NULL DEFAULT 0,
  images_total INTEGER NOT NULL DEFAULT 0,
  errors TEXT NOT NULL DEFAULT '[]',
  warnings TEXT NOT NULL DEFAULT '[]',
  message TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_import_jobs_brand ON import_jobs(brand_id);
`;

/**
 * Sqlite has no ALTER TABLE for a CHECK constraint, so a rebuild is the only
 * way to let 'cancelled' sit alongside the original three statuses. Guarded by
 * reading the table back from sqlite_master rather than a version flag, so a
 * database already rebuilt (or created fresh, past this point) does nothing.
 *
 * foreign_keys must be off for the swap: sqlite enforces FKs against DDL too,
 * and set_nodes.node_id still points at the table being dropped mid-rebuild.
 * That pragma cannot change inside a transaction, so it brackets one instead
 * of living inside it.
 */
function widenNodeStatusCheck(db: DB): void {
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='nodes'").get() as
    | { sql: string }
    | undefined;
  if (!row || row.sql.includes("'cancelled'")) return;

  db.pragma('foreign_keys = OFF');
  db.transaction(() => {
    db.exec(`
      CREATE TABLE nodes_new (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        parent_id TEXT REFERENCES nodes_new(id),
        kind TEXT NOT NULL CHECK (kind IN ('root','generation','edit')),
        prompt TEXT NOT NULL DEFAULT '',
        engine_id TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running','done','error','cancelled')),
        images TEXT NOT NULL DEFAULT '[]',
        cost_usd REAL NOT NULL DEFAULT 0,
        kept INTEGER NOT NULL DEFAULT 0,
        error TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        overlays TEXT NOT NULL DEFAULT '{}',
        brief TEXT
      );
      INSERT INTO nodes_new
        SELECT id, project_id, parent_id, kind, prompt, engine_id, status, images, cost_usd, kept, error,
               created_at, overlays, brief
        FROM nodes;
      DROP TABLE nodes;
      ALTER TABLE nodes_new RENAME TO nodes;
      CREATE INDEX IF NOT EXISTS idx_nodes_project ON nodes(project_id);
    `);
  })();
  db.pragma('foreign_keys = ON');
}

/** A slug column may only ever hold what `slugify` can produce: ASCII letters,
 * digits and hyphens. Anything else — a bare non-Latin name stored verbatim
 * by an older build, or the old ASCII-only filter's ambiguous "brand" — needs
 * re-deriving. */
const SLUG_CHARS = /^[a-z0-9-]+$/;

/**
 * Slugs are the address bar now, so every row needs one and no two rows in the
 * same scope may share it — otherwise a link opens the wrong project.
 *
 * Four things this repairs, all in databases written before that was true, or
 * before a later pass changed what "true" meant:
 *   - brands whose name had no Latin content under the *original* ASCII-only
 *     filter, which flattened every such name to the same "brand"
 *   - a later pass that went the other way and stored non-Latin script
 *     straight into the slug column, since reverted — those rows get
 *     re-derived back to ASCII here on the next server start, no separate
 *     one-off script needed
 *   - brands that ended up sharing a slug anyway
 *   - projects, which had no slug at all
 * Runs after MIGRATIONS rather than inside it, because a unique index cannot
 * be created while a duplicate is still standing.
 */
function backfillSlugs(db: DB): void {
  const brands = db.prepare('SELECT id, slug, json FROM brands ORDER BY created_at, id').all() as {
    id: string;
    slug: string;
    json: string;
  }[];
  const setBrand = db.prepare('UPDATE brands SET slug=? WHERE id=?');
  const takenBrand = new Set<string>();
  for (const b of brands) {
    const needsRederiving = /^brand(-\d+)?$/.test(b.slug) || !SLUG_CHARS.test(b.slug);
    let name: string | undefined;
    if (needsRederiving) {
      try {
        name = JSON.parse(b.json)?.meta?.name;
      } catch {
        /* a brand we cannot parse still needs a slug */
      }
    }
    const wanted = needsRederiving && name ? slugifyWithId(name, b.id) : b.slug;
    const slug = firstFree(wanted, (c) => takenBrand.has(c));
    takenBrand.add(slug);
    if (slug !== b.slug) setBrand.run(slug, b.id);
  }
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_brands_slug ON brands(slug)');

  const projects = db.prepare('SELECT id, brand_id, name, slug FROM projects ORDER BY created_at, id').all() as {
    id: string;
    brand_id: string;
    name: string;
    slug: string | null;
  }[];
  const setProject = db.prepare('UPDATE projects SET slug=? WHERE id=?');
  const takenProject = new Map<string, Set<string>>();
  for (const p of projects) {
    const inBrand = takenProject.get(p.brand_id) ?? new Set<string>();
    takenProject.set(p.brand_id, inBrand);
    const current = p.slug && SLUG_CHARS.test(p.slug) ? p.slug : null;
    const slug = firstFree(current || slugifyWithId(p.name, p.id, 'project'), (c) => inBrand.has(c));
    inBrand.add(slug);
    if (slug !== p.slug) setProject.run(slug, p.id);
  }
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_slug ON projects(brand_id, slug)');
}

/**
 * One workspace per brand, and every project that held work becomes a set.
 *
 * A project was the root of a node tree, so a fresh generation needed one and
 * five separate buttons quietly made one — "Project 3", "Untitled", one per
 * send from the home dock. Nobody asked for them and nothing could rename or
 * delete them. Meanwhile the feed people actually looked at already spanned
 * every project, which is the tell: the container was never the place, only a
 * grouping wearing a place's clothes.
 *
 * So it becomes one. Each brand keeps exactly one project as the hidden
 * workspace every node hangs from, and each surplus project that held shots
 * turns into a set of the same name and slug. Empty ones are dropped, because
 * they are precisely the litter this is meant to stop producing.
 *
 * Idempotent by shape rather than by a version flag: a brand already down to
 * one project has nothing to collapse, so a second run does nothing.
 */
function collapseProjects(db: DB): void {
  const brands = db.prepare('SELECT id FROM brands').all() as { id: string }[];
  const listProjects = db.prepare('SELECT id, name, slug FROM projects WHERE brand_id=? ORDER BY created_at, id');
  const shotsIn = db.prepare("SELECT id FROM nodes WHERE project_id=? AND kind!='root' ORDER BY created_at, id");
  const takenSlug = db.prepare('SELECT slug FROM sets WHERE brand_id=?');
  const addSet = db.prepare('INSERT INTO sets (id, brand_id, name, slug) VALUES (?,?,?,?)');
  const addMember = db.prepare('INSERT OR IGNORE INTO set_nodes (set_id, node_id) VALUES (?,?)');

  for (const brand of brands) {
    const projects = listProjects.all(brand.id) as { id: string; name: string; slug: string }[];
    if (projects.length <= 1) continue;
    const workspace = projects[0];

    db.transaction(() => {
      // mint the sets first: after the reparent below, nothing remembers which
      // project a shot came from
      const taken = new Set((takenSlug.all(brand.id) as { slug: string }[]).map((r) => r.slug));
      for (const p of projects) {
        const shots = shotsIn.all(p.id) as { id: string }[];
        if (shots.length === 0) continue;
        const setId = randomUUID();
        const current = p.slug && SLUG_CHARS.test(p.slug) ? p.slug : null;
        const slug = firstFree(current || slugifyWithId(p.name, setId, 'set'), (c) => taken.has(c));
        taken.add(slug);
        addSet.run(setId, brand.id, p.name, slug);
        for (const s of shots) addMember.run(setId, s.id);
      }

      // reparent before deleting: nodes.project_id cascades, so dropping the
      // projects first would take the shots with them
      db.prepare(
        'UPDATE nodes SET project_id=? WHERE project_id IN (SELECT id FROM projects WHERE brand_id=? AND id!=?)',
      ).run(workspace.id, brand.id, workspace.id);

      // every old project brought its own root. Keep the oldest, and orphan the
      // children of the rest first — parent_id has no ON DELETE clause
      const roots = db
        .prepare("SELECT id FROM nodes WHERE project_id=? AND kind='root' ORDER BY created_at, id")
        .all(workspace.id) as { id: string }[];
      const surplus = roots.slice(1).map((r) => r.id);
      if (surplus.length > 0) {
        const holes = surplus.map(() => '?').join(',');
        db.prepare(`UPDATE nodes SET parent_id=NULL WHERE parent_id IN (${holes})`).run(...surplus);
        db.prepare(`DELETE FROM nodes WHERE id IN (${holes})`).run(...surplus);
      }

      db.prepare('DELETE FROM projects WHERE brand_id=? AND id!=?').run(brand.id, workspace.id);
    })();
  }
}

export function openDb(homeDir: string): DB {
  mkdirSync(homeDir, { recursive: true });
  const db = new Database(join(homeDir, 'scenri.db'));
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(MIGRATIONS);
  // Guarded column migration (sqlite has no ADD COLUMN IF NOT EXISTS).
  const nodeCols = (db.pragma('table_info(nodes)') as { name: string }[]).map((c) => c.name);
  if (!nodeCols.includes('overlays')) {
    db.exec("ALTER TABLE nodes ADD COLUMN overlays TEXT NOT NULL DEFAULT '{}'");
  }
  if (!nodeCols.includes('brief')) {
    db.exec('ALTER TABLE nodes ADD COLUMN brief TEXT');
  }
  const projectCols = (db.pragma('table_info(projects)') as { name: string }[]).map((c) => c.name);
  if (!projectCols.includes('slug')) {
    db.exec('ALTER TABLE projects ADD COLUMN slug TEXT');
  }
  widenNodeStatusCheck(db);
  backfillSlugs(db);
  // after the backfill, so a set can inherit the slug its project already has
  collapseProjects(db);
  // Nodes only leave 'running' via the in-process generation promise; after a
  // crash/restart those rows would spin forever in the UI. Sweep them to error.
  db.prepare(
    "UPDATE nodes SET status='error', error='interrupted — server restarted mid-generation' WHERE status='running'",
  ).run();
  return db;
}
