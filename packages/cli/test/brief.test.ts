import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCore, type Core, type EngineCapabilities } from '@scenri/core';
import { compileBrief, briefLabel, type Brief } from '../src/brief.js';
import { loadScenes, sceneResolver, defaultScenesDir } from '../src/scenes.js';
import { waitDone } from './helpers.js';

let home: string;
let core: Core;
let productHash: string;
let refHash: string;

const caps = (maxReferenceImages: number, displayName = 'Codex CLI'): EngineCapabilities => ({
  id: 'x',
  displayName,
  localOnly: false,
  supportsEdit: true,
  supportsMask: false,
  maxReferenceImages,
});

const brandWith = (productHashRef: string, castHashRef?: string) => ({
  meta: { name: 'Acme' },
  products: [{ id: 'p1', name: 'House Blend', shots: [{ file: `asset:${productHashRef}`, locked: true }] }],
  characters: [{ id: 'c1', name: 'Marco', shots: [{ file: `asset:${castHashRef ?? productHashRef}`, locked: true }] }],
});

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'sc-brief-'));
  core = createCore(home);
  productHash = core.images.save(Buffer.from('product-bytes'));
  refHash = core.images.save(Buffer.from('reference-bytes'));
});
afterEach(() => {
  core.close();
  rmSync(home, { recursive: true, force: true });
});

const allScenes = loadScenes(defaultScenesDir()).scenes;
const resolveScene = sceneResolver(allScenes);
const byId = { get: resolveScene };
/** Context with the real scene library wired for inline scene tokens. */
const mkCtx = () => ctx({ templateById: resolveScene });

const ctx = (over: Partial<Parameters<typeof compileBrief>[1]> = {}) => ({
  brand: brandWith(productHash),
  images: core.images,
  engineCaps: caps(4),
  ...over,
});

