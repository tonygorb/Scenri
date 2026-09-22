import type { Core } from '@scenri/core';
import type { FastifyInstance } from 'fastify';
import { brandScenes } from '../assetRecords.js';
import { type ExampleRole, rolesFor, type SceneExamples, pickSubject } from '../sceneExamples.js';

const ROLES = new Set<ExampleRole>(['hero', 'close', 'hands', 'angle', 'bold']);

/**
 * A scene's examples, from its page: what is drawing, Add three more, Try
 * again for one, Stop, and Remove. The first two are drawn without being
 * asked, when the scene first has its picture (sceneExamples.ts).
 */
export function registerSceneExampleRoutes(
  app: FastifyInstance,
  deps: {
    core: Core;
    examples: SceneExamples;
    subjects: Parameters<typeof pickSubject>[1];
    presenters: Parameters<typeof pickSubject>[2];
  },
): void {
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
    const subject = pickSubject(found.scene, deps.subjects, deps.presenters);
    return {
      job: examples.status(found.brandId, found.scene.id),
      // what "Add more" would draw, so the page can say it before anything is spent
      more: subject ? rolesFor(subject, 'more') : [],
    };
  });

  /** `{ more: true }` for the rest of the set, or `{ roles: [...] }` to draw (or redraw) those. */
  app.post('/api/brands/:id/scenes/:sceneId/examples', async (req, reply) => {
    const found = sceneOr404(req, reply);
    if (!found) return;
    const body = (req.body ?? {}) as { roles?: unknown; more?: unknown };
    const subject = pickSubject(found.scene, deps.subjects, deps.presenters);
    const asked = body.more
      ? subject
        ? rolesFor(subject, 'more')
        : []
      : (Array.isArray(body.roles) ? body.roles : [])
          .map(String)
          .filter((r): r is ExampleRole => ROLES.has(r as ExampleRole));
    if (!asked.length) return reply.status(400).send({ error: 'which examples?' });
    try {
      return { job: examples.start(found.brandId, found.scene.id, asked) };
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
