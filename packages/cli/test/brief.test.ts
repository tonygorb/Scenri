import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCore, type Core, type EngineCapabilities } from '@scenri/core';
import { compileBrief, brandRuleDirectives, validateBrief, PRODUCT_REF_MAX, type Brief } from '../src/brief.js';
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
    // identity is locked by name; the reference's own wardrobe is released
    expect(r.prompt).toMatch(/face, facial structure, skin, hair and build/);
    expect(r.prompt).toMatch(/capture conditions, not styling direction/i);
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
    expect(r.attachments).toEqual([
      { role: 'product', id: 'p1', label: 'House Blend', hash: productHash, essential: true },
    ]);
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
});

describe('brandRuleDirectives', () => {
  const ruled = () => ({
    ...brandWith(productHash),
    // Everything a kit can hold. Only `rules` may reach a prompt.
    palette: { primary: { hex: '#1F3D2B', name: 'Forest' }, usage: 'Forest dominates packaging' },
    imagery: { mood: 'crafted, unhurried', keywords: ['warm daylight'], avoid: ['neon'] },
    rules: { never: ['competitor logos in frame', 'alcohol'], notes: 'Packaging is always upright' },
  });

  it('emits the standing rules and nothing else the kit holds', () => {
    expect(brandRuleDirectives(ruled())).toEqual([
      'Brand rules — never: competitor logos in frame, alcohol.',
      'Brand rules: Packaging is always upright.',
    ]);
  });

  it('is empty for a brand with no rules, however full the rest of the kit is', () => {
    const { rules, ...noRules } = ruled();
    expect(brandRuleDirectives(noRules)).toEqual([]);
    expect(brandRuleDirectives({})).toEqual([]);
    expect(brandRuleDirectives(undefined)).toEqual([]);
  });

  it('drops blanks and caps the list rather than emitting an empty clause', () => {
    expect(brandRuleDirectives({ rules: { never: ['  ', '', 'alcohol'] } })).toEqual(['Brand rules — never: alcohol.']);
    const many = Array.from({ length: 40 }, (_, i) => `rule${i}`);
    expect(brandRuleDirectives({ rules: { never: many } })[0].split(',').length).toBe(24);
  });

  // A boundary the user wrote needs no token. Everything else about a brand is
  // a chip they place — see the colour and mark cases.
  it('applies to a brief that asked for nothing', () => {
    const r = compileBrief({ tokens: [{ t: 'text', v: 'a mug on a table' }] }, ctx({ brand: ruled() }));
    expect(r.prompt).toContain('Brand rules — never: competitor logos in frame, alcohol.');
  });

  it('never states the palette — the colour chip does that, and better', () => {
    const brand = ruled();
    const r = compileBrief(
      {
        tokens: [
          { t: 'text', v: 'a mug' },
          { t: 'color', hex: '#1F3D2B', name: 'Forest' },
        ],
      },
      ctx({ brand }),
    );
    expect(r.prompt).not.toContain('Brand palette:');
    expect(r.prompt).not.toContain('Brand look');
    expect(r.prompt).toContain('Use #1F3D2B as a defining color in the composition.');
  });

  it('ranks after the shot directives and before the scene guards', () => {
    const r = compileBrief(
      {
        tokens: [
          { t: 'product', id: 'p1' },
          { t: 'template', id: 'studio-polished-pedestal' },
        ],
      },
      ctx({ brand: ruled(), templateById: resolveScene }),
    );
    const product = r.prompt.indexOf('preserve its label');
    const rule = r.prompt.indexOf('Brand rules — never:');
    const guard = r.prompt.indexOf('Disregard any product');
    expect(product).toBeGreaterThan(-1);
    expect(rule).toBeGreaterThan(product);
    expect(guard).toBeGreaterThan(rule);
  });

  // The prefix is what stops an unprefixed prohibition collapsing into a
  // product's own "Avoid:" line and being read as being about the product.
  it('keeps a brand rule distinct from a product avoid', () => {
    const brand = {
      ...ruled(),
      products: [
        { id: 'p1', name: 'House Blend', shots: [{ file: `asset:${productHash}` }], negativeConstraints: ['alcohol'] },
      ],
    };
    const r = compileBrief({ tokens: [{ t: 'product', id: 'p1' }] }, ctx({ brand }));
    expect(r.prompt).toContain('Avoid: alcohol');
    expect(r.prompt).toContain('Brand rules — never: competitor logos in frame, alcohol.');
  });
});

