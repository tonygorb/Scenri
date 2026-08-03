import type { Core, EngineAdapter } from '@scenri/core';
import { createDemoEngine } from '@scenri/engine-demo';
import { createOpenRouterEngine } from '@scenri/engine-openrouter';
import { createReplicateEngine } from '@scenri/engine-replicate';
import { createFalEngine } from '@scenri/engine-fal';
import { createCodexEngine } from '@scenri/engine-codex';

export interface EngineRegistry {
  all(): EngineAdapter[];
  get(id: string): EngineAdapter | null;
}

/** Key lookup order: settings table (set via UI) then environment. */
function keyGetter(core: Core, settingKey: string, envVar: string): () => string | null {
  return () => core.store.getSetting(settingKey) || process.env[envVar] || null;
}

export function createEngineRegistry(core: Core, extra: EngineAdapter[] = []): EngineRegistry {
  const saveImage = (buf: Buffer) => core.images.save(buf);
  const adapters: EngineAdapter[] = [
    createDemoEngine(saveImage),
    createOpenRouterEngine({ getKey: keyGetter(core, 'openrouter_api_key', 'OPENROUTER_API_KEY'), saveImage }),
    createReplicateEngine({ getKey: keyGetter(core, 'replicate_api_token', 'REPLICATE_API_TOKEN'), saveImage }),
    createFalEngine({ getKey: keyGetter(core, 'fal_key', 'FAL_KEY'), saveImage }),
    createCodexEngine({ saveImage }),
    ...extra,
  ];
  const byId = new Map(adapters.map((a) => [a.capabilities().id, a]));
  return {
    all: () => adapters,
    get: (id) => byId.get(id) ?? null,
  };
}