describe('compileBrief', () => {
  it('a character names itself, attaches its shot, and asks for the identity to hold', () => {
    const r = compileBrief(
      {
        tokens: [
          { t: 'text', v: 'portrait of ' },
          { t: 'character', id: 'c1' },
        ],
      },
      ctx(),
    );
    expect(r.prompt).toContain('portrait of Marco');
    expect(r.attachments.map((a) => a.role)).toContain('character');
    expect(r.attachments.find((a) => a.role === 'character')!.label).toBe('Marco');
    expect(r.prompt).toContain('same person every time');
    expect(r.warnings).toEqual([]);
  });

  it('a missing cast member warns instead of vanishing silently', () => {
    const r = compileBrief({ tokens: [{ t: 'character', id: 'ghost' }] }, ctx());
    expect(r.warnings.join(' ')).toContain('no longer in your roster');
    expect(r.attachments).toHaveLength(0);
  });

  it('a scene plus a product names the product exactly once', () => {
    const r = compileBrief(
      {
        tokens: [
          { t: 'product', id: 'p1' },
          { t: 'text', v: ' ' },
          { t: 'template', id: 'interiors-marble-kitchen-counter' },
        ],
      },
      mkCtx(),
    );
    expect(r.prompt.match(/House Blend/g)).toHaveLength(1);
    expect(r.prompt).toContain('warm low morning window light');
    // regression: this scene used to bake a fictional demo product ("Hearth &
    // Grain — Toasted Oat Granola") straight into its prompt, which could
    // outshout the real attached product; the guard directive now covers it
    // even if a future scene reintroduces the pattern.
    expect(r.prompt).not.toMatch(/Hearth & Grain|Toasted Oat Granola/);
    expect(r.prompt).toContain('Disregard any product, bottle, package, or brand name');
  });

  it('a person-only scene without anyone in the cast says so', () => {
    const personScene = {
      ...allScenes.find((s) => s.id === 'interiors-marble-kitchen-counter')!,
      subject: 'person' as const,
      name: 'Test Portrait',
    };
    const r = compileBrief({ tokens: [{ t: 'text', v: 'x' }] }, ctx({ template: personScene }));
    expect(r.warnings.join(' ')).toContain('built around a person');
  });

  it('product plus character still respects what the engine will read', () => {
    const r = compileBrief(
      {
        tokens: [
          { t: 'product', id: 'p1' },
          { t: 'character', id: 'c1' },
          { t: 'ref', imageHash: refHash },
        ],
      },
      ctx({ engineCaps: caps(2) }),
    );
    expect(r.attachments).toHaveLength(2);
    expect(r.warnings.join(' ')).toMatch(/reads 2 reference images/);
  });

  it('writes prose and tokens in order, attaching the product with a fidelity directive', () => {
    const brief: Brief = {
      tokens: [
        { t: 'text', v: 'hero shot of ' },
        { t: 'product', id: 'p1' },
        { t: 'text', v: ' on marble' },
      ],
    };
    const r = compileBrief(brief, ctx());
    expect(r.prompt).toContain('hero shot of House Blend on marble');
    // Phrasing varies by confidence tier (see productFidelityDirective); assert the
    // contract — the product is named as exact and must not be redesigned.
    expect(r.prompt).toMatch(/preserve its label, shape[^.]*colors/i);
    expect(r.prompt).toMatch(/do not redesign it/i);
    // `essential: true` marks the identity-carrying reference — the one a
    // tight engine cap must never shed.
    expect(r.attachments).toEqual([{ role: 'product', label: 'House Blend', hash: productHash, essential: true }]);
    expect(r.referenceImages).toEqual([core.images.pathFor(productHash)]);
    expect(r.productId).toBe('p1');
    expect(r.warnings).toEqual([]);
  });

  it('inlines a color with its hex and adds a palette directive', () => {
    const r = compileBrief(
      {
        tokens: [
          { t: 'text', v: 'poster in ' },
          { t: 'color', hex: '#d96c3b', name: 'Terracotta' },
        ],
      },
      ctx(),
    );
    expect(r.prompt).toContain('poster in Terracotta (#D96C3B)');
    expect(r.prompt).toContain('Use #D96C3B as a defining color');
  });

  it('attaches a reference shot with a matching directive', () => {
    const r = compileBrief(
      {
        tokens: [
          { t: 'text', v: 'like this' },
          { t: 'ref', imageHash: refHash },
        ],
      },
      ctx(),
    );
    expect(r.attachments.map((a) => a.role)).toEqual(['reference']);
    expect(r.prompt).toContain('Match the composition, lighting and treatment');
  });

  it('format sets dimensions, last one wins', () => {
    const r = compileBrief(
      {
        tokens: [
          { t: 'format', id: 'square', w: 1024, h: 1024 },
          { t: 'text', v: 'x' },
          { t: 'format', id: 'story', w: 1080, h: 1920 },
        ],
      },
      ctx(),
    );
    expect([r.width, r.height]).toEqual([1080, 1920]);
  });

  it('clamps attachments to what the engine reads and names what was dropped', () => {
    const r = compileBrief(
      {
        tokens: [
          { t: 'product', id: 'p1' },
          { t: 'ref', imageHash: refHash },
        ],
      },
      ctx({ engineCaps: caps(1, 'Codex CLI') }),
    );
    expect(r.referenceImages).toHaveLength(1);
    expect(r.attachments[0].role).toBe('product');
    expect(r.warnings[0]).toContain('Codex CLI reads 1 reference image');
    expect(r.warnings[0]).toContain('Reference shot');
  });

  it('a template writes the brief and free text becomes art direction', () => {
    const { scenes: templates } = loadScenes(defaultScenesDir());
    const template = templates.find((t) => t.id === 'studio-polished-pedestal')!;
    const r = compileBrief(
      {
        tokens: [
          { t: 'text', v: 'keep it airy' },
          { t: 'product', id: 'p1' },
        ],
        templateId: template.id,
        templateFields: { backdrop: 'oat' },
      },
      ctx({ template }),
    );
    expect(r.prompt).toContain('[Marble Quarry Plinth]');
    expect(r.prompt).toContain('House Blend');
    expect(r.prompt).toContain('monumental quarry scale dwarfing the subject');
    expect(r.prompt).toContain('Art direction: keep it airy');
    expect([r.width, r.height]).toEqual([template.width, template.height]);
  });

  it('warns when a product-hungry template has no product, and when assets vanish', () => {
    const { scenes: templates } = loadScenes(defaultScenesDir());
    const template = templates.find((t) => t.id === 'studio-polished-pedestal')!;
    const noProduct = compileBrief({ tokens: [], templateId: template.id }, ctx({ template }));
    expect(noProduct.warnings.join(' ')).toContain('is built around a product');

    const gone = compileBrief({ tokens: [{ t: 'product', id: 'nope' }] }, ctx());
    expect(gone.warnings.join(' ')).toContain('no longer in the brand kit');
  });

  it('produces a readable label for lists', () => {
    const label = briefLabel(
      {
        tokens: [
          { t: 'text', v: 'hero of ' },
          { t: 'product', id: 'p1' },
          { t: 'text', v: ' in ' },
          { t: 'color', hex: '#D96C3B', name: 'Terracotta' },
        ],
      },
      brandWith(productHash),
    );
    expect(label).toBe('hero of House Blend in Terracotta');
  });
});

