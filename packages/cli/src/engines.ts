import type { Core, EngineAdapter } from '@scenri/core';
import { createOpenRouterEngine } from '@scenri/engine-openrouter';
import { createReplicateEngine } from '@scenri/engine-replicate';
import { createFalEngine } from '@scenri/engine-fal';
import { createCodexEngine, createRunner, type CodexRunner } from '@scenri/engine-codex';

export interface EngineRegistry {
  all(): EngineAdapter[];
  get(id: string): EngineAdapter | null;
  /**
   * The one codex runner for this process. Engine, setup routes and analyzer
   * all probe through it, so one page load gets one probe, not four, and an
   * invalidation from any of them is seen by all. Absent on registries tests
   * build by hand.
   */
  codexRunner?: CodexRunner;
}

/** Key lookup order: settings table (set via UI) then environment. */
function keyGetter(core: Core, settingKey: string, envVar: string): () => string | null {
  return () => core.store.getSetting(settingKey) || process.env[envVar] || null;
}

export function createEngineRegistry(core: Core, extra: EngineAdapter[] = []): EngineRegistry {
  const saveImage = (buf: Buffer) => core.images.save(buf);
  const codexRunner = createRunner();
  // No demo engine here on purpose. It draws a placeholder gradient and reads
  // zero reference images, so it can neither honour a Product nor a Presenter —
  // it made the picker look like a working option while proving nothing. Tests
  // that want a deterministic stub inject it through `extra`.
  const adapters: EngineAdapter[] = [
    createOpenRouterEngine({ getKey: keyGetter(core, 'openrouter_api_key', 'OPENROUTER_API_KEY'), saveImage }),
    createReplicateEngine({ getKey: keyGetter(core, 'replicate_api_token', 'REPLICATE_API_TOKEN'), saveImage }),
    createFalEngine({ getKey: keyGetter(core, 'fal_key', 'FAL_KEY'), saveImage }),
    createCodexEngine({ saveImage, runner: codexRunner }),
    ...extra,
  ];
  const byId = new Map(adapters.map((a) => [a.capabilities().id, a]));
  return {
    all: () => adapters,
    get: (id) => byId.get(id) ?? null,
    codexRunner,
  };
}