describe('brand mark token', () => {
  const brandWithLogo = (hash: string) => ({
    ...brandWith(productHash),
    logos: [{ role: 'wordmark', file: `asset:${hash}` }],
  });

  it('attaches the mark as a brand-role reference and asks for it to be drawn exactly', () => {
    const logoHash = core.images.save(Buffer.from('logo-bytes'));
    const r = compileBrief({ tokens: [{ t: 'mark', imageHash: logoHash }] }, ctx({ brand: brandWithLogo(logoHash) }));
    expect(r.attachments).toEqual([{ role: 'brand', label: 'Acme wordmark', hash: logoHash }]);
    expect(r.attachments[0].essential).toBeUndefined();
    expect(r.prompt).toContain('reproduce it exactly as drawn');
    expect(r.warnings).toEqual([]);
  });

  it('warns rather than attaching when the mark has left the kit', () => {
    const logoHash = core.images.save(Buffer.from('logo-bytes'));
    const r = compileBrief({ tokens: [{ t: 'mark', imageHash: logoHash }] }, ctx({ brand: brandWith(productHash) }));
    expect(r.attachments).toEqual([]);
    expect(r.warnings).toEqual(['A brand mark in this brief is no longer in the kit.']);
  });

  // The mark loses to the product's identity-carrying shot, never to its spare
  // angles: the user attached the mark by hand, so it boards before any
  // corroboration image — and losing it must still never refuse the shot.
  it('keeps its slot ahead of a second product angle when the engine cap bites', () => {
    const logoHash = core.images.save(Buffer.from('logo-bytes'));
    const a2 = core.images.save(Buffer.from('angle-2'));
    const brand = {
      ...brandWithLogo(logoHash),
      products: [
        {
          id: 'p1',
          name: 'House Blend',
          shots: [{ file: `asset:${productHash}` }, { file: `asset:${a2}` }],
        },
      ],
    };
    const r = compileBrief(
      {
        tokens: [
          { t: 'mark', imageHash: logoHash },
          { t: 'product', id: 'p1' },
        ],
      },
      ctx({ brand, engineCaps: caps(2) }),
    );
    expect(r.attachments.map((a) => a.role)).toEqual(['product', 'brand']);
    expect(r.dropped.map((d) => d.role)).toEqual(['product']);
    expect(r.dropped.some((d) => d.essential)).toBe(false);
    expect(r.warnings.join(' ')).toContain('House Blend');
  });

  // The reported bug, end to end: on a four-slot engine, product angles two
  // and three used to evict the reference the user attached by hand.
  it('a hand-attached reference survives a contested cap ahead of spare angles', () => {
    const logoHash = core.images.save(Buffer.from('logo-bytes'));
    const a2 = core.images.save(Buffer.from('angle-2'));
    const a3 = core.images.save(Buffer.from('angle-3'));
    const userRef = core.images.save(Buffer.from('user-reference'));
    const brand = {
      ...brandWithLogo(logoHash),
      products: [
        {
          id: 'p1',
          name: 'House Blend',
          shots: [{ file: `asset:${productHash}` }, { file: `asset:${a2}` }, { file: `asset:${a3}` }],
        },
      ],
    };
    const r = compileBrief(
      {
        tokens: [
          { t: 'product', id: 'p1' },
          { t: 'ref', imageHash: userRef },
        ],
      },
      ctx({ brand, engineCaps: caps(3) }),
    );
    expect(r.attachments.map((a) => a.role)).toEqual(['product', 'product', 'reference']);
    expect(r.attachments.some((a) => a.hash === userRef)).toBe(true);
    expect(r.referenceImages).toContain(core.images.pathFor(userRef));
    expect(r.dropped.map((d) => d.role)).toEqual(['product']);
  });
});

