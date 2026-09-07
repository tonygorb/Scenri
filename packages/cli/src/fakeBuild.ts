/**
 * A scene build that finishes without an engine, an analyzer or a network.
 *
 * The browser suite drives the scene builder end to end: seed, decision, views,
 * review, save. Codex is not on the runner and the demo engine reads no
 * references, so this pair stands in for both under `SCENRI_FAKE_SCENE_BUILD=1`
 * and nowhere else: `serve.ts` hands them to `buildServer`, which hands them to
 * the asset-build routes ahead of the registry. They never appear in the engine
 * picker, and a production start never reads the flag.
 */
import sharp from 'sharp';
import type { Core, EngineAdapter } from '@scenri/core';
import type { SceneDraft } from '@scenri/engine-codex';
import type { Analyzer } from './customAssets.js';

/** Reads a direction into a record the way the real analyzer's shape demands. */
export function fakeAnalyzer(): Analyzer {
  return {
    isAvailable: async () => ({ ok: true }),
    analyze: async (req) => {
      if (req.kind === 'presenter') throw new Error('the fake reads scenes only');
      const words = String(req.instruction ?? '').trim() || 'a quiet place';
      const name = words
        .split(/\s+/)
        .slice(0, 3)
        .map((w) => w.replace(/[^\p{L}\p{N}-]/gu, ''))
        .filter(Boolean)
        .map((w) => w[0].toUpperCase() + w.slice(1))
        .join(' ');
      const draft: SceneDraft = {
        name: name || 'New Place',
        promptName: name || 'a quiet place',
        lighting: 'Soft window light from the left',
        description: `${words[0].toUpperCase()}${words.slice(1)}.`,
        subject: 'either',
        collections: [],
        verticals: [],
        keywords: words.toLowerCase().split(/\s+/).slice(0, 6),
        prompt: `${words[0].toUpperCase()}${words.slice(1)}, described once for the set.`,
        camera: '',
        figure: /portrait/i.test(words) ? 'one person at close portrait range, squared to camera' : '',
        figureTreatment: '',
        coverage: [],
      };
      return draft;
    },
  };
}

/** Draws a plain frame, a different tint every call, after an optional pause. */
export function fakeBuildEngine(core: Core, env: NodeJS.ProcessEnv = process.env): EngineAdapter {
  let calls = 0;
  const delay = Number(env.SCENRI_FAKE_SCENE_BUILD_MS);
  return {
    capabilities: () => ({
      id: 'fake-build',
      displayName: 'Fake build',
      localOnly: true,
      supportsEdit: false,
      supportsMask: false,
      maxReferenceImages: 5,
      placeholder: true,
    }),
    isAvailable: async () => ({ ok: true }),
    costEstimate: async () => 0,
    generate: async (_req, signal) => {
      calls += 1;
      if (Number.isFinite(delay) && delay > 0) {
        await new Promise<void>((resolve, reject) => {
          const t = setTimeout(resolve, delay);
          signal?.addEventListener('abort', () => {
            clearTimeout(t);
            reject(new Error('cancelled'));
          });
        });
      }
      // Distinct bytes per frame: identical solids would share one hash, and a
      // rejected frame's cleanup would take a kept one with it.
      const hue = (calls * 47) % 360;
      const png = await sharp({
        create: {
          width: 1024,
          height: 1280,
          channels: 3,
          background: { r: 40 + hue / 3, g: 60 + (hue % 90), b: 80 + (hue % 60) },
        },
      })
        .png()
        .toBuffer();
      return { images: [core.images.save(png)], costUsd: 0 };
    },
    edit: async () => ({ images: [], costUsd: 0 }),
  };
}
