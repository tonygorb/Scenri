import { api, type SceneView } from '../api.js';
import type { SentenceToken } from '../composer/line/tokens.js';
import { VIEW_CHIP_NAME } from '../sceneExampleRules.js';

/** A Home example's scene chip names one of its views ("angle") where a pick carries that picture's hash. */
export const namesAView = (t: SentenceToken): boolean =>
  t.t === 'template' && typeof t.view === 'string' && Object.hasOwn(VIEW_CHIP_NAME, t.view);

/**
 * A Home example that follows one of its scene's views names the view, because
 * a picked view's hash is the store's own. Opening the example copies that frame
 * in the way picking it does, so the chip lands exactly as a pick makes it; a
 * view that cannot be copied leaves the plain scene. Nothing is copied for an
 * example nobody opens.
 */
export async function withPickedViews(tokens: SentenceToken[]): Promise<SentenceToken[]> {
  return Promise.all(
    tokens.map(async (t) => {
      if (t.t !== 'template' || !namesAView(t)) return t;
      const { view, viewName, ...scene } = t;
      const hash = await api.pickSceneView(t.id, view as SceneView).then(
        (r) => r.hash,
        () => null,
      );
      return hash ? { ...scene, view: hash, ...(viewName ? { viewName } : {}) } : scene;
    }),
  );
}
