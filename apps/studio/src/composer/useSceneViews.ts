import { useEffect, useState } from 'react';
import { api, type Scene, type SceneView } from '../api.js';
import type { CustomScene } from '../brandAssets.js';
import { VIEW_CHIP_NAME } from '../sceneExampleRules.js';

/** One picture of a scene a shot can follow, as the scene chip's picker offers it. */
export interface SceneViewOption {
  view: SceneView;
  /** What the chip calls it ("Block Tower · Close-up"). */
  name: string;
  thumb: string;
  /** In the store already (a scene you made); a catalog frame is copied in when picked. */
  hash: string | null;
}

/** The scene page's order: the hero first, then the place, then the rest. */
const ORDER: readonly SceneView[] = ['hero', 'place', 'close', 'hands', 'angle', 'bold'];
const inOrder = (views: SceneViewOption[]) => [...views].sort((a, b) => ORDER.indexOf(a.view) - ORDER.indexOf(b.view));

/**
 * A scene's own pictures, for following one from its chip. A scene you made has
 * them on its record; a catalog scene's are its frames, asked for once when its
 * picker opens. Nothing is drawn here.
 */
export function useSceneViews(scene: Scene | null): SceneViewOption[] {
  const custom = scene && (scene as Partial<CustomScene>).custom ? (scene as CustomScene) : null;
  const catalogId = scene && !custom ? scene.id : null;
  const [frames, setFrames] = useState<{ id: string; views: SceneViewOption[] } | null>(null);

  useEffect(() => {
    if (!catalogId) return;
    let live = true;
    api
      .sceneFrames(catalogId)
      .then((r) => {
        if (!live) return;
        const views = r.views.map((v) => ({ view: v.view, name: VIEW_CHIP_NAME[v.view], thumb: v.url, hash: null }));
        setFrames({ id: catalogId, views });
      })
      .catch(() => {
        // no frames: the strip is simply not offered
      });
    return () => {
      live = false;
    };
  }, [catalogId]);

  if (custom) {
    const views: SceneViewOption[] = [];
    if (custom.placeUrl && custom.previewHash) {
      views.push({ view: 'place', name: VIEW_CHIP_NAME.place, thumb: custom.placeUrl, hash: custom.previewHash });
    }
    for (const e of custom.examples ?? []) {
      views.push({ view: e.role, name: VIEW_CHIP_NAME[e.role], thumb: e.url, hash: e.hash });
    }
    return inOrder(views);
  }
  return frames && frames.id === catalogId ? inOrder(frames.views) : [];
}