/**
 * The reference set is an ordered list, and the order carries meaning the
 * product page now teaches out loud: the first image is the one identity hangs
 * on, and only the first PRODUCT_REF_MAX reach an engine at all. A change that
 * quietly re-sorts or over-sends here would not fail any other test, and would
 * show up as a product that came back the wrong colour.
 */
describe('a product reference set is ordered, and the order is the contract', () => {
  /** Five distinct angles, so both the cap and the ordering are observable. */
  const fiveAngles = () => {
    const hashes = ['a', 'b', 'c', 'd', 'e'].map((n) => core.images.save(Buffer.from(`angle-${n}`)));
    return {
      hashes,
      brand: {
        meta: { name: 'Acme' },
        products: [
          {
            id: 'p1',
            name: 'House Blend',
            shots: hashes.map((h, i) => ({ file: `asset:${h}`, angle: ['front', 'side', 'detail', 'back', 'top'][i] })),
          },
        ],
      },
    };
  };

  it('sends the first three, in the order they are stored', () => {
    const { hashes, brand } = fiveAngles();
    const r = compileBrief({ tokens: [{ t: 'product', id: 'p1' }] }, ctx({ brand, engineCaps: caps(6) }));

    expect(r.attachments).toHaveLength(PRODUCT_REF_MAX);
    expect(r.attachments.map((a) => a.hash)).toEqual(hashes.slice(0, PRODUCT_REF_MAX));
  });

  it('marks exactly one reference essential, and it is the first', () => {
    const { hashes, brand } = fiveAngles();
    const r = compileBrief({ tokens: [{ t: 'product', id: 'p1' }] }, ctx({ brand, engineCaps: caps(6) }));

    expect(r.attachments.filter((a) => a.essential)).toHaveLength(1);
    expect(r.attachments[0]).toMatchObject({ hash: hashes[0], essential: true });
  });

  it('reordering the stored set reorders what the engine is sent', () => {
    const { hashes, brand } = fiveAngles();
    // what a "Use first" on the fourth image leaves behind
    brand.products[0].shots = [brand.products[0].shots[3], ...brand.products[0].shots.filter((_, i) => i !== 3)];
    const r = compileBrief({ tokens: [{ t: 'product', id: 'p1' }] }, ctx({ brand, engineCaps: caps(6) }));

    expect(r.attachments[0]).toMatchObject({ hash: hashes[3], essential: true });
    expect(r.attachments.map((a) => a.hash)).toEqual([hashes[3], hashes[0], hashes[1]]);
  });

  it('a requested angle leads, and still counts against the cap', () => {
    const { hashes, brand } = fiveAngles();
    const r = compileBrief(
      { tokens: [{ t: 'product', id: 'p1', angle: 'back' }] },
      ctx({ brand, engineCaps: caps(6) }),
    );

    expect(r.attachments[0]).toMatchObject({ hash: hashes[3], essential: true });
    expect(r.attachments).toHaveLength(PRODUCT_REF_MAX);
    // no image is sent twice just because it was also asked for by name
    expect(new Set(r.attachments.map((a) => a.hash)).size).toBe(PRODUCT_REF_MAX);
  });

  it('says nothing about coverage it cannot check, however many images there are', () => {
    const { brand } = fiveAngles();
    const r = compileBrief({ tokens: [{ t: 'product', id: 'p1' }] }, ctx({ brand, engineCaps: caps(6) }));

    // A store sends one image per colourway as readily as one per angle, so a
    // count is not evidence that every side is covered.
    expect(r.prompt).not.toMatch(/cover the object from every side/i);
    expect(r.prompt).toMatch(/Any face not visible in them is unknown/i);
  });
});

