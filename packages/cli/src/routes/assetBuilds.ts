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
  cancelSceneBuilds,
  commit,
  forgetAssetBuild,
  getAssetBuild,
  isCustomPresenter,
  lintSceneProse,
  listAssetBuilds,
  presenterCrops,
  presenterRecordFrom,
  drawSceneAnchor,
  duplicatePresenter,
  sceneBuildRunning,
  sceneRecordFrom,
  startAssetBuild,
  trimEdgeBars,
  type Analyzer,
  type AssetBuildDeps,
  type CustomScene,
} from '../customAssets.js';
import { headOf, type SceneExample } from '../assetRecords.js';
import { presenterCropMode } from '../presenterRepair.js';
import { releasePresenter, removeUnreferenced } from '../presenterDrafts.js';
import { cancelSceneStudioFor, heldBySceneStudio } from '../sceneStudio.js';
import { brandContext, COST_PROBE, pickBuildEngine } from './shared.js';

export interface BuildRouteDeps {
  core: Core;
  engines: EngineRegistry;
  analyzer?: Analyzer;
  scenes: Scene[];
  presenters: Presenter[];
  /** So a picture let go of also leaves the thumbnail cache. */
  thumbs?: { evict: (hash: string) => void };
  /** A scene's place picture changed: a run drawing the earlier one stops (sceneExamples.ts). */
  onPlaceChanged?: (brandId: string, sceneId: string) => void;
  /** A scene was deleted: its examples stop and their pictures go. */
  onSceneGone?: (brandId: string, sceneId: string, examples: SceneExample[]) => void;
  /** The studio's hero, drawn with its place (sceneExamples.ts `drawHero`). */
  hero?: AssetBuildDeps['hero'];
}

/**
 * What a build needs, answered fresh each time: the engine that can hold a
 * face right now, the analyzer if codex is here, the filters that already
 * exist. Shared by the asset builds and the presenter drafts, so both pick
 * the same engine by the same rule.
 */
export function makeBuildDeps(deps: BuildRouteDeps): {
  buildEngine: () => Promise<EngineAdapter | null>;
  buildDeps: () => Promise<AssetBuildDeps>;
  analyzer: Analyzer | null;
} {
  const { core, engines, scenes, presenters } = deps;
  const analyzer: Analyzer | null = deps.analyzer ?? createCodexAnalyzer({ runner: engines.codexRunner });
  // The one test seam: the browser suite runs on the demo engine, which is a
  // placeholder the picker would otherwise refuse. Set only by that harness.
  const allowPlaceholder = process.env.SCENRI_DEMO_BUILDS === '1';
  const buildEngine = (): Promise<EngineAdapter | null> => pickBuildEngine(engines, { allowPlaceholder });
  const hooks = { evict: (hash: string) => deps.thumbs?.evict(hash) };
  const buildDeps = async (): Promise<AssetBuildDeps> => ({
    core,
    engine: await buildEngine(),
    analyzer: (await analyzer?.isAvailable())?.ok ? analyzer : null,
    brandContext: (brandId: string) => brandContext(core, brandId),
    ...(deps.onPlaceChanged ? { onPlaceChanged: deps.onPlaceChanged } : {}),
    ...(deps.hero ? { hero: deps.hero } : {}),
    // A draw's leftovers go, but never a picture a studio conversation is still
    // showing: the demo engine draws the same bytes twice, and a real one could.
    release: (hashes: string[]) =>
      removeUnreferenced(
        core,
        hashes.filter((h) => !heldBySceneStudio(h)),
        hooks,
      ),
    // The filters that already exist, so a new asset lands under a tab a
    // person can actually click rather than inventing a category of one.
    vocabulary: { ...facetsOf(scenes), categories: presenterFacetsOf(presenters).categories },
  });
  return { buildEngine, buildDeps, analyzer };
}

