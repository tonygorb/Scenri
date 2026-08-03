import { randomUUID } from 'node:crypto';
import type { DB } from './db.js';

export interface BrandRow {
  id: string;
  slug: string;
  json: unknown;
  createdAt: string;
  updatedAt: string;
}
export interface ProjectRow {
  id: string;
  brandId: string;
  name: string;
  createdAt: string;
}
export type NodeKind = 'root' | 'generation' | 'edit';
export type NodeStatus = 'running' | 'done' | 'error';
export interface TreeNode {
  id: string;
  projectId: string;
  parentId: string | null;
  kind: NodeKind;
  prompt: string;
  engineId: string;
  status: NodeStatus;
  images: string[];
  costUsd: number;
  kept: boolean;
  error: string | null;
  createdAt: string;
  /** Text-overlay layers keyed by image index (editor data, opaque to core). */
  overlays: Record<string, unknown[]>;
  /** Structured brief this shot came from; null for legacy nodes. */
  brief: unknown | null;
}

const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'brand';

function rowToNode(r: any): TreeNode {
  return {
    id: r.id,
    projectId: r.project_id,
    parentId: r.parent_id,
    kind: r.kind,
    prompt: r.prompt,
    engineId: r.engine_id,
    status: r.status,
    images: JSON.parse(r.images),
    costUsd: r.cost_usd,
    kept: !!r.kept,
    error: r.error,
    createdAt: r.created_at,
    overlays: JSON.parse(r.overlays ?? '{}'),
    brief: r.brief ? JSON.parse(r.brief) : null,
  };
}

export function createStore(db: DB) {
  return {
    // brands
    createBrand(json: { meta: { name: string } } & Record<string, unknown>): BrandRow {
      const id = randomUUID();
      db.prepare('INSERT INTO brands (id, slug, json) VALUES (?,?,?)').run(
        id,
        slugify(json.meta.name),
        JSON.stringify(json),
      );
      return this.getBrand(id)!;
    },
    getBrand(id: string): BrandRow | null {
      const r = db.prepare('SELECT * FROM brands WHERE id=?').get(id) as any;
      return r
        ? { id: r.id, slug: r.slug, json: JSON.parse(r.json), createdAt: r.created_at, updatedAt: r.updated_at }
        : null;
    },
    listBrands(): BrandRow[] {
      return (db.prepare('SELECT * FROM brands ORDER BY created_at').all() as any[]).map((r) => ({
        id: r.id,
        slug: r.slug,
        json: JSON.parse(r.json),
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      }));
    },
    updateBrand(id: string, json: { meta: { name: string } } & Record<string, unknown>): BrandRow | null {
      db.prepare("UPDATE brands SET json=?, slug=?, updated_at=datetime('now') WHERE id=?").run(
        JSON.stringify(json),
        slugify(json.meta.name),
        id,
      );
      return this.getBrand(id);
    },
    deleteBrand(id: string): void {
      db.prepare('DELETE FROM brands WHERE id=?').run(id);
    },

    // projects
    createProject(brandId: string, name: string): { project: ProjectRow; root: TreeNode } {
      const id = randomUUID();
      db.prepare('INSERT INTO projects (id, brand_id, name) VALUES (?,?,?)').run(id, brandId, name);
      const rootId = randomUUID();
      db.prepare("INSERT INTO nodes (id, project_id, parent_id, kind, status) VALUES (?,?,NULL,'root','done')").run(
        rootId,
        id,
      );
      return { project: this.getProject(id)!, root: this.getNode(rootId)! };
    },
    deleteProject(id: string): void {
      db.prepare('DELETE FROM projects WHERE id=?').run(id);
    },
    getProject(id: string): ProjectRow | null {
      const r = db.prepare('SELECT * FROM projects WHERE id=?').get(id) as any;
      return r ? { id: r.id, brandId: r.brand_id, name: r.name, createdAt: r.created_at } : null;
    },
    listProjects(brandId: string): ProjectRow[] {
      return (db.prepare('SELECT * FROM projects WHERE brand_id=? ORDER BY created_at').all(brandId) as any[]).map(
        (r) => ({
          id: r.id,
          brandId: r.brand_id,
          name: r.name,
          createdAt: r.created_at,
        }),
      );
    },

    // nodes / version tree
    addNode(input: {
      projectId: string;
      parentId: string | null;
      kind: Exclude<NodeKind, 'root'>;
      prompt: string;
      engineId: string;
    }): TreeNode {
      if (input.parentId) {
        const parent = this.getNode(input.parentId);
        if (!parent || parent.projectId !== input.projectId) throw new Error('parent node not found in project');
      }
      const id = randomUUID();
      db.prepare('INSERT INTO nodes (id, project_id, parent_id, kind, prompt, engine_id) VALUES (?,?,?,?,?,?)').run(
        id,
        input.projectId,
        input.parentId,
        input.kind,
        input.prompt,
        input.engineId,
      );
      return this.getNode(id)!;
    },
    completeNode(id: string, result: { images: string[]; costUsd: number }): void {
      db.prepare("UPDATE nodes SET status='done', images=?, cost_usd=? WHERE id=?").run(
        JSON.stringify(result.images),
        result.costUsd,
        id,
      );
    },
    failNode(id: string, error: string): void {
      db.prepare("UPDATE nodes SET status='error', error=? WHERE id=?").run(error, id);
    },
    getNode(id: string): TreeNode | null {
      const r = db.prepare('SELECT * FROM nodes WHERE id=?').get(id) as any;
      return r ? rowToNode(r) : null;
    },
    treeFor(projectId: string): TreeNode[] {
      return (db.prepare('SELECT * FROM nodes WHERE project_id=? ORDER BY created_at').all(projectId) as any[]).map(
        rowToNode,
      );
    },
    setKept(id: string, kept: boolean): void {
      db.prepare('UPDATE nodes SET kept=? WHERE id=?').run(kept ? 1 : 0, id);
    },
    setBrief(id: string, brief: unknown): void {
      db.prepare('UPDATE nodes SET brief=? WHERE id=?').run(JSON.stringify(brief), id);
    },
    setOverlays(id: string, overlays: Record<string, unknown[]>): void {
      db.prepare('UPDATE nodes SET overlays=? WHERE id=?').run(JSON.stringify(overlays), id);
    },

    // settings
    getSetting(key: string): string | null {
      const r = db.prepare('SELECT value FROM settings WHERE key=?').get(key) as { value: string } | undefined;
      return r ? r.value : null;
    },
    setSetting(key: string, value: string): void {
      db.prepare(
        'INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
      ).run(key, value);
    },
    allSettings(): Record<string, string> {
      const rows = db.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[];
      return Object.fromEntries(rows.map((r) => [r.key, r.value]));
    },
  };
}

export type Store = ReturnType<typeof createStore>;
