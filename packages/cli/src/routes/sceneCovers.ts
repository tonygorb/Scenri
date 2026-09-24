import type { Core } from '@scenri/core';
import type { FastifyInstance } from 'fastify';
import { commit } from '../assetRecords.js';
import { isSceneView, type Scene, type SceneView } from '../scenes.js';

/**
 * Where a brand keeps which of a catalog scene's views it shows as its cover:
 * the brand document's own extension space, which the brand spec leaves to the
 * tool that writes it. The brand row carries it, so a cover chosen here reaches
 * every card, picker and chip the way every other brand edit does, with no
 * reload and on every device the library serves.
 */
export const SCENE_COVERS_KEY = 'scenri.scene-covers';

/** The covers a brand chose for catalog scenes, by scene id; only those that differ from the catalog's own. */
export function sceneCoversOf(json: any): Record<string, SceneView> {
  const raw = json?.extensions?.[SCENE_COVERS_KEY];
  if (!raw || typeof raw !== 'object') return {};
  return Object.fromEntries(Object.entries(raw).filter(([, v]) => isSceneView(v))) as Record<string, SceneView>;
}

/**
 * Which view a brand sees as a catalog scene's cover.
 *
 * A catalog scene is packaged content and never changes at run time, so a
 * brand that would rather see its bold frame than its hero keeps that choice
 * on the brand. Nothing here is read by the compiler: a cover never changes
 * what a shot is given.
 */
export function registerSceneCoverRoutes(app: FastifyInstance, deps: { core: Core; scenes: Scene[] }): void {
  const { core, scenes } = deps;

  /** Show this view as the scene's cover; the catalog's own cover clears the choice. */
  app.put('/api/brands/:id/scene-covers/:sceneId', async (req, reply) => {
    const p = req.params as any;
    const brand = core.store.getBrand(String(p.id));
    if (!brand) return reply.status(404).send({ error: 'brand not found' });
    const scene = scenes.find((s) => s.id === String(p.sceneId));
    if (!scene) return reply.status(404).send({ error: 'scene not found' });
    const view = ((req.body ?? {}) as any).view;
    if (!isSceneView(view)) return reply.status(400).send({ error: 'which view?' });
    try {
      commit(core, brand.id, (json) => {
        const covers = sceneCoversOf(json);
        if (view === (scene.cover ?? 'place')) delete covers[scene.id];
        else covers[scene.id] = view;
        const extensions = { ...(json.extensions ?? {}) };
        if (Object.keys(covers).length) extensions[SCENE_COVERS_KEY] = covers;
        else delete extensions[SCENE_COVERS_KEY];
        if (Object.keys(extensions).length) json.extensions = extensions;
        else delete json.extensions;
      });
    } catch (err: any) {
      return reply.status(err.statusCode ?? 500).send({ error: err.message });
    }
    return { brand: core.store.getBrand(brand.id) };
  });
}
