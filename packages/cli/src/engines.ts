import type { Core, EngineAdapter } from '@scenri/core';
import { createOpenRouterEngine } from '@scenri/engine-openrouter';
import { createReplicateEngine } from '@scenri/engine-replicate';
import { createFalEngine } from '@scenri/engine-fal';
import { CONFLICT_ENV_KEYS, createCodexEngine, createRunner, type CodexRunner } from '@scenri/engine-codex';

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

/** The setting that records which variables the user asked Scenri to ignore. */
export const IGNORE_ENV_KEYS_SETTING = 'codex.ignore_env_keys';

/**
 * Names to keep out of every codex child, read fresh on each spawn so a repair
 * lands on the very next run with no restart.
 *
 * Allowlisted on read as well as on write. The setting is a comma-separated
 * list of variable names, and a list of names that gets removed from a child
 * process is exactly the sort of thing that should not accept arbitrary input
 * from a hand-edited sqlite row.
 */
export function ignoreEnvKeysGetter(core: Core): () => readonly string[] {
  return () =>
    (core.store.getSetting(IGNORE_ENV_KEYS_SETTING) ?? '')
      .split(',')
      .map((name) => name.trim().toUpperCase())
      .filter((name): name is (typeof CONFLICT_ENV_KEYS)[number] =>
        (CONFLICT_ENV_KEYS as readonly string[]).includes(name),
      );
}

export function createEngineRegistry(core: Core, extra: EngineAdapter[] = []): EngineRegistry {
  const saveImage = (buf: Buffer) => core.images.save(buf);
  const codexRunner = createRunner({ ignoreEnvKeys: ignoreEnvKeysGetter(core) });
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
