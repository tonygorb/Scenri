import { randomUUID } from 'node:crypto';
import type { DB } from './db.js';
import { RESERVED_SLUGS, firstFree, slugifyWithId } from './slug.js';
import { ftsMatch, type SearchTerm } from './searchRules.js';

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
  /** Its place in the address bar, unique within the brand. */
  slug: string;
  createdAt: string;
}
export type NodeKind = 'root' | 'generation' | 'edit';
export type NodeStatus = 'running' | 'done' | 'error' | 'cancelled';
/**
 * Characters of the compiled prompt a list row carries: enough for a title
 * (the leading [Scene] tag or the first six words) and alt text. Counted in
 * code points, which is what SQLite's substr counts.
 */
export const PROMPT_HEAD_CHARS = 240;
/**
 * A shot as every list carries it. The compiled prompt averages 3 KB and was
 * 80% of every feed payload, read by nothing a list shows; it stays behind
 * getNode. The full TreeNode extends this, so a whole record can sit in any
 * list.
 */
export interface FeedNode {
  id: string;
  projectId: string;
  parentId: string | null;
  kind: NodeKind;
  /** The first PROMPT_HEAD_CHARS code points of the compiled prompt. */
  promptHead: string;
  engineId: string;
  status: NodeStatus;
  images: string[];
  costUsd: number;
  /** Wall time of the run in milliseconds; null for legacy and unfinished nodes. */
  durationMs: number | null;
  kept: boolean;
  error: string | null;
  createdAt: string;
  /** Structured brief this shot came from; null for legacy nodes. */
  brief: unknown | null;
  /** Put away, not gone: an archived node is excluded from the default feed
   * but always restorable, never deleted. */
  archived: boolean;
  /** The multi-shot request this node came from; null for single sends and
   * for every edit. Provenance only — never a user-facing hierarchy. */
  batchId: string | null;
  /** Which slot of that request this node filled; 0 outside a batch. */
  batchIndex: number;
  /** How many live (non-archived) refinements hang off this shot: the versions pip. */
  childCount: number;
}

/** The whole record: what a list carries plus the compiled prompt and the overlays. */
export interface TreeNode extends FeedNode {
  prompt: string;
  /** Text-overlay layers keyed by image index (editor data, opaque to core). */
  overlays: Record<string, unknown[]>;
}

/** What the brand switcher and the route resolver need, never the document. */
export interface BrandSummary {
  id: string;
  slug: string;
  name: string;
  website: string | null;
  /** The primary mark as an asset ref, if the kit has one. */
  mark: string | null;
  primaryHex: string | null;
  createdAt: string;
  updatedAt: string;
}

export type FeedLens = 'all' | 'keepers' | 'archived';
export type FeedSort = 'newest' | 'oldest' | 'cost' | 'keepers';

/** One search term with the ids whose current display names it matched, resolved by the caller. */
export interface FeedSearchTerm extends SearchTerm {
  tokenIds: string[];
  engineIds: string[];
}

/** Which shots a feed page is about. Absent means all. */
export interface FeedFilter {
  lens?: FeedLens;
  /** Only shots in this set. */
  set?: string;
  /** Only shots in no set. */
  ungrouped?: boolean;
  /** This shot and everything descended from it. */
  lineage?: string;
  /** Only shots whose brief carries one of these product, presenter or scene ids. */
  tokens?: string[];
  /** Every term must match: the index over the prompt, a token's current name, or the engine's name. */
  terms?: FeedSearchTerm[];
}

export interface FeedPageQuery extends FeedFilter {
  sort?: FeedSort;
  limit?: number;
  /** The `next` of the previous page. */
  cursor?: string | null;
}

export interface FeedCounts {
  /** Every shot the brand has ever made, whatever the place, lens or search. */
  total: number;
  all: number;
  keepers: number;
  archived: number;
  /** Live shots in no set at all, unscoped and unsearched. */
  ungrouped: number;
}

export interface FeedPage {
  items: FeedNode[];
  /** An opaque keyset cursor for the page after this one; null at the end. */
  next: string | null;
}

/** Where one shot sits in its tree. */
export interface Lineage {
  /** Root-most first, the parent last; never the root itself. */
  ancestors: FeedNode[];
  /** Every shot off the same parent, the shot itself included, oldest first. */
  siblings: FeedNode[];
  /** Refinements of the shot, oldest first. */
  children: FeedNode[];
}

export interface UsageDay {
  day: string;
  generations: number;
  edits: number;
}

/** A node carrying the sets it has been put in, for lists that span the brand. */
export interface ActivityNode extends FeedNode {
  /** Empty when the shot is in no set, which is an ordinary state, not a gap. */
  setNames: string[];
}

