import type { Core } from '@scenri/core';
import type { FastifyInstance } from 'fastify';
import { brandScenes } from '../assetRecords.js';
import type { ExampleRole, SceneExamples } from '../sceneExamples.js';

const ROLES = new Set<ExampleRole>(['hero', 'close', 'hands', 'angle', 'bold']);

/**
 * A scene's examples, from its page or its conversation: what is drawing,
 * Draw two pictures, Add three more, Try again for one, Stop, and Remove.
 * Every one of them is a press. Nothing on this road is ever drawn without
 * being asked for, so saving a scene spends nothing (sceneExamples.ts).
 */
export function registerSceneExampleRoutes(app: FastifyInstance, deps: { core: Core; examples: SceneExamples }): void {
  const { core, examples } = deps;
  const sceneOr404 = (req: any, reply: any) => {
    const brand = core.store.getBrand(String(req.params.id));
    const scene = brand ? brandScenes(brand.json).find((s) => s.id === String(req.params.sceneId)) : undefined;
    if (!brand || !scene) {
      reply.status(404).send({ error: 'scene not found' });
      return null;
    }
    return { brandId: brand.id, scene };
  };

  app.get('/api/brands/:id/scenes/:sceneId/examples', async (req, reply) => {
    const found = sceneOr404(req, reply);
    if (!found) return;
    return {
      job: examples.status(found.brandId, found.scene.id),
      // what each offer would draw, so both can be counted in the button
      // that asks for them, before anything is spent
      first: examples.offerFirst(found.scene),
      more: examples.offer(found.scene),
    };
  });

  /**
   * `{ first: true }` for the place in use and a close-up (or for the roles a
   * changed place left showing the earlier picture), `{ more: true }` for the
   * rest of the set, or `{ roles: [...] }` to draw (or redraw) exactly those.
   */
  app.post('/api/brands/:id/scenes/:sceneId/examples', async (req, reply) => {
    const found = sceneOr404(req, reply);
    if (!found) return;
    const body = (req.body ?? {}) as { roles?: unknown; more?: unknown; first?: unknown };
    const named = !body.first && !body.more;
    const asked = body.first
      ? examples.offerFirst(found.scene)
      : body.more
        ? examples.offer(found.scene)
        : [
            ...new Set(
              (Array.isArray(body.roles) ? body.roles : [])
                .map(String)
                .filter((r): r is ExampleRole => ROLES.has(r as ExampleRole)),
            ),
          ];
    if (!asked.length) return reply.status(400).send({ error: 'which examples?' });
    try {
      // Roles named by the press (Try again) are drawn as named; an offer may add the hero they need.
      return { job: examples.start(found.brandId, found.scene.id, asked, named) };
    } catch (err: any) {
      return reply.status(err.statusCode ?? 500).send({ error: err.message });
    }
  });

  app.post('/api/brands/:id/scenes/:sceneId/examples/stop', async (req, reply) => {
    const found = sceneOr404(req, reply);
    if (!found) return;
    return { ok: examples.stop(found.brandId, found.scene.id) };
  });

  app.delete('/api/brands/:id/scenes/:sceneId/examples/:role', async (req, reply) => {
    const found = sceneOr404(req, reply);
    if (!found) return;
    const role = String((req.params as any).role) as ExampleRole;
    if (!ROLES.has(role)) return reply.status(400).send({ error: 'which example?' });
    const ok = examples.remove(found.brandId, found.scene.id, role);
    return { ok, brand: core.store.getBrand(found.brandId) };
  });
}
