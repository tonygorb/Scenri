import { describe, it, expect } from 'vitest';
import type { EngineAdapter } from '@scenri/core';
import { pickBuildEngine } from '../src/routes/shared.js';

/** An adapter that is nothing but its capabilities and its availability. */
const engine = (
  id: string,
  refs: number,
  opts: { available?: boolean; placeholder?: boolean } = {},
): EngineAdapter => ({
  capabilities: () => ({
    id,
    displayName: id,
    localOnly: false,
    supportsEdit: true,
    supportsMask: false,
    maxReferenceImages: refs,
    ...(opts.placeholder ? { placeholder: true } : {}),
  }),
  isAvailable: async () => (opts.available === false ? { ok: false, reason: 'off' } : { ok: true }),
  costEstimate: async () => 0,
  generate: async () => ({ images: [], costUsd: 0 }),
  edit: async () => ({ images: [], costUsd: 0 }),
});

const registry = (...all: EngineAdapter[]) => ({ all: () => all });

describe('pickBuildEngine: who draws a person', () => {
  it('prefers codex, then any available engine that can hold a face', async () => {
    const codex = engine('codex-cli', 5);
    const router = engine('openrouter', 4);
    expect((await pickBuildEngine(registry(router, codex)))?.capabilities().id).toBe('codex-cli');
    const codexOff = engine('codex-cli', 5, { available: false });
    expect((await pickBuildEngine(registry(codexOff, router)))?.capabilities().id).toBe('openrouter');
  });

  it('never offers an engine that takes no references, or a placeholder', async () => {
    const blind = engine('fal', 0);
    const demo = engine('demo', 5, { placeholder: true });
    expect(await pickBuildEngine(registry(blind, demo))).toBeNull();
  });

  it('accepts a placeholder only when a test explicitly says so', async () => {
    const demo = engine('demo', 5, { placeholder: true });
    expect((await pickBuildEngine(registry(demo), { allowPlaceholder: true }))?.capabilities().id).toBe('demo');
    // a placeholder that reads nothing still cannot hold a face
    const blindDemo = engine('demo', 0, { placeholder: true });
    expect(await pickBuildEngine(registry(blindDemo), { allowPlaceholder: true })).toBeNull();
  });
});
