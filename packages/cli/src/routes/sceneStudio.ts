import type { FastifyInstance } from 'fastify';
import {
  attachSceneStudioJob,
  cancelSceneStudioJob,
  getSceneStudioJob,
  startSceneStudioJob,
  type StudioJobInput,
} from '../sceneStudio.js';
import { type BuildRouteDeps, makeBuildDeps } from './assetBuilds.js';

/**
 * The scene studio's routes: start a piece of work, watch it, stop it, and put
 * a picture that was still drawing onto the scene it belongs to.
 *
 * None of these writes a scene. The studio holds what they answer as versions,
 * and the scene is written by the plain scene routes when the person uses one.
 */
export function registerSceneStudioRoutes(app: FastifyInstance, deps: BuildRouteDeps): void {
  const { core } = deps;
  const { buildDeps } = makeBuildDeps(deps);

  const brandOr404 = (req: any, reply: any) => {
    const brand = core.store.getBrand(String(req.params.id));
    if (!brand) {
      reply.status(404).send({ error: 'brand not found' });
      return null;
    }
    return brand;
  };

  /** A job, only to the brand it belongs to. */
  const jobOr404 = (req: any, reply: any, brandId: string) => {
    const job = getSceneStudioJob(String(req.params.jobId));
    if (!job || job.brandId !== brandId) {
      reply.status(404).send({ error: 'this work is gone' });
      return null;
    }
    return job;
  };

  app.post('/api/brands/:id/scene-studio/jobs', async (req, reply) => {
    const brand = brandOr404(req, reply);
    if (!brand) return;
    const body = (req.body ?? {}) as any;
    const input: StudioJobInput = {
      brandId: brand.id,
      kind: body.kind,
      instruction: body.instruction == null ? undefined : String(body.instruction),
      imageHashes: Array.isArray(body.imageHashes) ? body.imageHashes.map((h: unknown) => String(h)) : [],
      reading: body.reading ?? undefined,
      from: body.from == null ? undefined : String(body.from),
      ask: body.ask == null ? undefined : String(body.ask),
      draw: body.draw === false ? false : undefined,
      reread: body.reread === true,
    };
    try {
      const { jobId } = startSceneStudioJob(await buildDeps(), input);
      return { jobId, job: getSceneStudioJob(jobId) };
    } catch (err: any) {
      return reply.status(err.statusCode ?? 500).send({ error: err.message ?? 'could not start' });
    }
  });

  app.get('/api/brands/:id/scene-studio/jobs/:jobId', async (req, reply) => {
    const brand = brandOr404(req, reply);
    if (!brand) return;
    return jobOr404(req, reply, brand.id) ?? undefined;
  });

  app.post('/api/brands/:id/scene-studio/jobs/:jobId/cancel', async (req, reply) => {
    const brand = brandOr404(req, reply);
    if (!brand) return;
    const job = jobOr404(req, reply, brand.id);
    if (!job) return;
    return { ok: cancelSceneStudioJob(job.id) };
  });

  app.post('/api/brands/:id/scene-studio/jobs/:jobId/attach', async (req, reply) => {
    const brand = brandOr404(req, reply);
    if (!brand) return;
    const job = jobOr404(req, reply, brand.id);
    if (!job) return;
    const sceneId = String(((req.body ?? {}) as any).sceneId ?? '');
    if (!sceneId) return reply.status(400).send({ error: 'which scene?' });
    const state = attachSceneStudioJob(await buildDeps(), job.id, sceneId);
    return { state, brand: core.store.getBrand(brand.id) };
  });
}
