import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { RESERVED_SLUGS, firstFree, slugifyWithId } from './slug.js';

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
        brief TEXT,
        archived INTEGER NOT NULL DEFAULT 0,
        duration_ms INTEGER,
        batch_id TEXT,
        batch_index INTEGER NOT NULL DEFAULT 0
      );
      INSERT INTO nodes_new
        SELECT id, project_id, parent_id, kind, prompt, engine_id, status, images, cost_usd, kept, error,
               created_at, overlays, brief, archived, duration_ms, batch_id, batch_index
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
    // a brand slugged before it lived at the web root may be holding a name the
    // root owns; moving it costs its old links, which the redirect shim cannot
    // help with, but the alternative is a brand that cannot be opened at all
    const slug = firstFree(wanted, (c) => RESERVED_SLUGS.has(c) || takenBrand.has(c));
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

/**
 * One image, one node.
 *
 * A multi-shot request used to land as one node holding N images, and the app
 * grew a second hierarchy on top of it — takes inside a card, versions across
 * cards. Since schema v2 every image is its own first-class node, and this
 * step rewrites the old shape into the new one: the original row keeps its id
 * and its first image (links, notifications and children survive), and each
 * further image becomes a minted sibling with the same recipe.
 *
 * The pieces that were secretly per-image move with their image: the
 * overlays entry keyed by that index becomes the sibling's "0", the
 * rendered.sizes entry becomes its one-element array, and any child that
 * recorded `brief.sourceImage` as that image is re-pointed at the sibling
 * that now holds it. Kept and archived were statements about the whole run,
 * so every sibling inherits them. Cost and duration were measured for the
 * run once and stay on the original — inventing a per-image split of either
 * would be fiction.
 *
 * Sibling stamps run BACKWARD from the original's (slot i sits i ms earlier):
 * the feed is newest-first, so this is what makes slot 0 read top-left and
 * the batch read in request order. Idempotent by shape — after one pass no
 * node holds more than one image, so a second pass finds nothing to do.
 */
