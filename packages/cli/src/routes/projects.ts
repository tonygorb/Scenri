import type { FastifyInstance } from 'fastify';
import { searchTerms, termMatches, type BrandRow, type Core, type FeedFilter, type FeedSort } from '@scenri/core';

/** Something a brief token can name, with the name it answers to right now. */
export interface TokenName {
  id: string;
  name: string;
}

export interface ProjectRouteDeps {
  core: Core;
  /**
   * Every product, presenter and scene a brand's briefs can point at, by
   * current display name: the brand's own kit, the imported catalog, and the
   * curated catalogs. Read only when a search is asked, so a rename is found
   * by its new name without rewriting a single stored shot.
   */
  tokenNames: (brand: BrandRow) => TokenName[];
  /** Every engine by the name it is called by. */
  engineNames: () => TokenName[];
}

const SORTS: FeedSort[] = ['newest', 'oldest', 'cost', 'keepers'];

export function registerProjectRoutes(app: FastifyInstance, deps: ProjectRouteDeps): void {
  const { core } = deps;
  // ---- projects + tree
  app.post('/api/projects', async (req, reply) => {
    const { brandId, name } = req.body as any;
    if (!core.store.getBrand(String(brandId))) return reply.status(404).send({ error: 'brand not found' });
    return core.store.createProject(String(brandId), String(name || 'Untitled'));
  });
  app.get('/api/projects', async (req) => core.store.listProjects(String((req.query as any).brandId ?? '')));
  app.get('/api/projects/:id/tree', async (req, reply) => {
    const p = core.store.getProject((req.params as any).id);
    if (!p) return reply.status(404).send({ error: 'project not found' });
    return { project: p, nodes: core.store.treeFor(p.id) };
  });
  /**
   * Everything the brand has running or lately finished, generations and
   * catalog imports together. One request, so the notifications bell costs the
   * same whether you have two projects or forty.
   */
  app.get('/api/brands/:id/activity', async (req, reply) => {
    const brand = core.store.getBrand((req.params as any).id);
    if (!brand) return reply.status(404).send({ error: 'brand not found' });
    const limit = Math.min(Number((req.query as any).limit) || 60, 200);
    return { nodes: core.store.recentActivity(brand.id, limit), jobs: core.catalog.listJobs(brand.id) };
  });

  // ---- workspace + feed + sets
  /**
   * The brand's frame in one answer: its one project and root, its sets, who
   * is in what, and the newest shots for the rail and the attach panel.
   *
   * The shots themselves are a paged query (`/feed`) and never travel here.
   * This used to carry every node the brand had ever made, prompt and all,
   * so a workspace of six thousand shots was a 19 MB answer to draw one
   * screen, and every keeper toggle re-read it.
   */
  app.get('/api/brands/:id/workspace', async (req, reply) => {
    const brand = core.store.getBrand((req.params as any).id);
    if (!brand) return reply.status(404).send({ error: 'brand not found' });
    const project = core.store.workspaceFor(brand.id);
    return {
      project,
      root: core.store.rootFor(project.id)?.id ?? null,
      sets: core.store.listSets(brand.id),
      membership: core.store.membershipFor(brand.id),
      recent: core.store.recentShots(project.id, 48),
    };
  });

  /**
   * One page of the brand's shots for a place, lens, search and sort, with
   * what each lens would show from there. Bounded whatever the brand holds:
   * page forty costs what page one costs.
   */
  app.get('/api/brands/:id/feed', async (req, reply) => {
    const brand = core.store.getBrand((req.params as any).id);
    if (!brand) return reply.status(404).send({ error: 'brand not found' });
    const project = core.store.workspaceFor(brand.id);
    const qs = (req.query ?? {}) as Record<string, string | undefined>;
    const lens = qs.lens === 'keepers' || qs.lens === 'archived' ? qs.lens : 'all';
    const sort = SORTS.includes(qs.sort as FeedSort) ? (qs.sort as FeedSort) : 'newest';
    const tokens = qs.token
      ? qs.token
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : undefined;
    const q = qs.q ?? '';
    let terms: FeedFilter['terms'];
    if (q.trim()) {
      // names are resolved once per request, from what they are called now
      const names = deps.tokenNames(brand);
      const engines = deps.engineNames();
      terms = searchTerms(q).map((t) => ({
        ...t,
        tokenIds: names.filter((n) => termMatches(n.name, t)).map((n) => n.id),
        engineIds: engines.filter((e) => termMatches(e.name, t)).map((e) => e.id),
      }));
    }
    const filter: FeedFilter = {
      lens,
      set: qs.set || undefined,
      ungrouped: qs.ungrouped === '1' || qs.ungrouped === 'true',
      lineage: qs.lineage || undefined,
      tokens: tokens?.length ? tokens : undefined,
      terms,
    };
    let page: ReturnType<typeof core.store.feedPage>;
    try {
      page = core.store.feedPage(project.id, {
        ...filter,
        sort,
        limit: Number(qs.limit) || 60,
        cursor: qs.cursor || null,
      });
    } catch (err) {
      if (/cursor/.test(String((err as Error).message))) return reply.status(400).send({ error: 'invalid cursor' });
      throw err;
    }
    // the counts describe the whole place, so the first page carries them and
    // a continuation, which changes nothing about the place, carries none
    return qs.cursor ? page : { ...page, counts: core.store.feedCounts(project.id, filter) };
  });

  /** Where one shot sits in its tree: what the overlay and the keyboard walk need. */
  app.get('/api/nodes/:id/lineage', async (req, reply) => {
    const lineage = core.store.lineageOf((req.params as any).id);
    return lineage ?? reply.status(404).send({ error: 'node not found' });
  });

  /** A year of runs by day, counted where the rows are. */
  app.get('/api/brands/:id/usage', async (req, reply) => {
    const brand = core.store.getBrand((req.params as any).id);
    if (!brand) return reply.status(404).send({ error: 'brand not found' });
    return { days: core.store.usageByDay(brand.id) };
  });

  app.get('/api/brands/:id/sets', async (req, reply) => {
    const brand = core.store.getBrand((req.params as any).id);
    if (!brand) return reply.status(404).send({ error: 'brand not found' });
    return core.store.listSets(brand.id);
  });
  app.post('/api/brands/:id/sets', async (req, reply) => {
    const brand = core.store.getBrand((req.params as any).id);
    if (!brand) return reply.status(404).send({ error: 'brand not found' });
    const name = String((req.body as any)?.name ?? '').trim();
    if (!name) return reply.status(400).send({ error: 'name is required' });
    return core.store.createSet(brand.id, name);
  });
  app.patch('/api/sets/:id', async (req, reply) => {
    const name = String((req.body as any)?.name ?? '').trim();
    if (!name) return reply.status(400).send({ error: 'name is required' });
    const set = core.store.renameSet((req.params as any).id, name);
    if (!set) return reply.status(404).send({ error: 'set not found' });
    return set;
  });
  /** The set goes; every shot that was in it stays exactly where it was. */
  app.delete('/api/sets/:id', async (req, reply) => {
    if (!core.store.getSet((req.params as any).id)) return reply.status(404).send({ error: 'set not found' });
    core.store.deleteSet((req.params as any).id);
    return { ok: true };
  });
  // The set's whole membership rides back on both writes, so the studio can
  // patch its record in place rather than re-read the brand for it.
  app.post('/api/sets/:id/nodes', async (req, reply) => {
    const set = core.store.getSet((req.params as any).id);
    if (!set) return reply.status(404).send({ error: 'set not found' });
    const raw = (req.body as any)?.nodeIds;
    const nodeIds = (Array.isArray(raw) ? raw : []).map(String).filter((id) => core.store.getNode(id));
    if (nodeIds.length === 0) return reply.status(400).send({ error: 'nodeIds must name at least one shot' });
    core.store.addToSet(set.id, nodeIds);
    return { ok: true, added: nodeIds.length, nodeIds: core.store.membersOf(set.id) };
  });
  app.delete('/api/sets/:id/nodes/:nodeId', async (req, reply) => {
    const { id, nodeId } = req.params as any;
    if (!core.store.getSet(id)) return reply.status(404).send({ error: 'set not found' });
    core.store.removeFromSet(id, nodeId);
    return { ok: true, nodeIds: core.store.membersOf(id) };
  });
}