describe('validateBrief', () => {
  it('accepts a mark token', () => {
    expect(validateBrief({ tokens: [{ t: 'mark', imageHash: 'abc' }] })).toEqual([]);
    expect(validateBrief({ tokens: [] })).toEqual([]);
  });
  // A draft saved while the chip existed must be refused at the boundary, not
  // silently compiled into something it no longer means.
  it('rejects the retired brand token', () => {
    expect(validateBrief({ tokens: [{ t: 'brand' }] })).toEqual(['tokens[0].t "brand" is not a supported token kind']);
  });
  it('rejects a mark with no image', () => {
    expect(validateBrief({ tokens: [{ t: 'mark' }] })).toEqual(['tokens[0].imageHash must be a non-empty string']);
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
    // The warning is user-facing copy, so it names the scene the way the UI
    // does — the short display `name`. The prompt above still brackets the
    // frozen `promptName` ("Marble Quarry Plinth"). That split is deliberate:
    // labels follow the rename, the text sent to the engine never does.
    expect(out.warnings.join(' ')).toContain('Quarry Plinth came first');
    // the second recipe never reaches the prompt
    expect(out.prompt.toLowerCase()).not.toContain('graphic-design');
  });
});

describe('an extend edit drops the dimension promise', () => {
  const editTokens = [{ t: 'text', v: 'golden light' }] as any;

  it('the global preservation directive demands the same dimensions on a plain edit', () => {
    const r = compileBrief({ tokens: editTokens }, ctx({ mode: 'edit' }));
    expect(r.prompt).toContain('the same dimensions');
  });

  it('an explicit extend compiles without it, keeping the rest of the edit prompt', () => {
    const r = compileBrief({ tokens: editTokens }, ctx({ mode: 'edit', editReshape: 'extend' }));
    expect(r.prompt).not.toContain('the same dimensions');
    expect(r.prompt).not.toContain('This is a change to a photograph');
    expect(r.prompt).toContain('golden light');
  });

  it('inherited identity still speaks on an extend', () => {
    const r = compileBrief(
      { tokens: editTokens },
      ctx({ mode: 'edit', editReshape: 'extend', inheritedIdentity: true }),
    );
    expect(r.prompt).not.toContain('the same dimensions');
    // the inherited-identity directive survives the dropped preservation line
    expect(r.prompt).toContain('the same product and the same person that are already in this picture');
  });
});

