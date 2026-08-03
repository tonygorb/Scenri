import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

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
  // Nodes only leave 'running' via the in-process generation promise; after a
  // crash/restart those rows would spin forever in the UI. Sweep them to error.
  db.prepare(
    "UPDATE nodes SET status='error', error='interrupted — server restarted mid-generation' WHERE status='running'",
  ).run();
  return db;
}