/**
 * An opt-in grouping of shots. Not a place work happens — that is the brand's
 * one workspace — only a name you hang finished shots on, and a shot may hang
 * on several.
 */
export interface SetRow {
  id: string;
  brandId: string;
  name: string;
  /** Its place in the address bar, unique within the brand. */
  slug: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * The slug is the brand's URL, so two brands cannot share one: the second
 * "Acme" becomes acme-2. Renaming a brand back onto a taken slug suffixes
 * rather than steals, so no existing link ever changes owner. `id` is always
 * the brand's own id — the row being created or updated — used both to seed
 * a Latin-free name's fallback and to exclude itself from the collision
 * check; for a brand new row neither matters yet, so passing it unconditionally
 * is harmless.
 *
 * A brand sits at the web root, so the names that root already owns are taken
 * in the same sense another brand's slug is: a brand called "Assets" becomes
 * assets-2 rather than a page that never loads.
 */
export function uniqueSlug(db: DB, name: string, id: string): string {
  const stmt = db.prepare('SELECT 1 FROM brands WHERE slug=? AND id IS NOT ?');
  return firstFree(slugifyWithId(name, id), (c) => RESERVED_SLUGS.has(c) || !!stmt.get(c, id));
}

/** Same, per brand: two brands may each have a project called Untitled. */
export function uniqueProjectSlug(db: DB, brandId: string, name: string, id: string): string {
  const stmt = db.prepare('SELECT 1 FROM projects WHERE brand_id=? AND slug=?');
  return firstFree(slugifyWithId(name, id, 'project'), (c) => !!stmt.get(brandId, c));
}

/** And again for sets, which share the brand's address space with nothing else. */
export function uniqueSetSlug(db: DB, brandId: string, name: string, id: string): string {
  const stmt = db.prepare('SELECT 1 FROM sets WHERE brand_id=? AND slug=? AND id IS NOT ?');
  return firstFree(slugifyWithId(name, id, 'set'), (c) => !!stmt.get(brandId, c, id));
}

/**
 * What `group_concat` glues set names with. A comma would be ambiguous the
 * moment somebody names a set "Spring, Summer"; the unit separator cannot
 * appear in a name typed by a human.
 */
const SET_NAME_SEP = String.fromCharCode(31);

function rowToSet(r: any): SetRow {
  return {
    id: r.id,
    brandId: r.brand_id,
    name: r.name,
    slug: r.slug,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/** The first PROMPT_HEAD_CHARS code points, the way SQLite's substr counts them. */
const headOf = (prompt: unknown): string =>
  Array.from(String(prompt ?? ''))
    .slice(0, PROMPT_HEAD_CHARS)
    .join('');

/**
 * Live refinements hanging off a row, as a correlated subquery over the
 * parent index. Zero for the root by rule rather than by counting: every
 * top-level shot hangs off it, and counting twenty thousand of them cost
 * every request that touched the root fifty milliseconds.
 */
const CHILD_COUNT_SQL =
  "(CASE WHEN n.kind = 'root' THEN 0 ELSE (SELECT count(*) FROM nodes c WHERE c.parent_id = n.id AND c.archived = 0) END)";

/** How many siblings a lineage answer carries on either side of the shot. */
export const LINEAGE_SIBLINGS_RADIUS = 25;
/** How many children a lineage answer carries; the strip shows six. */
export const LINEAGE_CHILDREN_MAX = 60;

/** What every list reads: no prompt, no overlays, two JSON columns instead of three. */
const FEED_COLS = `n.id, n.project_id, n.parent_id, n.kind, substr(n.prompt, 1, ${PROMPT_HEAD_CHARS}) AS prompt_head,
  n.engine_id, n.status, n.images, n.cost_usd, n.duration_ms, n.kept, n.error, n.created_at, n.brief, n.archived,
  n.batch_id, n.batch_index, ${CHILD_COUNT_SQL} AS child_count`;

function rowToFeedNode(r: any): FeedNode {
  return {
    id: r.id,
    projectId: r.project_id,
    parentId: r.parent_id,
    kind: r.kind,
    promptHead: r.prompt_head ?? headOf(r.prompt),
    engineId: r.engine_id,
    status: r.status,
    images: JSON.parse(r.images),
    costUsd: r.cost_usd,
    durationMs: r.duration_ms ?? null,
    kept: !!r.kept,
    error: r.error,
    createdAt: r.created_at,
    brief: r.brief ? JSON.parse(r.brief) : null,
    archived: !!r.archived,
    batchId: r.batch_id ?? null,
    batchIndex: r.batch_index ?? 0,
    childCount: r.child_count ?? 0,
  };
}

function rowToNode(r: any): TreeNode {
  return {
    ...rowToFeedNode(r),
    prompt: r.prompt,
    overlays: JSON.parse(r.overlays ?? '{}'),
  };
}

/**
 * Stamps for a batch of siblings, newest for slot 0: the feed is newest-first,
 * so this is what makes slot 0 read top-left and the batch read in request
 * order. Monotonic across calls, so two rapid batches can never interleave.
 */
let lastBatchStamp = 0;
function batchStamps(count: number): string[] {
  const base = Math.max(Date.now(), lastBatchStamp + count);
  lastBatchStamp = base;
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(base - i);
    return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}.${p(d.getUTCMilliseconds(), 3)}`;
  });
}

/** The keyset behind `next`: where the last row of a page sat in its ordering. */
interface Keyset {
  c: string;
  i: string;
  v?: number;
}
const encodeCursor = (k: Keyset): string => Buffer.from(JSON.stringify(k)).toString('base64url');
function decodeCursor(cursor: string): Keyset {
  try {
    const k = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (typeof k?.c === 'string' && typeof k?.i === 'string') return k;
  } catch {
    /* fall through */
  }
  throw new Error('invalid cursor');
}

/** The primary mark of a kit, by the studio's own rule: the entry tagged primary, else the first with a file. */
export function primaryMarkOf(logos: unknown): string | null {
  const list = Array.isArray(logos) ? logos.filter((l: any) => l && String(l.file ?? '').trim()) : [];
  const roles = ['primary', 'mark', 'wordmark', 'monochrome', 'alternate'];
  const tagged = list.find((l: any) => (roles.includes(l.role) ? l.role : 'primary') === 'primary');
  const pick = tagged ?? list[0];
  return pick ? String(pick.file) : null;
}

/**
 * The WHERE clauses of a feed filter, on alias `n`, with their parameters.
 * Shared by the page and the counts so both always agree about what a place
 * holds. The lens is applied by the page only; the counts describe every lens.
 */
function filterSql(f: FeedFilter, params: Record<string, unknown>, withLens: boolean): string[] {
  const where: string[] = ["n.kind != 'root'"];
  if (withLens) {
    if (f.lens === 'archived') where.push('n.archived = 1');
    else if (f.lens === 'keepers') where.push('n.archived = 0 AND n.kept = 1');
    else where.push('n.archived = 0');
  }
  if (f.lineage) {
    params.lineage = f.lineage;
    where.push(
      'n.id IN (WITH RECURSIVE d(id) AS (SELECT @lineage UNION ALL SELECT c.id FROM nodes c JOIN d ON c.parent_id = d.id) SELECT id FROM d)',
    );
  } else if (f.set) {
    params.set = f.set;
    where.push('n.id IN (SELECT node_id FROM set_nodes WHERE set_id = @set)');
  } else if (f.ungrouped) {
    where.push('NOT EXISTS (SELECT 1 FROM set_nodes sn WHERE sn.node_id = n.id)');
  }
  if (f.tokens?.length) {
    const names = f.tokens.map((t, i) => {
      params[`tok${i}`] = t;
      return `@tok${i}`;
    });
    where.push(`n.id IN (SELECT node_id FROM node_tokens WHERE token_id IN (${names.join(', ')}))`);
  }
  (f.terms ?? []).forEach((term, i) => {
    const any: string[] = [];
    const match = ftsMatch(term);
    if (match) {
      params[`m${i}`] = match;
      any.push(`n.rowid IN (SELECT rowid FROM nodes_fts WHERE nodes_fts MATCH @m${i})`);
    }
    // A term under three characters is below the trigram index and filters
    // the text of nothing: scanning for it instead cost most of a second on
    // a brand of twenty thousand for the first two letters of every search.
    // It still finds the products, people, scenes and engines whose names
    // hold it, which the caller resolved by name.
    if (term.tokenIds.length) {
      const names = term.tokenIds.map((t, j) => {
        params[`t${i}_${j}`] = t;
        return `@t${i}_${j}`;
      });
      any.push(`n.id IN (SELECT node_id FROM node_tokens WHERE token_id IN (${names.join(', ')}))`);
    }
    if (term.engineIds.length) {
      const names = term.engineIds.map((e, j) => {
        params[`e${i}_${j}`] = e;
        return `@e${i}_${j}`;
      });
      any.push(`n.engine_id IN (${names.join(', ')})`);
    }
    if (any.length) where.push(`(${any.join(' OR ')})`);
  });
  return where;
}

/** The ORDER BY of each sort and the keyset predicate that continues it. */
function sortSql(
  sort: FeedSort,
  cursor: Keyset | null,
  params: Record<string, unknown>,
): { order: string; after: string | null } {
  if (cursor) {
    params.c = cursor.c;
    params.i = cursor.i;
    params.v = cursor.v ?? 0;
  }
  const newest = '(n.created_at < @c OR (n.created_at = @c AND n.id < @i))';
  const oldest = '(n.created_at > @c OR (n.created_at = @c AND n.id > @i))';
  switch (sort) {
    case 'oldest':
      return { order: 'n.created_at ASC, n.id ASC', after: cursor ? oldest : null };
    case 'cost':
      return {
        order: 'n.cost_usd DESC, n.created_at DESC, n.id DESC',
        after: cursor ? `(n.cost_usd < @v OR (n.cost_usd = @v AND ${newest}))` : null,
      };
    case 'keepers':
      return {
        order: 'n.kept DESC, n.created_at DESC, n.id DESC',
        after: cursor ? `(n.kept < @v OR (n.kept = @v AND ${newest}))` : null,
      };
    default:
      return { order: 'n.created_at DESC, n.id DESC', after: cursor ? newest : null };
  }
}

const keysetOf = (n: FeedNode, sort: FeedSort): Keyset =>
  sort === 'cost'
    ? { c: n.createdAt, i: n.id, v: n.costUsd }
    : sort === 'keepers'
      ? { c: n.createdAt, i: n.id, v: n.kept ? 1 : 0 }
      : { c: n.createdAt, i: n.id };

export const FEED_PAGE_MAX = 200;

export function createStore(db: DB) {
  return {
    // brands
    createBrand(json: { meta: { name: string } } & Record<string, unknown>): BrandRow {
      const id = randomUUID();
      db.prepare('INSERT INTO brands (id, slug, json) VALUES (?,?,?)').run(
        id,
        uniqueSlug(db, json.meta.name, id),
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
    /**
     * Every brand as the switcher and the route resolver need it. The
     * document is never parsed: a studio with fifty brands used to hand the
     * shell fifty whole kits to draw fifty menu rows.
     */
    listBrandSummaries(): BrandSummary[] {
      return (
        db
          .prepare(
            `SELECT id, slug, created_at, updated_at,
                    json_extract(json, '$.meta.name') AS name,
                    json_extract(json, '$.meta.website') AS website,
                    json_extract(json, '$.palette.primary.hex') AS primary_hex,
                    json_extract(json, '$.logos') AS logos
               FROM brands ORDER BY created_at`,
          )
          .all() as any[]
      ).map((r) => ({
        id: r.id,
        slug: r.slug,
        name: r.name ? String(r.name) : r.slug,
        website: r.website ? String(r.website) : null,
        mark: primaryMarkOf(r.logos ? JSON.parse(r.logos) : null),
        primaryHex: r.primary_hex ? String(r.primary_hex) : null,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      }));
    },
    updateBrand(id: string, json: { meta: { name: string } } & Record<string, unknown>): BrandRow | null {
      db.prepare("UPDATE brands SET json=?, slug=?, updated_at=datetime('now') WHERE id=?").run(
        JSON.stringify(json),
        uniqueSlug(db, json.meta.name, id),
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
      db.prepare('INSERT INTO projects (id, brand_id, name, slug) VALUES (?,?,?,?)').run(
        id,
        brandId,
        name,
        uniqueProjectSlug(db, brandId, name, id),
      );
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
      return r ? { id: r.id, brandId: r.brand_id, name: r.name, slug: r.slug, createdAt: r.created_at } : null;
    },
    listProjects(brandId: string): ProjectRow[] {
      return (db.prepare('SELECT * FROM projects WHERE brand_id=? ORDER BY created_at').all(brandId) as any[]).map(
        (r) => ({
          id: r.id,
          brandId: r.brand_id,
          name: r.name,
          slug: r.slug,
          createdAt: r.created_at,
        }),
      );
    },
    /**
     * The brand's one project, made on demand.
     *
     * Every node still hangs from a project root, but that is plumbing now, not
     * a place: nothing in the UI names it and nothing but this creates one. The
     * five buttons that used to invent a project each call this instead, so a
     * brand ends up with exactly one no matter which door you came through.
     */
    workspaceFor(brandId: string): ProjectRow {
      return this.listProjects(brandId)[0] ?? this.createProject(brandId, 'Workspace').project;
    },

    // sets
    createSet(brandId: string, name: string): SetRow {
      const id = randomUUID();
      db.prepare('INSERT INTO sets (id, brand_id, name, slug) VALUES (?,?,?,?)').run(
        id,
        brandId,
        name,
        uniqueSetSlug(db, brandId, name, id),
      );
      return this.getSet(id)!;
    },
    getSet(id: string): SetRow | null {
      const r = db.prepare('SELECT * FROM sets WHERE id=?').get(id) as any;
      return r ? rowToSet(r) : null;
    },
    /**
     * Most recently touched first, everywhere. The old project lists each chose
     * their own order — one ascending by creation, one descending, one capped
     * before it sorted — so the same six names came back in three different
     * sequences depending on which control you opened.
     */
    listSets(brandId: string): SetRow[] {
      return (
        db
          .prepare('SELECT * FROM sets WHERE brand_id=? ORDER BY updated_at DESC, created_at DESC')
          .all(brandId) as any[]
      ).map(rowToSet);
    },
    renameSet(id: string, name: string): SetRow | null {
      const current = this.getSet(id);
      if (!current) return null;
      db.prepare("UPDATE sets SET name=?, slug=?, updated_at=datetime('now') WHERE id=?").run(
        name,
        uniqueSetSlug(db, current.brandId, name, id),
        id,
      );
      return this.getSet(id);
    },
    /** The set goes; the shots do not. Membership is a label, never ownership. */
    deleteSet(id: string): void {
      db.prepare('DELETE FROM sets WHERE id=?').run(id);
    },
    addToSet(setId: string, nodeIds: string[]): void {
      const add = db.prepare('INSERT OR IGNORE INTO set_nodes (set_id, node_id) VALUES (?,?)');
      db.transaction(() => {
        for (const nodeId of nodeIds) add.run(setId, nodeId);
        db.prepare("UPDATE sets SET updated_at=datetime('now') WHERE id=?").run(setId);
      })();
    },
    removeFromSet(setId: string, nodeId: string): void {
      db.transaction(() => {
        db.prepare('DELETE FROM set_nodes WHERE set_id=? AND node_id=?').run(setId, nodeId);
        db.prepare("UPDATE sets SET updated_at=datetime('now') WHERE id=?").run(setId);
      })();
    },
    /**
     * Every membership in the brand, keyed by set. One query rather than one
     * per set, because the workspace screen filters on the client: the feed is
     * already loaded, and a set is only a subset of it.
     */
    membershipFor(brandId: string): Record<string, string[]> {
      const rows = db
        .prepare(
          `SELECT sn.set_id, sn.node_id
             FROM set_nodes sn JOIN sets s ON s.id = sn.set_id
            WHERE s.brand_id = ?
            ORDER BY sn.added_at`,
        )
        .all(brandId) as { set_id: string; node_id: string }[];
      const out: Record<string, string[]> = {};
      for (const r of rows) {
        if (!out[r.set_id]) out[r.set_id] = [];
        out[r.set_id].push(r.node_id);
      }
      return out;
    },

    /** One set's members, in the order they were filed. */
    membersOf(setId: string): string[] {
      return (
        db.prepare('SELECT node_id FROM set_nodes WHERE set_id=? ORDER BY added_at, node_id').all(setId) as any[]
      ).map((r) => r.node_id);
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
      // Milliseconds, not the column's second-resolution default: the feed is
      // ordered by created_at with the random id as tiebreak, so two sends
      // inside one second landed in id order — newest anywhere but first.
      // Same text format as datetime('now') with the fraction appended, so it
      // compares correctly against every row already written.
      db.prepare(
        "INSERT INTO nodes (id, project_id, parent_id, kind, prompt, engine_id, created_at) VALUES (?,?,?,?,?,?, strftime('%Y-%m-%d %H:%M:%f','now'))",
      ).run(id, input.projectId, input.parentId, input.kind, input.prompt, input.engineId);
      return this.getNode(id)!;
    },
    /**
     * One multi-shot request, N first-class sibling nodes, one transaction.
     * Slot 0 gets the newest stamp (see batchStamps) so the newest-first feed
     * reads the batch in request order; batch_id is the first node's id, held
     * by every sibling including the first, and stays null for a single send
     * — one shot is not a batch.
     */
    addNodes(input: {
      projectId: string;
      parentId: string | null;
      kind: Exclude<NodeKind, 'root'>;
      prompt: string;
      engineId: string;
      count: number;
    }): TreeNode[] {
      if (input.parentId) {
        const parent = this.getNode(input.parentId);
        if (!parent || parent.projectId !== input.projectId) throw new Error('parent node not found in project');
      }
      const count = Math.max(1, Math.floor(input.count));
      const ids = Array.from({ length: count }, () => randomUUID());
      const stamps = batchStamps(count);
      const batchId = count > 1 ? ids[0] : null;
      const insert = db.prepare(
        'INSERT INTO nodes (id, project_id, parent_id, kind, prompt, engine_id, created_at, batch_id, batch_index) VALUES (?,?,?,?,?,?,?,?,?)',
      );
      db.transaction(() => {
        for (let i = 0; i < count; i++) {
          insert.run(
            ids[i],
            input.projectId,
            input.parentId,
            input.kind,
            input.prompt,
            input.engineId,
            stamps[i],
            batchId,
            i,
          );
        }
      })();
      return ids.map((id) => this.getNode(id)!);
    },
    completeNode(id: string, result: { images: string[]; costUsd: number; durationMs?: number }): void {
      db.prepare("UPDATE nodes SET status='done', images=?, cost_usd=?, duration_ms=? WHERE id=?").run(
        JSON.stringify(result.images),
        result.costUsd,
        result.durationMs ?? null,
        id,
      );
    },
    /**
     * The run's money, written once it is known. A batch's first sibling used
     * to be charged inside completeNode, at the end of the whole call; a
     * sibling now completes the moment its own image lands, and the cost is
     * only known when the call resolves, so it is written afterwards, onto a
     * node that finished. A failed or running node keeps 0, as before.
     */
    chargeNode(id: string, costUsd: number): void {
      db.prepare("UPDATE nodes SET cost_usd=? WHERE id=? AND status='done'").run(costUsd, id);
    },
    failNode(id: string, error: string): void {
      db.prepare("UPDATE nodes SET status='error', error=? WHERE id=?").run(error, id);
    },
    cancelNode(id: string): void {
      db.prepare("UPDATE nodes SET status='cancelled' WHERE id=?").run(id);
    },
    getNode(id: string): TreeNode | null {
      const r = db.prepare(`SELECT n.*, ${CHILD_COUNT_SQL} AS child_count FROM nodes n WHERE n.id=?`).get(id) as any;
      return r ? rowToNode(r) : null;
    },
    /** The list shape of one shot: what a keep or an archive answers with. */
    getFeedNode(id: string): FeedNode | null {
      const r = db.prepare(`SELECT ${FEED_COLS} FROM nodes n WHERE n.id=?`).get(id) as any;
      return r ? rowToFeedNode(r) : null;
    },
    /** The project's root, by index, rather than the whole tree read to find it. */
    rootFor(projectId: string): TreeNode | null {
      // by the state index, never a walk of the project in creation order: a
      // root need not be the oldest row, and walking to it read every row
      const rows = db
        .prepare(`SELECT n.*, ${CHILD_COUNT_SQL} AS child_count FROM nodes n WHERE n.project_id=? AND n.kind='root'`)
        .all(projectId) as any[];
      rows.sort(
        (a, b) => String(a.created_at).localeCompare(String(b.created_at)) || String(a.id).localeCompare(String(b.id)),
      );
      return rows.length ? rowToNode(rows[0]) : null;
    },
    treeFor(projectId: string): TreeNode[] {
      // Rows from before addNode stamped milliseconds are second-resolution,
      // so same-second rows need the id tiebreak or SQLite is free to return
      // them in a different order on every read — and the feed reshuffles
      // between two loads of one brand. New rows carry a fraction and only
      // tie on a same-millisecond scripted burst.
      return (
        db
          .prepare(
            `SELECT n.*, ${CHILD_COUNT_SQL} AS child_count FROM nodes n WHERE n.project_id=? ORDER BY n.created_at, n.id`,
          )
          .all(projectId) as any[]
      ).map(rowToNode);
    },
    /**
     * One page of a project's shots for a place, lens, search and sort.
     *
     * Keyset paging on the sort's own columns, never OFFSET: the cost of page
     * forty is the cost of page one, and a shot landing between two pages
     * shifts nothing already read. Every clause is served by an index or by
     * the search index; the whole workspace is never read.
     */
    feedPage(projectId: string, q: FeedPageQuery): FeedPage {
      const limit = Math.max(1, Math.min(FEED_PAGE_MAX, Math.floor(q.limit ?? 60)));
      const sort: FeedSort = q.sort ?? 'newest';
      const params: Record<string, unknown> = { project: projectId, limit: limit + 1 };
      const where = ['n.project_id = @project', ...filterSql(q, params, true)];
      const { order, after } = sortSql(sort, q.cursor ? decodeCursor(q.cursor) : null, params);
      if (after) where.push(after);
      const rows = db
        .prepare(`SELECT ${FEED_COLS} FROM nodes n WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT @limit`)
        .all(params) as any[];
      const items = rows.slice(0, limit).map(rowToFeedNode);
      const more = rows.length > limit;
      return { items, next: more && items.length ? encodeCursor(keysetOf(items[items.length - 1], sort)) : null };
    },
    /**
     * What each lens would show from a place and search, plus the two
     * unscoped totals. The scoped sums and the total read the state index
     * alone (project, kind, archived, kept: nothing that needs the row), and
     * the grouped count walks the brand's memberships rather than asking
     * every shot whether it is in a set.
     */
    feedCounts(projectId: string, f: FeedFilter): FeedCounts {
      const params: Record<string, unknown> = { project: projectId };
      const where = ['n.project_id = @project', ...filterSql({ ...f, lens: undefined }, params, false)];
      const scoped = db
        .prepare(
          `SELECT coalesce(sum(n.archived = 0), 0) AS live, coalesce(sum(n.archived = 0 AND n.kept = 1), 0) AS kept,
                  coalesce(sum(n.archived = 1), 0) AS archived
             FROM nodes n WHERE ${where.join(' AND ')}`,
        )
        .get(params) as { live: number; kept: number; archived: number };
      const totals = db
        .prepare(
          `SELECT count(*) AS total, coalesce(sum(n.archived = 0), 0) AS live
             FROM nodes n WHERE n.project_id = ? AND n.kind != 'root'`,
        )
        .get(projectId) as { total: number; live: number };
      const grouped = (
        db
          .prepare(
            `SELECT count(DISTINCT sn.node_id) AS c
               FROM sets s
               CROSS JOIN set_nodes sn ON sn.set_id = s.id
               CROSS JOIN nodes n ON n.id = sn.node_id
              WHERE s.brand_id = (SELECT brand_id FROM projects WHERE id = ?)
                AND n.project_id = ? AND n.archived = 0`,
          )
          .get(projectId, projectId) as { c: number }
      ).c;
      return {
        total: totals.total,
        all: scoped.live,
        keepers: scoped.kept,
        archived: scoped.archived,
        ungrouped: totals.live - grouped,
      };
    },
    /**
     * Where one shot sits in its tree, from the parent index: its ancestors
     * up to (never including) the root, the siblings around it, and what
     * hangs off it. Archived versions stay in the strip, as they did when the
     * overlay walked the whole workspace.
     *
     * The siblings are a window: this shot, and up to twenty-five on either
     * side in filing order. A top-level shot's siblings are every top-level
     * shot in the brand, and the whole list was eighteen megabytes on a
     * brand of twenty thousand; the overlay only ever steps to a neighbour,
     * and each step asks again, so the window re-centres as it goes.
     */
    lineageOf(id: string): Lineage | null {
      const node = this.getFeedNode(id);
      if (!node) return null;
      // the root has no siblings worth the name and its children are the feed
      if (node.kind === 'root') return { ancestors: [], siblings: [], children: [] };
      const ancestors: FeedNode[] = [];
      let cur = node.parentId ? this.getFeedNode(node.parentId) : null;
      for (let hops = 0; cur && cur.kind !== 'root' && hops < 64; hops++) {
        ancestors.unshift(cur);
        cur = cur.parentId ? this.getFeedNode(cur.parentId) : null;
      }
      // the shot's rank among its siblings, from the index alone
      const before = (
        db
          .prepare(
            `SELECT count(*) AS c FROM nodes n
              WHERE n.parent_id IS ? AND (n.created_at < ? OR (n.created_at = ? AND n.id < ?))`,
          )
          .get(node.parentId, node.createdAt, node.createdAt, node.id) as { c: number }
      ).c;
      const skip = Math.max(0, before - LINEAGE_SIBLINGS_RADIUS);
      const take = before - skip + 1 + LINEAGE_SIBLINGS_RADIUS;
      // nothing hangs off a parent but shots, so no kind test: the one here
      // made the offset walk read every row it skipped
      const siblings = (
        db
          .prepare(
            `SELECT ${FEED_COLS} FROM nodes n WHERE n.parent_id IS ?
              ORDER BY n.created_at, n.id LIMIT ? OFFSET ?`,
          )
          .all(node.parentId, take, skip) as any[]
      ).map(rowToFeedNode);
      const children = (
        db
          .prepare(`SELECT ${FEED_COLS} FROM nodes n WHERE n.parent_id = ? ORDER BY n.created_at, n.id LIMIT ?`)
          .all(node.id, LINEAGE_CHILDREN_MAX) as any[]
      ).map(rowToFeedNode);
      return { ancestors, siblings, children };
    },
    /** The newest finished shots, newest first, for the rail and the attach panel. */
    recentShots(projectId: string, limit = 48): FeedNode[] {
      return (
        db
          .prepare(
            `SELECT ${FEED_COLS} FROM nodes n
              WHERE n.project_id = ? AND n.kind != 'root' AND n.status = 'done' AND n.images != '[]'
              ORDER BY n.created_at DESC, n.id DESC LIMIT ?`,
          )
          .all(projectId, Math.max(1, Math.min(FEED_PAGE_MAX, limit))) as any[]
      ).map(rowToFeedNode);
    },
    /** A year of runs by day, counted where the rows are. */
    usageByDay(brandId: string): UsageDay[] {
      return (
        db
          .prepare(
            `SELECT substr(n.created_at, 1, 10) AS day,
                    coalesce(sum(n.kind = 'generation'), 0) AS generations,
                    coalesce(sum(n.kind = 'edit'), 0) AS edits
               FROM nodes n JOIN projects p ON p.id = n.project_id
              WHERE p.brand_id = ? AND n.kind != 'root' AND n.created_at >= date('now', '-400 days')
              GROUP BY day ORDER BY day`,
          )
          .all(brandId) as any[]
      ).map((r) => ({ day: String(r.day), generations: Number(r.generations), edits: Number(r.edits) }));
    },
    /** The compiled prompt of the shot that produced an image, for a reference described in words. */
    promptForImage(brandId: string, hash: string): string | null {
      const r = db
        .prepare(
          `SELECT n.prompt FROM nodes n JOIN projects p ON p.id = n.project_id
            WHERE p.brand_id = ? AND n.images LIKE ? ORDER BY n.created_at, n.id LIMIT 1`,
        )
        .get(brandId, `%"${hash}"%`) as { prompt: string } | undefined;
      return r?.prompt ?? null;
    },
    /**
     * Every piece of work a brand has in flight, plus whatever finished lately,
     * in one query. The bar outlives the project screen, so the thing that used
     * to be answerable only by polling one tree at a time has to be answerable
     * without knowing which project you are looking at.
     *
     * The cutoff is computed in SQL rather than passed in: created_at is
     * SQLite's own datetime('now') text, and comparing that against a caller's
     * ISO string is a silent, timezone-shaped mis-filter.
     */
    recentActivity(brandId: string, limit = 60): ActivityNode[] {
      // Two indexed reads joined, never one scan: "running, or recent" as a
      // single OR walked every shot in the brand to find the running ones,
      // forty milliseconds a poll on a brand of twenty thousand. The status
      // index answers the first half and the created index the second, and
      // each stops where its answer does.
      const cols = `${FEED_COLS}, (
                    SELECT group_concat(s.name, char(31))
                      FROM set_nodes sn JOIN sets s ON s.id = sn.set_id
                     WHERE sn.node_id = n.id
                  ) AS set_names`;
      const inBrand = 'n.project_id IN (SELECT id FROM projects WHERE brand_id = @brand)';
      const rows = db
        .prepare(
          `SELECT * FROM (
             SELECT ${cols} FROM nodes n
              WHERE ${inBrand} AND n.kind != 'root' AND n.status = 'running'
             UNION ALL
             SELECT ${cols} FROM nodes n
              WHERE ${inBrand} AND n.kind != 'root' AND n.status != 'running'
                AND n.created_at >= datetime('now', '-2 days')
           )
           ORDER BY created_at DESC, id DESC
           LIMIT @limit`,
        )
        .all({ brand: brandId, limit }) as any[];
      // char(31) is the unit separator: a set may legally be called "A, B"
      return rows.map((r) => ({
        ...rowToFeedNode(r),
        setNames: r.set_names ? String(r.set_names).split(SET_NAME_SEP) : [],
      }));
    },
    setKept(id: string, kept: boolean): void {
      db.prepare('UPDATE nodes SET kept=? WHERE id=?').run(kept ? 1 : 0, id);
    },
    /**
     * Archiving also clears the keeper mark.
     *
     * The two flags were independent, and the Keepers lens reads the live list,
     * so archiving a keeper removed it from Keepers and from the Keepers count
     * without saying anything: the star stayed lit on a shot that was no longer
     * in the shortlist it claimed to be in. Keepers is a live shortlist and
     * archive means put away, so one clears the other and the two can never
     * disagree. Restoring does not re-star: the judgement was made once and
     * putting the shot back is not the same as making it again.
     */
    setArchived(id: string, archived: boolean): void {
      if (archived) db.prepare('UPDATE nodes SET archived=1, kept=0 WHERE id=?').run(id);
      else db.prepare('UPDATE nodes SET archived=0 WHERE id=?').run(id);
    },
    /** Permanent. Orphans any children rather than blocking or cascading —
     * same technique collapseProjects already uses for a surplus root. */
    deleteNode(id: string): void {
      db.prepare('UPDATE nodes SET parent_id=NULL WHERE parent_id=?').run(id);
      db.prepare('DELETE FROM nodes WHERE id=?').run(id);
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