export function registerAssetBuildRoutes(app: FastifyInstance, deps: BuildRouteDeps): void {
  const { core } = deps;
  const { buildEngine, buildDeps, analyzer } = makeBuildDeps(deps);
  const hooks = { evict: (hash: string) => deps.thumbs?.evict(hash) };

  /** What a creation flow needs to know before it promises anything. */
  app.get('/api/asset-builds/capabilities', async () => {
    const [engine, probe] = await Promise.all([
      buildEngine(),
      analyzer?.isAvailable() ?? Promise.resolve<{ ok: boolean; reason?: string }>({ ok: false }),
    ]);
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
    // The bulk five-view presenter build is gone: a person is cast one
    // approved view at a time in the studio, on its own routes.
    if (kind === 'presenter')
      return reply
        .status(400)
        .send({ error: 'presenters are cast in the studio now: POST /api/brands/:id/presenter-drafts' });
    if (kind !== 'scene') return reply.status(400).send({ error: 'kind must be scene' });
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
    const built = presenterRecordFrom(await withDerivedCrops(core, storedOnly(core, req.body)));
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
    const built = presenterRecordFrom(await withDerivedCrops(core, storedOnly(core, req.body), base), base);
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
  /**
   * Revert last change: the record this head replaced becomes the head again.
   *
   * An edit that changed a picture was written as a new record with the old
   * one kept and marked superseded, so going back is a swap of two markers:
   * the older record's `supersededBy` is cleared and the current one is
   * pointed at it. Nothing is deleted, and a shot made against either record
   * keeps refining against the pictures it was made from. One step per call.
   */
  app.post('/api/brands/:id/presenters/:presenterId/revert', async (req, reply) => {
    const brand = brandOr404(req, reply);
    if (!brand) return;
    const id = String((req.params as any).presenterId);
    const rows = brandCharacters(brand.json);
    const current = rows.find((c: any) => c.id === id);
    if (!current) return reply.status(404).send({ error: 'presenter not found' });
    if (!isCustomPresenter(current)) return reply.status(400).send({ error: 'this presenter is not editable' });
    const older =
      current.revisionOf && !current.supersededBy ? rows.find((c: any) => c.id === current.revisionOf) : undefined;
    if (!older) return reply.status(400).send({ error: 'nothing to revert' });
    try {
      commit(core, brand.id, (json) => {
        json.characters = brandCharacters(json).map((c: any) => {
          if (c.id === older.id) {
            const { supersededBy: _cleared, ...head } = c;
            return head;
          }
          return c.id === current.id ? { ...c, supersededBy: older.id } : c;
        });
      });
    } catch (err: any) {
      return reply.status(err.statusCode ?? 500).send({ error: err.message });
    }
    const after = core.store.getBrand(brand.id);
    return { presenter: brandCharacters(after?.json).find((c: any) => c.id === older.id), brand: after };
  });
  /**
   * A new saved person from the current accepted record. Same pictures, a
   * new id, no revision link, no generation. The brand comes back so the
   * wall and the pickers show them in the same commit.
   */
  app.post('/api/brands/:id/presenters/:presenterId/duplicate', async (req, reply) => {
    const brand = brandOr404(req, reply);
    if (!brand) return;
    const id = String((req.params as any).presenterId);
    const result = duplicatePresenter(core, brand.id, id, (req.body as any)?.name);
    if (!result.ok) return reply.status(result.status).send({ error: result.error });
    return { presenter: result.presenter, brand: result.brand };
  });
  app.delete('/api/brands/:id/presenters/:presenterId', async (req, reply) => {
    const brand = brandOr404(req, reply);
    if (!brand) return;
    const id = String((req.params as any).presenterId);
    const rows = brandCharacters(brand.json);
    const base = rows.find((c: any) => c.id === id);
    if (!base) return reply.status(404).send({ error: 'presenter not found' });
    if (!isCustomPresenter(base)) return reply.status(400).send({ error: 'this presenter is not editable' });
    // Shots already made keep their prompt and their pixels. A brief that names
    // this person again will say so; see compileBrief's roster warning.
    // The person goes whole: the head and every record it superseded, in one
    // commit. Each revision holds the same person's photographs, and kept
    // behind a deleted head they stayed on disk where nothing lists them.
    const gone = rows.filter((c: any) => c.id === id || headOf(brand.json, c.id) === id);
    const goneIds = new Set(gone.map((c: any) => c.id));
    commit(core, brand.id, (json) => {
      json.characters = brandCharacters(json).filter((c: any) => !goneIds.has(c.id));
    });
    // After the records have left the document, never before: an open editing
    // session ends here rather than drawing on into an orphan, and the pictures
    // nothing else holds are let go. See releasePresenter.
    const assetDeps = await buildDeps();
    for (const record of gone) await releasePresenter(assetDeps, brand.id, record, hooks);
    // The brand comes back, the way every other presenter mutation answers, so
    // the wall, the page, the pickers and the chips all stop showing them in
    // the same commit. Returning `{ok:true}` left every one of them stale until
    // a reload, which is how a deleted presenter stayed on the wall.
    return { ok: true, brand: core.store.getBrand(brand.id) };
  });

  /**
   * The scene each studio conversation saved. Use is one press, but its answer
   * can be lost on the way back (a phone on the LAN, a laptop asleep, a reload
   * while it saved) and the conversation then offers Use again: that second
   * press is answered with the scene the first one made, not a copy of it. In
   * memory, like the jobs: a restart forgets it.
   */
  const savedFrom = new Map<string, string>();

  app.post('/api/brands/:id/scenes', async (req, reply) => {
    const brand = brandOr404(req, reply);
    if (!brand) return;
    const raw = (req.body ?? {}) as any;
    const conversation = typeof raw.conversation === 'string' ? raw.conversation.trim().slice(0, 80) : '';
    const saved = conversation ? `${brand.id}:${conversation}` : null;
    const already = saved ? brandScenes(brand.json).find((s) => s.id === savedFrom.get(saved)) : undefined;
    if (already) return { scene: already, warnings: lintSceneProse(brand.json, already), brand };
    const body = sceneBody(core, raw);
    if ('error' in body) return reply.status(400).send({ error: body.error });
    const built = sceneRecordFrom(body);
    if (!built.ok) return reply.status(400).send({ error: built.error });
    try {
      commit(core, brand.id, (json) => {
        json.scenes = [...brandScenes(json), built.scene];
      });
    } catch (err: any) {
      return reply.status(err.statusCode ?? 500).send({ error: err.message });
    }
    if (saved) savedFrom.set(saved, built.scene.id);
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
    const body = sceneBody(core, req.body);
    if ('error' in body) return reply.status(400).send({ error: body.error });
    const built = sceneRecordFrom(body, base);
    if (!built.ok) return reply.status(400).send({ error: built.error });
    try {
      commit(core, brand.id, (json) => {
        json.scenes = brandScenes(json).map((s) => (s.id === id ? built.scene : s));
      });
    } catch (err: any) {
      return reply.status(err.statusCode ?? 500).send({ error: err.message });
    }
    // What the record held and no longer does (a picture used over, a hero
    // replaced, a reference taken off) is let go of, if nothing else holds it.
    const kept = new Set(picturesOf(built.scene));
    const dropped = picturesOf(base).filter((h) => !kept.has(h));
    if (dropped.length) removeUnreferenced(core, dropped, hooks);
    if (built.scene.preview !== base.preview) deps.onPlaceChanged?.(brand.id, id);
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
    const gone = brandScenes(brand.json).find((s) => s.id === id);
    if (!gone) return reply.status(404).send({ error: 'scene not found' });
    // A read still running over this scene would otherwise finish into a record
    // that is gone, and a studio draw would land on it or redraw it. Stopped
    // first, so no analyzer or engine call is spent on it.
    cancelSceneBuilds(brand.id, id);
    cancelSceneStudioFor(brand.id, id);
    let row: unknown;
    try {
      row = commit(core, brand.id, (json) => {
        json.scenes = brandScenes(json).filter((s) => s.id !== id);
      });
    } catch (err: any) {
      return reply.status(err.statusCode ?? 500).send({ error: err.message });
    }
    // Its examples stop drawing, and their pictures, the scene's alone, go; so
    // do the pictures it was made from and the one it wore, unless another
    // record holds them.
    deps.onSceneGone?.(brand.id, id, gone.examples ?? []);
    removeUnreferenced(core, picturesOf(gone), hooks);
    // The brand comes back, the way every scene and presenter mutation answers,
    // so the wall, the page, the caret menu and the chips all stop showing it in
    // the same commit. Answering `{ok:true}` alone left the card on the wall
    // until a reload while the record was already gone.
    return { ok: true, brand: row };
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
    // The same anchor the studio draws: beside the scene's own pictures, then
    // made nobody's (drawSceneAnchor), or from its words when it has none.
    const own = scene as CustomScene;
    const hashes = (own.refs ?? [])
      .map((r) => /^asset:([a-f0-9]{32})$/.exec(String(r?.file ?? ''))?.[1])
      .filter((h): h is string => !!h);
    let hash: string;
    try {
      hash = await drawSceneAnchor(
        { ...(await buildDeps()), engine },
        { scene: own, hashes, brandId: brand.id, signal: new AbortController().signal },
      );
    } catch (err: any) {
      return reply.status(err.statusCode ?? 500).send({ error: err.message ?? 'the engine returned no image' });
    }
    // Same trim the build path applies. The picture is sent with shots, and a
    // redrawn card with baked-in letterbox bars would be reproduced into them.
    const trimmed = await trimEdgeBars(core, hash);
    commit(core, brand.id, (json) => {
      json.scenes = brandScenes(json).map((s) =>
        s.id === id ? { ...s, preview: `asset:${trimmed}`, anchor: true as const } : s,
      );
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
  base?: { sourceRefs?: { file?: string }[]; shots?: { file?: string; angle?: string }[] },
): Promise<Record<string, unknown>> {
  const shots = Array.isArray(body?.shotHashes) ? (body.shotHashes as unknown[]) : null;
  if (!shots?.length || (body.previewHash !== undefined && body.avatarHash !== undefined)) return body;
  const firstShot = `asset:${String(shots[0])}`;
  const sourceFiles = Array.isArray(body.sourceHashes)
    ? (body.sourceHashes as unknown[]).map((h) => `asset:${String(h)}`)
    : (base?.sourceRefs ?? []).map((s) => s?.file);
  // The leading angle rides in the body when the caller knows it, and is
  // otherwise recovered from the record by hash: a re-order is the same
  // frames in a new order, and a portrait stays a portrait wherever it lands.
  const angles = Array.isArray(body.shotAngles) ? (body.shotAngles as unknown[]) : [];
  const firstAngle = angles[0] ?? base?.shots?.find((s) => s?.file === firstShot)?.angle;
  const derived = await presenterCrops(core, String(shots[0]), presenterCropMode(firstShot, sourceFiles, firstAngle));
  return {
    ...body,
    ...(body.previewHash === undefined && derived.previewHash ? { previewHash: derived.previewHash } : {}),
    ...(body.avatarHash === undefined && derived.avatarHash ? { avatarHash: derived.avatarHash } : {}),
  };
}

const HASH = /^[a-f0-9]{32}$/;
const stored = (core: Core, v: unknown): boolean => HASH.test(String(v)) && core.images.has(String(v));

/**
 * A presenter's body with its pictures checked against the library. The
 * record's own check is the format only, so a well-formed hash of a picture
 * that was let go of, or never uploaded, was saved as a record pointing at
 * nothing: a broken card, and a failed shot. A list keeps what is stored; a
 * single picture that is not is left out, and derived from the shots instead.
 */
function storedOnly(core: Core, raw: unknown): Record<string, unknown> {
  const body = { ...((raw ?? {}) as Record<string, unknown>) };
  for (const k of ['shotHashes', 'sourceHashes']) {
    if (Array.isArray(body[k])) body[k] = (body[k] as unknown[]).filter((h) => stored(core, h));
  }
  for (const k of ['previewHash', 'avatarHash']) {
    if (HASH.test(String(body[k])) && !stored(core, body[k])) delete body[k];
  }
  return body;
}

/**
 * A scene's body with its pictures checked against the library, as a
 * presenter's is. The place it wears is refused when it is gone: a Use of a
 * studio version whose picture was since let go of says so rather than saving
 * a scene that shows nothing. A hero that is gone is left off, and offered
 * again by the scene's page; references keep what is stored.
 */
function sceneBody(core: Core, raw: unknown): Record<string, unknown> | { error: string } {
  const body = { ...((raw ?? {}) as Record<string, unknown>) };
  if (HASH.test(String(body.previewHash)) && !stored(core, body.previewHash))
    return { error: 'That picture of the place is no longer in the library. Draw it again to use it.' };
  if (HASH.test(String(body.heroHash)) && !stored(core, body.heroHash)) {
    delete body.heroHash;
    delete body.heroWith;
  }
  if (Array.isArray(body.refHashes)) body.refHashes = body.refHashes.filter((h) => stored(core, h));
  return body;
}

/** Every stored picture a scene record holds: its references, the place it wears, its examples. */
function picturesOf(scene: CustomScene): string[] {
  const files = [
    ...(scene.refs ?? []).map((r) => r?.file),
    scene.preview,
    ...(scene.examples ?? []).map((e) => e.file),
  ];
  return files.map((f) => /^asset:([a-f0-9]{32})$/.exec(String(f ?? ''))?.[1]).filter((h): h is string => !!h);
}
