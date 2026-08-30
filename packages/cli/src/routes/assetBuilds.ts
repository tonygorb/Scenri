import type { FastifyInstance } from 'fastify';
import type { Core, EngineAdapter } from '@scenri/core';
import { createCodexAnalyzer } from '@scenri/engine-codex';
import type { EngineRegistry } from '../engines.js';
import { facetsOf, type Scene } from '../scenes.js';
import { presenterFacetsOf, type Presenter } from '../presenters.js';
import {
  brandCharacters,
  brandScenes,
  cancelAssetBuild,
  commit,
  forgetAssetBuild,
  getAssetBuild,
  isCustomPresenter,
  lintSceneProse,
  listAssetBuilds,
  presenterCrops,
  presenterRecordFrom,
  sceneBuildRunning,
  sceneRecordFrom,
  scenePreviewPrompt,
  startAssetBuild,
  trimEdgeBars,
  type Analyzer,
  type AssetBuildDeps,
  type CustomScene,
} from '../customAssets.js';
import { presenterCropMode } from '../presenterRepair.js';
import { brandContext, COST_PROBE } from './shared.js';

export function registerAssetBuildRoutes(
  app: FastifyInstance,
  deps: {
    core: Core;
    engines: EngineRegistry;
    analyzer?: Analyzer;
    scenes: Scene[];
    presenters: Presenter[];
  },
): void {
  const { core, engines, scenes, presenters } = deps;
  const analyzer: Analyzer | null = deps.analyzer ?? createCodexAnalyzer({ runner: engines.codexRunner });

  /**
   * Which engine draws a person's studio views and a scene's preview.
   *
   * Prefers codex-cli: it is local, adds no bill of ours on top of the plan the
   * user already pays for, and carries six references, which is what a chained
   * identity plan needs. Any
   * available engine that can take a reference at all will do; one that takes
   * none could not hold a face, so it is not offered.
   */
  const buildEngine = async (): Promise<EngineAdapter | null> => {
    const ordered = [...engines.all()].sort((a, b) => {
      const rank = (e: EngineAdapter) => (e.capabilities().id === 'codex-cli' ? 0 : 1);
      return rank(a) - rank(b);
    });
    for (const engine of ordered) {
      const caps = engine.capabilities();
      if (!caps.maxReferenceImages || caps.placeholder) continue;
      if ((await engine.isAvailable()).ok) return engine;
    }
    return null;
  };

  const buildDeps = async (): Promise<AssetBuildDeps> => ({
    core,
    engine: await buildEngine(),
    analyzer: (await analyzer?.isAvailable())?.ok ? analyzer : null,
    brandContext: (brandId: string) => brandContext(core, brandId),
    // The filters that already exist, so a new asset lands under a tab a
    // person can actually click rather than inventing a category of one.
    vocabulary: { ...facetsOf(scenes), categories: presenterFacetsOf(presenters).categories },
  });

  /** What a creation flow needs to know before it promises anything. */
  app.get('/api/asset-builds/capabilities', async () => {
    const [engine, probe] = await Promise.all([buildEngine(), analyzer?.isAvailable() ?? { ok: false }]);
    return {
      canAnalyze: probe.ok,
      analyzeReason: probe.ok ? null : (probe.reason ?? null),
      canGenerate: !!engine,
      engineId: engine?.capabilities().id ?? null,
      engineName: engine?.capabilities().displayName ?? null,
      /**
       * True when Scenri cannot price this per image, because it is not billed
       * through a key we hold. NOT the same as costing the user nothing: the
       * local Codex engine spends the Codex allowance on their ChatGPT plan,
       * which only OpenAI can meter. Copy built on this flag must say "nothing
       * billed through Scenri", never "free".
       */
      free: engine ? (await engine.costEstimate(COST_PROBE).catch(() => 0)) <= 0 : true,
    };
  });

  const brandOr404 = (req: any, reply: any) => {
    const brand = core.store.getBrand(String(req.params.id));
    if (!brand) {
      reply.status(404).send({ error: 'brand not found' });
      return null;
    }
    return brand;
  };

  app.post('/api/brands/:id/asset-builds', async (req, reply) => {
    const brand = brandOr404(req, reply);
    if (!brand) return;
    const body = (req.body ?? {}) as any;
    const kind = String(body.kind ?? '');
    if (kind !== 'presenter' && kind !== 'scene')
      return reply.status(400).send({ error: 'kind must be presenter|scene' });
    try {
      return startAssetBuild(await buildDeps(), {
        brandId: brand.id,
        kind,
        name: String(body.name ?? ''),
        instruction: body.instruction == null ? undefined : String(body.instruction),
        imageHashes: Array.isArray(body.imageHashes) ? body.imageHashes.map((h: unknown) => String(h)) : [],
        facets: Array.isArray(body.facets) ? body.facets.map((f: unknown) => String(f)) : [],
      });
    } catch (err: any) {
      return reply.status(err.statusCode ?? 500).send({ error: err.message ?? 'could not start' });
    }
  });
  app.get('/api/brands/:id/asset-builds', async (req, reply) => {
    const brand = brandOr404(req, reply);
    if (!brand) return;
    return { builds: listAssetBuilds(brand.id) };
  });
  app.get('/api/brands/:id/asset-builds/:jobId', async (req, reply) => {
    const brand = brandOr404(req, reply);
    if (!brand) return;
    const job = getAssetBuild(String((req.params as any).jobId));
    if (!job || job.brandId !== brand.id) return reply.status(404).send({ error: 'build not found' });
    return job;
  });
  /**
   * Forget a build that finished badly. `prune` only drops finished builds past
   * the newest twelve, so without this a failed card sits on the wall for twelve
   * more builds with no way to dismiss it.
   */
  app.delete('/api/brands/:id/asset-builds/:jobId', async (req, reply) => {
    const brand = brandOr404(req, reply);
    if (!brand) return;
    const job = getAssetBuild(String((req.params as any).jobId));
    if (!job || job.brandId !== brand.id) return reply.status(404).send({ error: 'build not found' });
    forgetAssetBuild(job.id);
    return { ok: true };
  });
  app.post('/api/brands/:id/asset-builds/:jobId/cancel', async (req, reply) => {
    const brand = brandOr404(req, reply);
    if (!brand) return;
    const job = getAssetBuild(String((req.params as any).jobId));
    if (!job || job.brandId !== brand.id) return reply.status(404).send({ error: 'build not found' });
    cancelAssetBuild(job.id);
    return { ok: true };
  });

  /**
   * Write a presenter directly, without a build.
   *
   * This is the path when nothing can read the photos: they become the
   * references as they are, and every field stays editable on the presenter's
   * own page. Named `presenters` rather than `characters` because there is
   * still no manual-add route for the legacy roster shape.
   */
  app.post('/api/brands/:id/presenters', async (req, reply) => {
    const brand = brandOr404(req, reply);
    if (!brand) return;
    const built = presenterRecordFrom(await withDerivedCrops(core, (req.body ?? {}) as any));
    if (!built.ok) return reply.status(400).send({ error: built.error });
    try {
      commit(core, brand.id, (json) => {
        json.characters = [...brandCharacters(json), built.presenter];
      });
    } catch (err: any) {
      return reply.status(err.statusCode ?? 500).send({ error: err.message });
    }
    return { presenter: built.presenter, brand: core.store.getBrand(brand.id) };
  });
  app.patch('/api/brands/:id/presenters/:presenterId', async (req, reply) => {
    const brand = brandOr404(req, reply);
    if (!brand) return;
    const id = String((req.params as any).presenterId);
    const base = brandCharacters(brand.json).find((c: any) => c.id === id);
    if (!base) return reply.status(404).send({ error: 'presenter not found' });
    if (!isCustomPresenter(base)) return reply.status(400).send({ error: 'this presenter is not editable' });
    const built = presenterRecordFrom(await withDerivedCrops(core, (req.body ?? {}) as any, base), base);
    if (!built.ok) return reply.status(400).send({ error: built.error });
    try {
      commit(core, brand.id, (json) => {
        json.characters = brandCharacters(json).map((c: any) => (c.id === id ? built.presenter : c));
      });
    } catch (err: any) {
      return reply.status(err.statusCode ?? 500).send({ error: err.message });
    }
    return { presenter: built.presenter, brand: core.store.getBrand(brand.id) };
  });
  app.delete('/api/brands/:id/presenters/:presenterId', async (req, reply) => {
    const brand = brandOr404(req, reply);
    if (!brand) return;
    const id = String((req.params as any).presenterId);
    const base = brandCharacters(brand.json).find((c: any) => c.id === id);
    if (!base) return reply.status(404).send({ error: 'presenter not found' });
    if (!isCustomPresenter(base)) return reply.status(400).send({ error: 'this presenter is not editable' });
    // Shots already made keep their prompt and their pixels. A brief that names
    // this person again will say so; see compileBrief's roster warning.
    commit(core, brand.id, (json) => {
      json.characters = brandCharacters(json).filter((c: any) => c.id !== id);
    });
    return { ok: true };
  });

  app.post('/api/brands/:id/scenes', async (req, reply) => {
    const brand = brandOr404(req, reply);
    if (!brand) return;
    const built = sceneRecordFrom((req.body ?? {}) as any);
    if (!built.ok) return reply.status(400).send({ error: built.error });
    try {
      commit(core, brand.id, (json) => {
        json.scenes = [...brandScenes(json), built.scene];
      });
    } catch (err: any) {
      return reply.status(err.statusCode ?? 500).send({ error: err.message });
    }
    return {
      scene: built.scene,
      warnings: lintSceneProse(brand.json, built.scene),
      brand: core.store.getBrand(brand.id),
    };
  });
  app.patch('/api/brands/:id/scenes/:sceneId', async (req, reply) => {
    const brand = brandOr404(req, reply);
    if (!brand) return;
    const id = String((req.params as any).sceneId);
    const base = brandScenes(brand.json).find((s) => s.id === id);
    if (!base) return reply.status(404).send({ error: 'scene not found' });
    const built = sceneRecordFrom((req.body ?? {}) as any, base);
    if (!built.ok) return reply.status(400).send({ error: built.error });
    try {
      commit(core, brand.id, (json) => {
        json.scenes = brandScenes(json).map((s) => (s.id === id ? built.scene : s));
      });
    } catch (err: any) {
      return reply.status(err.statusCode ?? 500).send({ error: err.message });
    }
    return {
      scene: built.scene,
      warnings: lintSceneProse(brand.json, built.scene),
      brand: core.store.getBrand(brand.id),
    };
  });
  app.delete('/api/brands/:id/scenes/:sceneId', async (req, reply) => {
    const brand = brandOr404(req, reply);
    if (!brand) return;
    const id = String((req.params as any).sceneId);
    if (!brandScenes(brand.json).some((s) => s.id === id)) return reply.status(404).send({ error: 'scene not found' });
    commit(core, brand.id, (json) => {
      json.scenes = brandScenes(json).filter((s) => s.id !== id);
    });
    return { ok: true };
  });

  /** Redraw a scene's example. One generation, asked for explicitly. */
  /**
   * Read an existing scene's references again.
   *
   * The same build job a new scene runs, pointed at a record that already
   * exists: same progress card, same cancel, same warnings. It is a button
   * rather than a migration because every run of it spends a real analyzer
   * call, and nobody should be charged for one they did not ask for.
   */
  app.post('/api/brands/:id/scenes/:sceneId/reread', async (req, reply) => {
    const brand = brandOr404(req, reply);
    if (!brand) return;
    const id = String((req.params as any).sceneId);
    const scene = brandScenes(brand.json).find((s) => s.id === id) as CustomScene | undefined;
    if (!scene) return reply.status(404).send({ error: 'scene not found' });
    if (!(scene.refs ?? []).length)
      return reply.status(400).send({ error: 'this scene was written from words, so there is nothing to read again' });
    // One at a time: a second read would spend another analyzer call and race
    // the first one for the same record.
    if (sceneBuildRunning(brand.id, id))
      return reply.status(409).send({ error: 'this scene is already being read again' });
    const body = (req.body ?? {}) as any;
    try {
      return startAssetBuild(await buildDeps(), {
        brandId: brand.id,
        kind: 'scene',
        sceneId: id,
        name: scene.name,
        // A plain re-read used to drop the Direction on the floor: body.correction
        // was the only source, so the analyzer's deciding-word preamble never
        // fired and whatever the Direction excluded came straight back. No new
        // word means the stored word.
        instruction: String(body.correction ?? '').trim() || scene.instruction || undefined,
        imageHashes: [],
      });
    } catch (err: any) {
      return reply.status(err.statusCode ?? 500).send({ error: err.message ?? 'could not start' });
    }
  });

  app.post('/api/brands/:id/scenes/:sceneId/preview', async (req, reply) => {
    const brand = brandOr404(req, reply);
    if (!brand) return;
    const id = String((req.params as any).sceneId);
    const scene = brandScenes(brand.json).find((s) => s.id === id);
    if (!scene) return reply.status(404).send({ error: 'scene not found' });
    const engine = await buildEngine();
    if (!engine) return reply.status(400).send({ error: 'no engine here can draw a preview' });
    // Same evidence the build draws from: this frame has the whole reference
    // budget to itself and produces a card, never a customer's shot.
    const refs = ((scene as CustomScene).refs ?? [])
      .map((r) => String(r?.file ?? '').replace(/^asset:/, ''))
      .filter((h) => /^[a-f0-9]{32}$/.test(h) && core.images.has(h))
      .slice(0, engine.capabilities().maxReferenceImages)
      .map((h) => core.images.pathFor(h));
    const request = {
      prompt: scenePreviewPrompt(scene as CustomScene),
      brand: brandContext(core, brand.id),
      ...(refs.length ? { referenceImages: refs, referenceRoles: refs.map(() => 'scene' as const) } : {}),
      width: scene.width,
      height: scene.height,
      count: 1,
    };
    const engineId = engine.capabilities().id;
    core.ledger.assertUnderCap(engineId, await engine.costEstimate(request).catch(() => 0));
    const result = await engine.generate(request);
    core.ledger.recordCost(engineId, null, result.costUsd);
    const hash = result.images[0];
    if (!hash) return reply.status(500).send({ error: 'the engine returned no image' });
    // Same trim the build path applies. The plate is a conditioning image
    // now, and a redrawn card with baked-in letterbox bars would be
    // faithfully reproduced into customer shots.
    const trimmed = await trimEdgeBars(core, hash);
    commit(core, brand.id, (json) => {
      json.scenes = brandScenes(json).map((s) => (s.id === id ? { ...s, preview: `asset:${trimmed}` } : s));
    });
    return { preview: `asset:${trimmed}`, brand: core.store.getBrand(brand.id) };
  });
}

