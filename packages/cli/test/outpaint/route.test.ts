import type { EngineAdapter, EngineCapabilities } from '@scenri/core';
import { describe, expect, it } from 'vitest';
import { resolveOutpaintRoute } from '../../src/outpaint/route.js';

const fake = (caps: Partial<EngineCapabilities> & { id: string }, available = true): EngineAdapter =>
  ({
    capabilities: () => ({
      displayName: caps.id,
      localOnly: false,
      supportsEdit: true,
      supportsMask: false,
      maxReferenceImages: 0,
      ...caps,
    }),
    isAvailable: async () => ({ ok: available }),
    costEstimate: async () => 0,
    generate: async () => ({ images: [], costUsd: 0 }),
    edit: async () => ({ images: [], costUsd: 0 }),
  }) as unknown as EngineAdapter;

const codex = fake({ id: 'codex-cli', maxReferenceImages: 6 });
const bria = (available = true) => fake({ id: 'fal', supportsOutpaint: true }, available);
const replicate = (available = true) => fake({ id: 'replicate', supportsOutpaint: true }, available);
const demo = fake({ id: 'demo', supportsOutpaint: true, placeholder: true });

describe('resolveOutpaintRoute', () => {
  it('keeps the shot on its own engine when that engine can paint a margin', async () => {
    const fal = bria();
    const route = await resolveOutpaintRoute([fal, codex], fal);
    expect(route.engine.capabilities().id).toBe('fal');
    expect(route.method).toBe('outpaint');
    expect(route.crossed).toBe(false);
  });

  it('sends the margin to a real outpainter when the shot engine cannot do it', async () => {
    // The point of the whole route: a codex shot may be extended by Bria,
    // because the Product lives in the protected region and needs no reference.
    const route = await resolveOutpaintRoute([codex, bria()], codex);
    expect(route.engine.capabilities().id).toBe('fal');
    expect(route.method).toBe('outpaint');
    expect(route.crossed).toBe(true);
  });

  it('falls back to the bed path when no outpainter is connected', async () => {
    const route = await resolveOutpaintRoute([codex], codex);
    expect(route.engine.capabilities().id).toBe('codex-cli');
    expect(route.method).toBe('reframe');
    expect(route.crossed).toBe(false);
  });

  it('does not route to an outpainter that has no key', async () => {
    const route = await resolveOutpaintRoute([codex, bria(false)], codex);
    expect(route.engine.capabilities().id).toBe('codex-cli');
    expect(route.method).toBe('reframe');
  });

  it('never hands real work to a placeholder engine', async () => {
    // demo declares supportsOutpaint so development is not blocked, and it
    // draws gradients. It must not win a search.
    const route = await resolveOutpaintRoute([codex, demo], codex);
    expect(route.engine.capabilities().id).toBe('codex-cli');
    expect(route.method).toBe('reframe');
  });

  it('still uses a placeholder when it is the engine the shot was made on', async () => {
    const route = await resolveOutpaintRoute([demo, codex], demo);
    expect(route.engine.capabilities().id).toBe('demo');
    expect(route.method).toBe('outpaint');
  });

  it('takes the first connected outpainter and does not keep shopping', async () => {
    const route = await resolveOutpaintRoute([codex, bria(), replicate()], codex);
    expect(route.engine.capabilities().id).toBe('fal');
  });

  it('treats an engine that throws on its probe as unavailable', async () => {
    const angry = {
      ...bria(),
      isAvailable: async () => {
        throw new Error('network down');
      },
    } as unknown as EngineAdapter;
    const route = await resolveOutpaintRoute([codex, angry], codex);
    expect(route.method).toBe('reframe');
  });
});
