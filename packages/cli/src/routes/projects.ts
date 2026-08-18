import type { FastifyInstance } from 'fastify';
import type { Core } from '@scenri/core';

export function registerProjectRoutes(app: FastifyInstance, deps: { core: Core }): void {
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

  // ---- workspace + sets
  /**
   * The whole brand in one answer: its shots, its sets, and who is in what.
   *
   * The feed used to be assembled by asking for every project's tree in turn,
   * so a brand with forty of them cost forty requests to draw one screen. There
   * is one project now and the sets are a filter over it, so there is one ask.
   */
  app.get('/api/brands/:id/workspace', async (req, reply) => {
    const brand = core.store.getBrand((req.params as any).id);
    if (!brand) return reply.status(404).send({ error: 'brand not found' });
    const project = core.store.workspaceFor(brand.id);
    return {
      project,
      nodes: core.store.treeFor(project.id),
      sets: core.store.listSets(brand.id),
      membership: core.store.membershipFor(brand.id),
    };
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
  app.post('/api/sets/:id/nodes', async (req, reply) => {
    const set = core.store.getSet((req.params as any).id);
    if (!set) return reply.status(404).send({ error: 'set not found' });
    const raw = (req.body as any)?.nodeIds;
    const nodeIds = (Array.isArray(raw) ? raw : []).map(String).filter((id) => core.store.getNode(id));
    if (nodeIds.length === 0) return reply.status(400).send({ error: 'nodeIds must name at least one shot' });
    core.store.addToSet(set.id, nodeIds);
    return { ok: true, added: nodeIds.length };
  });
  app.delete('/api/sets/:id/nodes/:nodeId', async (req, reply) => {
    const { id, nodeId } = req.params as any;
    if (!core.store.getSet(id)) return reply.status(404).send({ error: 'set not found' });
    core.store.removeFromSet(id, nodeId);
    return { ok: true };
  });
}