function splitMultiImageNodes(db: DB): void {
  const rows = db.prepare('SELECT * FROM nodes').all() as {
    id: string;
    project_id: string;
    parent_id: string | null;
    kind: string;
    prompt: string;
    engine_id: string;
    status: string;
    images: string;
    cost_usd: number;
    kept: number;
    error: string | null;
    created_at: string;
    overlays: string;
    brief: string | null;
    archived: number;
    duration_ms: number | null;
  }[];
  const multi = rows.filter((r) => {
    try {
      return (JSON.parse(r.images) as unknown[]).length > 1;
    } catch {
      return false;
    }
  });
  if (!multi.length) return;

  const parse = (s: string | null): any => {
    if (!s) return null;
    try {
      return JSON.parse(s);
    } catch {
      return null;
    }
  };
  /** Same text shape addNode writes, so it compares against every other row. */
  const stampOf = (iso: string, minusMs: number): string => {
    const t = new Date(`${iso.replace(' ', 'T')}Z`).getTime() - minusMs;
    const d = new Date(t);
    const p = (n: number, w = 2) => String(n).padStart(w, '0');
    return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}.${p(d.getUTCMilliseconds(), 3)}`;
  };

  const updateOriginal = db.prepare(
    'UPDATE nodes SET images=?, overlays=?, brief=?, batch_id=?, batch_index=0 WHERE id=?',
  );
  const insertSibling = db.prepare(
    `INSERT INTO nodes (id, project_id, parent_id, kind, prompt, engine_id, status, images, cost_usd, kept,
       error, created_at, overlays, brief, archived, duration_ms, batch_id, batch_index)
     VALUES (?,?,?,?,?,?,?,?,0,?,?,?,?,?,?,NULL,?,?)`,
  );
  const childrenOf = db.prepare('SELECT id, brief FROM nodes WHERE parent_id=?');
  const repoint = db.prepare('UPDATE nodes SET parent_id=? WHERE id=?');
  const setsOf = db.prepare('SELECT set_id FROM set_nodes WHERE node_id=?');
  const addMember = db.prepare('INSERT OR IGNORE INTO set_nodes (set_id, node_id) VALUES (?,?)');

  db.transaction(() => {
    for (const r of multi) {
      const images = JSON.parse(r.images) as string[];
      const overlays = parse(r.overlays) ?? {};
      const brief = parse(r.brief);
      const sizes: unknown[] | null = Array.isArray(brief?.rendered?.sizes) ? brief.rendered.sizes : null;
      const briefFor = (i: number): string | null => {
        if (!brief) return null;
        const b = { ...brief, variants: images.length };
        if (brief.rendered) {
          // per-image size travels with its image; the batch bookkeeping
          // (requested / variantIndexes) described the run and dies with it
          const { requested: _req, variantIndexes: _vi, ...rendered } = brief.rendered;
          b.rendered = { ...rendered, ...(sizes ? { sizes: sizes[i] !== undefined ? [sizes[i]] : [] } : {}) };
        }
        return JSON.stringify(b);
      };
      const siblingIds: string[] = [r.id];

      updateOriginal.run(
        JSON.stringify([images[0]]),
        JSON.stringify(overlays['0'] !== undefined ? { '0': overlays['0'] } : {}),
        briefFor(0),
        r.id,
        r.id,
      );

      for (let i = 1; i < images.length; i++) {
        const id = randomUUID();
        siblingIds.push(id);
        insertSibling.run(
          id,
          r.project_id,
          r.parent_id,
          r.kind,
          r.prompt,
          r.engine_id,
          r.status,
          JSON.stringify([images[i]]),
          r.kept,
          r.error,
          stampOf(r.created_at, i),
          JSON.stringify(overlays[String(i)] !== undefined ? { '0': overlays[String(i)] } : {}),
          briefFor(i),
          r.archived,
          r.id,
          i,
        );
      }

      // a child that recorded which image it refined belongs to the sibling
      // now holding that image; one that never said stays on the original
      for (const child of childrenOf.all(r.id) as { id: string; brief: string | null }[]) {
        const src = parse(child.brief)?.sourceImage;
        if (typeof src !== 'string') continue;
        const at = images.indexOf(src);
        if (at > 0) repoint.run(siblingIds[at], child.id);
      }

      // membership is a label on the shot; every shot of the run was in the set
      for (const s of setsOf.all(r.id) as { set_id: string }[]) {
        for (let i = 1; i < siblingIds.length; i++) addMember.run(s.set_id, siblingIds[i]);
      }
    }
  })();
}

/**
 * The migration steps below stay "idempotent by shape" — each detects for
 * itself whether it has run. The version stamp exists for the two things shape
 * cannot express: refusing a database written by a NEWER build (its rows may
 * mean things this build has never heard of), and knowing when to take a
 * backup before this build changes anything.
 */
export const SCHEMA_VERSION = 2;

export class SchemaTooNewError extends Error {
  constructor(found: number, supported: number, backupsDir?: string) {
    super(
      `This library was written by a newer Scenri (schema ${found}; this build understands ${supported}). ` +
        'Update and retry: npx scenri@latest' +
        (backupsDir ? ` (a pre-migration snapshot of the library is kept in ${backupsDir})` : ''),
    );
    this.name = 'SchemaTooNewError';
  }
}

function backupBeforeMigration(db: DB, homeDir: string, fromVersion: number): void {
  const dir = join(homeDir, 'backups');
  mkdirSync(dir, { recursive: true });
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  // Checkpoint first so the snapshot carries everything still sitting in the
  // WAL; VACUUM INTO is a single consistent, compacted copy.
  db.pragma('wal_checkpoint(TRUNCATE)');
  db.prepare('VACUUM INTO ?').run(join(dir, `scenri-v${fromVersion}-${stamp}.db`));
  const old = readdirSync(dir)
    .filter((f) => /^scenri-v\d+-\d{8}-\d{6}\.db$/.test(f))
    .sort((a, b) => a.slice(-18).localeCompare(b.slice(-18)));
  for (const f of old.slice(0, Math.max(0, old.length - 3))) rmSync(join(dir, f));
}

export function openDb(homeDir: string): DB {
  // 0o700 on creation: the database holds provider keys, so another local user
  // has no business listing this directory. An existing home keeps whatever
  // mode its owner gave it. POSIX only: Windows ignores mkdir modes, and the
  // directory inherits the user profile's ACLs instead, which amounts to the
  // same owner-only default.
  mkdirSync(homeDir, { recursive: true, mode: 0o700 });
  const dbPath = join(homeDir, 'scenri.db');
  // Captured before Database() — opening creates the file, and a fresh db also
  // reads user_version 0 but must not trigger a backup.
  const preExisting = existsSync(dbPath);
  const db = new Database(dbPath);
  // Owner-only, every open: keys live in here. Before the WAL pragma below, so
  // the -wal and -shm files inherit the tightened mode when SQLite creates
  // them. POSIX only: on Windows chmod merely toggles read-only, and the
  // profile ACLs carry the protection.
  try {
    chmodSync(dbPath, 0o600);
  } catch {
    /* a read-only or exotic filesystem must not stop the app from opening */
  }
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  const found = db.pragma('user_version', { simple: true }) as number;
  if (found > SCHEMA_VERSION) {
    db.close();
    throw new SchemaTooNewError(found, SCHEMA_VERSION, join(homeDir, 'backups'));
  }
  if (preExisting && found < SCHEMA_VERSION) backupBeforeMigration(db, homeDir, found);
  db.exec(MIGRATIONS);
  // Guarded column migration (sqlite has no ADD COLUMN IF NOT EXISTS).
  const nodeCols = (db.pragma('table_info(nodes)') as { name: string }[]).map((c) => c.name);
  if (!nodeCols.includes('overlays')) {
    db.exec("ALTER TABLE nodes ADD COLUMN overlays TEXT NOT NULL DEFAULT '{}'");
  }
  if (!nodeCols.includes('brief')) {
    db.exec('ALTER TABLE nodes ADD COLUMN brief TEXT');
  }
  if (!nodeCols.includes('archived')) {
    db.exec('ALTER TABLE nodes ADD COLUMN archived INTEGER NOT NULL DEFAULT 0');
  }
  if (!nodeCols.includes('duration_ms')) {
    // How long the engine actually took, written at completion. Everything the
    // app could previously say about time was derived from created_at while a
    // node was still running; a finished shot could never say how long it took,
    // and there was no history from which to state what to expect.
    db.exec('ALTER TABLE nodes ADD COLUMN duration_ms INTEGER');
  }
  // Batch provenance: which multi-shot request produced this node and which
  // slot it filled. Internal metadata only — the user's content object is the
  // image, never the batch — but it is what keeps siblings reading in request
  // order and lets a retry know what it is retrying.
  if (!nodeCols.includes('batch_id')) {
    db.exec('ALTER TABLE nodes ADD COLUMN batch_id TEXT');
  }
  if (!nodeCols.includes('batch_index')) {
    db.exec('ALTER TABLE nodes ADD COLUMN batch_index INTEGER NOT NULL DEFAULT 0');
  }
  const projectCols = (db.pragma('table_info(projects)') as { name: string }[]).map((c) => c.name);
  if (!projectCols.includes('slug')) {
    db.exec('ALTER TABLE projects ADD COLUMN slug TEXT');
  }
  // Fields this app invents on top of an imported product. A store supplies a
  // title and a price; nothing supplies the finish or the real-world size, and
  // those two are what keep a generated product at true scale. They live here
  // rather than in `raw` because an import must never overwrite them.
  const catalogCols = (db.pragma('table_info(catalog_products)') as { name: string }[]).map((c) => c.name);
  for (const col of ['variant', 'material', 'dimensions']) {
    if (!catalogCols.includes(col)) db.exec(`ALTER TABLE catalog_products ADD COLUMN ${col} TEXT`);
  }
  // An imported product can be topped up with angles the store never had, and
  // an angle names which side of the object a reference shows. Without it a
  // store product could never use the same reference checklist a manual one does.
  const catalogImgCols = (db.pragma('table_info(catalog_images)') as { name: string }[]).map((c) => c.name);
  if (!catalogImgCols.includes('angle')) db.exec('ALTER TABLE catalog_images ADD COLUMN angle TEXT');
  // A store image the user has taken out of the reference set. Not a delete:
  // the next import would fetch it straight back, so the only honest way to
  // drop one is to remember that it was dropped.
  if (!catalogImgCols.includes('excluded')) {
    db.exec('ALTER TABLE catalog_images ADD COLUMN excluded INTEGER NOT NULL DEFAULT 0');
  }
  widenNodeStatusCheck(db);
  backfillSlugs(db);
  // after the backfill, so a set can inherit the slug its project already has
  collapseProjects(db);
  // after collapseProjects, so minted siblings land in the surviving workspace
  splitMultiImageNodes(db);
  // Nodes only leave 'running' via the in-process generation promise; after a
  // crash/restart those rows would spin forever in the UI. Sweep them to error.
  db.prepare(
    "UPDATE nodes SET status='error', error='interrupted: server restarted mid-generation' WHERE status='running'",
  ).run();
  db.pragma(`user_version = ${SCHEMA_VERSION}`);
  return db;
}