// A custom scene can be built around a figure - sometimes so completely that the
// figure IS the concept and the art direction is what has been done to them.
// Scene owns the role and the treatment; the presenter owns the face underneath.
describe('compileBrief: a world built around a figure', () => {
  const base = {
    id: 'us-figure',
    name: 'Sticker Face',
    promptName: 'Sticker Face',
    lighting: 'Flat even frontal light',
    description: 'A close portrait on a seamless ground.',
    subject: 'person' as const,
    collections: [],
    verticals: [],
    prompt: 'A seamless warm grey studio ground, flat and shadowless.',
    figure: 'one person at close portrait range, squared to camera, filling the frame',
    width: 1024,
    height: 1280,
  };
  const withScene = (over: Record<string, unknown> = {}) => {
    const scene = { ...base, ...over };
    return ctx({ templateById: (id: string) => (id === base.id ? scene : undefined) });
  };

  it('makes the attached presenter the figure, and refuses a second person', () => {
    const r = compileBrief(
      {
        tokens: [
          { t: 'character', id: 'c1' },
          { t: 'template', id: base.id },
        ],
      },
      withScene(),
    );
    expect(r.prompt).toContain('This world is built around one figure: one person at close portrait range');
    expect(r.prompt).toContain('IS the presenter and never a second person');
    // Presence is personDirectives' job and already stated; this only adds the role.
    expect(r.prompt.indexOf('is in this photograph')).toBeLessThan(
      r.prompt.indexOf('This world is built around one figure'),
    );
  });

  it('with nobody attached, fills the role with an anonymous person rather than an empty room', () => {
    const r = compileBrief(
      {
        tokens: [
          { t: 'product', id: 'p1' },
          { t: 'template', id: base.id },
        ],
      },
      withScene(),
    );
    // The old behaviour left the space deliberately empty, which turned a
    // figure-led scene into a photograph of a bare wall.
    expect(r.prompt).toContain('Someone fills that role in the frame, and they are nobody in particular');
    expect(r.prompt).toContain('no recognisable identity to preserve');
    expect(r.prompt).toContain('Show them unless the direction above asks for no people');
    expect(r.prompt).not.toContain('nobody is invented to fill it');
  });

  it('applies the treatment to the presenter without unmaking them', () => {
    const r = compileBrief(
      {
        tokens: [
          { t: 'character', id: 'c1' },
          { t: 'template', id: base.id },
        ],
      },
      withScene({ figureTreatment: 'the face entirely covered in overlapping printed stickers' }),
    );
    expect(r.prompt).toContain(
      'what has been done to that figure: the face entirely covered in overlapping printed stickers',
    );
    // The reconciliation, in the shape pairDirectives uses: name the scope of the
    // earlier lock rather than contradicting it.
    expect(r.prompt).toContain('The face and body underneath are still exactly theirs');
    expect(r.prompt).toContain('a rule about who they are, which this does not alter');
    // Printed, but invented. Banning all printing produced blank pastel paper;
    // the graphics are the concept, only the real brands must go.
    expect(r.prompt).toContain('Spread it across the whole form');
    expect(r.prompt).toContain('instead of massing it in one area');
    // Reach and amount are stated separately: asking only for reach tripled the
    // count, so fixing the spread quietly broke the sparseness.
    expect(r.prompt).toContain('Reaching wide is not the same as covering more');
    expect(r.prompt).toContain('render it as genuinely designed print');
    expect(r.prompt).toContain('readable words');
    // Invented companies, not gibberish: unreadable lettering was just bad print.
    expect(r.prompt).toContain('plausible but fictional, resembling no existing brand');
    // "Invent" was read as "vary": a real mark in the reference came back with a
    // word bolted onto it, which is the same brand wearing a hat.
    expect(r.prompt).toContain('do not borrow, extend or re-spell a name that appears in any attached reference');
  });

  it('says an obscured figure is still in the photograph', () => {
    const r = compileBrief(
      {
        tokens: [
          { t: 'character', id: 'c1' },
          { t: 'template', id: base.id },
        ],
      },
      withScene({ figureTreatment: 'reduced to a flat silhouette against the ground' }),
    );
    // personDirectives says "do not reduce them to a reflection or a shadow";
    // an obscuring treatment has to be reconciled with that, not left to fight it.
    expect(r.prompt).toContain('The figure is bodily present and in shot');
    expect(r.prompt).toContain('never a reason to leave them out');
  });

  it('keeps the treatment when the people go, because the treatment is the scene', () => {
    const r = compileBrief(
      {
        tokens: [
          { t: 'product', id: 'p1' },
          { t: 'template', id: base.id },
        ],
      },
      withScene({ figureTreatment: 'the face covered in printed vinyl labels' }),
    );
    // A sticker-face scene asked for without people is still a sticker scene.
    // Suppressing the treatment left a plain product with none of the world in it.
    expect(r.prompt).toContain('the treatment does not go with them');
    expect(r.prompt).toContain('applies to whatever the frame does hold');
    // On top of the product, never redesigning it.
    expect(r.prompt).toContain('its own printed label that its reference shows');
  });

  it('treats the figure with nobody attached too', () => {
    const r = compileBrief(
      {
        tokens: [
          { t: 'product', id: 'p1' },
          { t: 'template', id: base.id },
        ],
      },
      withScene({ figureTreatment: 'the face entirely covered in overlapping printed stickers' }),
    );
    expect(r.prompt).toContain('the face entirely covered in overlapping printed stickers');
    // No presenter, so there is no identity to reconcile and no claim about one.
    expect(r.prompt).not.toContain('still exactly theirs');
  });

  it('ranks after the pair line and before the scene guards', () => {
    const r = compileBrief(
      {
        tokens: [
          { t: 'product', id: 'p1' },
          { t: 'character', id: 'c1' },
          { t: 'template', id: base.id },
        ],
      },
      withScene({ figureTreatment: 'the face entirely covered in overlapping printed stickers' }),
    );
    const pair = r.prompt.indexOf('If the attached product is something a person wears');
    const figure = r.prompt.indexOf('This world is built around one figure');
    const guard = r.prompt.indexOf('describes the set, not the cast');
    expect(pair).toBeGreaterThan(-1);
    expect(guard).toBeGreaterThan(-1);
    expect(pair).toBeLessThan(figure);
    expect(figure).toBeLessThan(guard);
  });

  it('a scene with no figure says nothing at all', () => {
    const r = compileBrief(
      {
        tokens: [
          { t: 'product', id: 'p1' },
          { t: 'template', id: base.id },
        ],
      },
      withScene({ figure: undefined, figureTreatment: undefined }),
    );
    expect(r.prompt).not.toContain('built around one figure');
  });

  // Prose cannot carry a dense graphic treatment: compiled to words it came back
  // as blank paper every time, because three rules in the prompt argue about
  // lettering and the treatment loses. The picture settles it.
  const refd = (over: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) =>
    ctx({
      templateById: (id: string) =>
        id === base.id ? { ...base, refs: [{ file: `asset:${productHash}` }], ...over } : undefined,
      ...extra,
    });

  it('sends a picture when the scene is built around a figure', () => {
    const r = compileBrief({ tokens: [{ t: 'template', id: base.id }] }, refd());
    const scene = r.attachments.filter((a) => a.role === 'scene');
    expect(scene).toHaveLength(1);
    expect(scene[0].essential).toBeFalsy();
  });

  it('sends nothing when the scene is only an environment', () => {
    const r = compileBrief(
      { tokens: [{ t: 'template', id: base.id }] },
      refd({ figure: undefined, figureTreatment: undefined }),
    );
    expect(r.attachments.map((a) => a.role)).not.toContain('scene');
  });

  it('sends nothing on a refinement, where the source frame already holds the world', () => {
    const r = compileBrief({ tokens: [{ t: 'template', id: base.id }] }, refd({}, { mode: 'edit' as const }));
    expect(r.attachments.map((a) => a.role)).not.toContain('scene');
  });

  it('pays for it out of corroboration, never out of an identity', () => {
    const r = compileBrief(
      {
        tokens: [
          { t: 'product', id: 'p1' },
          { t: 'character', id: 'c1' },
          { t: 'template', id: base.id },
        ],
      },
      refd({}, { engineCaps: caps(5) }),
    );
    const kept = r.attachments.map((a) => a.role);
    expect(kept).toContain('scene');
    expect(kept).toContain('product');
    expect(kept).toContain('character');
    expect(r.dropped.every((d) => !d.essential)).toBe(true);
  });

  it('a dropped scene reference never tells someone their scene was left out', () => {
    const r = compileBrief(
      {
        tokens: [
          { t: 'product', id: 'p1' },
          { t: 'character', id: 'c1' },
          { t: 'template', id: base.id },
        ],
      },
      refd({}, { engineCaps: caps(2) }),
    );
    expect(r.warnings.join(' ')).not.toContain(base.name);
  });
});