describe('brief through the API', () => {
  it('previews the exact request and stores the brief on the shot', async () => {
    const { buildServer } = await import('../src/server.js');
    const { createDemoEngine } = await import('@scenri/engine-demo');
    const mock = createDemoEngine((b) => core.images.save(b));
    const app = buildServer({
      core,
      engines: { all: () => [mock], get: (id: string) => (id === 'demo' ? mock : null) },
    });

    const brand = (
      await app.inject({
        method: 'POST',
        url: '/api/brands',
        payload: {
          brand: {
            specVersion: '0.1',
            meta: { name: 'Acme' },
            products: [{ id: 'p1', name: 'House Blend', shots: [{ file: `asset:${productHash}`, locked: true }] }],
          },
        },
      })
    ).json();
    const proj = (
      await app.inject({ method: 'POST', url: '/api/projects', payload: { brandId: brand.id, name: 'p' } })
    ).json();

    const brief = {
      tokens: [
        { t: 'text', v: 'hero shot of ' },
        { t: 'product', id: 'p1' },
        { t: 'text', v: ' in ' },
        { t: 'color', hex: '#D96C3B', name: 'Terracotta' },
        { t: 'format', id: 'story', w: 1080, h: 1920 },
      ],
    };

    const preview = await app.inject({
      method: 'POST',
      url: '/api/brief/preview',
      payload: { brief, engineId: 'demo', brandId: brand.id },
    });
    expect(preview.statusCode).toBe(200);
    expect(preview.json().prompt).toContain('hero shot of House Blend in Terracotta (#D96C3B)');
    expect(preview.json().width).toBe(1080);

    const created = await app.inject({
      method: 'POST',
      url: '/api/nodes',
      payload: {
        projectId: proj.project.id,
        kind: 'generation',
        engineId: 'demo',
        count: 1,
        brief,
      },
    });
    expect(created.statusCode).toBe(202);
    expect(created.json().prompt).toContain('House Blend');

    // the engine really runs, so drain it before afterEach closes the database
    const node = await waitDone(app, created.json().id);
    expect(node.brief.tokens).toHaveLength(5); // remix can reopen exactly this
    await app.close();
  });

  it('rejects an empty brief', async () => {
    const { buildServer } = await import('../src/server.js');
    const { createDemoEngine } = await import('@scenri/engine-demo');
    const mock = createDemoEngine((b) => core.images.save(b));
    const app = buildServer({ core, engines: { all: () => [mock], get: () => mock } });
    const brand = (
      await app.inject({
        method: 'POST',
        url: '/api/brands',
        payload: { brand: { specVersion: '0.1', meta: { name: 'A' } } },
      })
    ).json();
    const proj = (
      await app.inject({ method: 'POST', url: '/api/projects', payload: { brandId: brand.id, name: 'p' } })
    ).json();
    const res = await app.inject({
      method: 'POST',
      url: '/api/nodes',
      payload: { projectId: proj.project.id, kind: 'generation', engineId: 'demo', brief: { tokens: [] } },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it('an inline template token compiles where the chip sits', () => {
    const ctx = mkCtx();
    const first = compileBrief(
      {
        tokens: [
          { t: 'template', id: 'studio-polished-pedestal' },
          { t: 'text', v: ' shot at dusk' },
        ],
      },
      ctx,
    );
    const last = compileBrief(
      {
        tokens: [
          { t: 'text', v: 'shot at dusk ' },
          { t: 'template', id: 'studio-polished-pedestal' },
        ],
      },
      ctx,
    );
    // same words, different order: the recipe moves with the chip
    expect(first.prompt.startsWith('[Marble Quarry Plinth]') || first.prompt.length > 40).toBe(true);
    expect(first.prompt.endsWith('shot at dusk')).toBe(true);
    expect(last.prompt.startsWith('shot at dusk')).toBe(true);
    expect(first.prompt).not.toBe(last.prompt);
    // and the template still sets the canvas
    expect(first.width).toBe(last.width);
  });

  it('a templateId brief compiles exactly as before', () => {
    const ctx = mkCtx();
    const direct = compileBrief(
      { tokens: [{ t: 'text', v: 'warm light' }], templateId: 'studio-polished-pedestal' },
      { ...ctx, template: byId.get('studio-polished-pedestal') },
    );
    expect(direct.prompt.startsWith('[Marble Quarry Plinth]')).toBe(true);
    expect(direct.prompt).toContain('Art direction: warm light');
  });

  it('an unknown template token warns instead of vanishing silently', () => {
    const out = compileBrief({ tokens: [{ t: 'template', id: 'nope' }] }, mkCtx());
    expect(out.warnings.join(' ')).toContain('no longer installed');
  });

  it('runs one template even if a brief carries several', () => {
    const out = compileBrief(
      {
        tokens: [
          { t: 'template', id: 'studio-polished-pedestal' },
          { t: 'template', id: 'cut-paper-stage' },
        ],
      },
      mkCtx(),
    );
    expect(out.warnings.join(' ')).toContain('was ignored');
    expect(out.warnings.join(' ')).toContain('Marble Quarry Plinth came first');
    // the second recipe never reaches the prompt
    expect(out.prompt.toLowerCase()).not.toContain('graphic-design');
  });
});