/**
 * A body that replaces a presenter's shots without saying what the preview and
 * avatar should be gets them derived server-side from the new first shot —
 * otherwise the old crops keep pointing at a frame that is no longer in the
 * set (or, on manual create, at nothing at all). An explicit hash always wins.
 * The crop mode is read off the record, not assumed: replacing shots with the
 * source photos means saliency, an engine-drawn set means the measured
 * studio geometry.
 */
async function withDerivedCrops(
  core: Core,
  body: Record<string, unknown>,
  base?: { sourceRefs?: { file?: string }[] },
): Promise<Record<string, unknown>> {
  const shots = Array.isArray(body?.shotHashes) ? (body.shotHashes as unknown[]) : null;
  if (!shots?.length || (body.previewHash !== undefined && body.avatarHash !== undefined)) return body;
  const firstShot = `asset:${String(shots[0])}`;
  const firstSource = Array.isArray(body.sourceHashes)
    ? `asset:${String((body.sourceHashes as unknown[])[0])}`
    : base?.sourceRefs?.[0]?.file;
  const derived = await presenterCrops(core, String(shots[0]), presenterCropMode(firstShot, firstSource));
  return {
    ...body,
    ...(body.previewHash === undefined && derived.previewHash ? { previewHash: derived.previewHash } : {}),
    ...(body.avatarHash === undefined && derived.avatarHash ? { avatarHash: derived.avatarHash } : {}),
  };
}
