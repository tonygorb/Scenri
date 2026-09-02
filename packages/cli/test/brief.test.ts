import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
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
    // The reference found no seat: it rides in words, and nothing calls it
    // lost. The composer dimmed its chip and said so before the send.
    expect(r.prompt).toContain('was attached but not sent this time');
    expect(r.warnings.join(' ')).not.toMatch(/left out|reads \d/);
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

  it('clamps attachments to what the engine reads and carries the rest in words', () => {
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
    expect(r.prompt).toContain('was attached but not sent this time');
    expect(r.warnings.join(' ')).not.toMatch(/left out/);
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

  // The floor keeps new uploads out of this class, but legacy marks minted
  // before it exist, and the compiler is the one place every path funnels
  // through — so it measures the stored file and says so on the chip.
  it('a small stored mark warns that its fine lettering will not survive', async () => {
    const tiny = await sharp({
      create: { width: 100, height: 40, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } },
    })
      .png()
      .toBuffer();
    const logoHash = core.images.save(tiny);
    const r = compileBrief({ tokens: [{ t: 'mark', imageHash: logoHash }] }, ctx({ brand: brandWithLogo(logoHash) }));
    expect(r.attachments.map((a) => a.role)).toEqual(['brand']);
    expect(r.warnings.join(' ')).toMatch(/only 100px across/);
  });

  it('a comfortable mark rides with no size warning', async () => {
    const ok = await sharp({
      create: { width: 600, height: 600, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } },
    })
      .png()
      .toBuffer();
    const logoHash = core.images.save(ok);
    const r = compileBrief({ tokens: [{ t: 'mark', imageHash: logoHash }] }, ctx({ brand: brandWithLogo(logoHash) }));
    expect(r.warnings).toEqual([]);
  });

  // The same artwork under both roles is one contradiction, not two chips:
  // "reproduce exactly" (mark) and "match its composition" (ref) cannot both
  // hold, and shipping both burned a budget seat on the conflict.
  it('a reference that is byte-identical to the mark rides once, as the mark', () => {
    const logoHash = core.images.save(Buffer.from('logo-bytes'));
    const r = compileBrief(
      {
        tokens: [
          { t: 'mark', imageHash: logoHash },
          { t: 'ref', imageHash: logoHash },
        ],
      },
      ctx({ brand: brandWithLogo(logoHash) }),
    );
    expect(r.attachments).toEqual([{ role: 'brand', label: 'Acme wordmark', hash: logoHash }]);
    expect(r.prompt).not.toContain('Match the composition, lighting and treatment');
    expect(r.warnings).toEqual(['That reference is the same image as your brand mark, so it rides once, as the mark.']);
  });

  // …but only for artwork that is actually the mark: a distinct reference
  // beside a mark is the legitimate mark + composition-ref combination.
  it('a different reference beside the mark still rides as a reference', () => {
    const logoHash = core.images.save(Buffer.from('logo-bytes'));
    const r = compileBrief(
      {
        tokens: [
          { t: 'mark', imageHash: logoHash },
          { t: 'ref', imageHash: refHash },
        ],
      },
      ctx({ brand: brandWithLogo(logoHash) }),
    );
    expect(r.attachments.map((a) => a.role).sort()).toEqual(['brand', 'reference']);
    expect(r.prompt).toContain('Match the composition, lighting and treatment');
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
    // The shed image is the product's SECOND angle; its identity boarded, so
    // the warning stays quiet - it used to claim House Blend was left out.
    expect(r.warnings.join(' ')).not.toContain('House Blend');
  });

  // "reads 0 reference images" was technically true and read like a bug. The
  // loss itself is deliberate: a cap-0 engine still runs, and the words are
  // the only thing carrying the mark, so the warning has to say that plainly.
  it('says an engine that reads no references left the mark out, in words written for that case', () => {
    const logoHash = core.images.save(Buffer.from('logo-bytes'));
    const r = compileBrief(
      { tokens: [{ t: 'mark', imageHash: logoHash }] },
      ctx({ brand: brandWithLogo(logoHash), engineCaps: caps(0, 'Seedream') }),
    );
    expect(r.attachments).toEqual([]);
    expect(r.dropped.map((d) => d.role)).toEqual(['brand']);
    expect(r.warnings.join(' ')).toContain('Seedream reads no reference images');
    expect(r.warnings.join(' ')).toContain('Acme wordmark');
    expect(r.warnings.join(' ')).not.toContain('reads 0');
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

  // Try again posts a stored brief back verbatim, and a stored brief carries
  // the run record of the run that made it. Persisting that record onto the
  // retry described a run that never happened.
  it('a retried brief keeps its inputs and sheds the old run record', async () => {
    const { buildServer } = await import('../src/server.js');
    const { createDemoEngine } = await import('@scenri/engine-demo');
    const mock = createDemoEngine((b) => core.images.save(b));
    const app = buildServer({ core, engines: { all: () => [mock], get: () => mock } });
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
    const created = await app.inject({
      method: 'POST',
      url: '/api/nodes',
      payload: {
        projectId: proj.project.id,
        kind: 'generation',
        engineId: 'demo',
        count: 1,
        brief: {
          tokens: [
            { t: 'text', v: 'hero shot of ' },
            { t: 'product', id: 'p1' },
          ],
          // the stale run record a Try-again drags along
          inherited: [{ t: 'mark', imageHash: 'f'.repeat(32) }],
          rendered: { sizes: [[7, 7]] },
          croppedFrom: [9, 9],
          resizedFrom: [9, 9],
          resampledHops: 99,
          expand: { method: 'model', engineId: 'x', left: 1, top: 1 },
          crop: { left: 0, top: 0, width: 1, height: 1 },
          // a declared INPUT, not a record: it must survive the wash
          quality: 'high',
        },
      },
    });
    expect(created.statusCode).toBe(202);
    const node = await waitDone(app, created.json().id);
    expect(node.brief.inherited).toBeUndefined();
    expect(node.brief.croppedFrom).toBeUndefined();
    expect(node.brief.resizedFrom).toBeUndefined();
    expect(node.brief.resampledHops).toBeUndefined();
    expect(node.brief.expand).toBeUndefined();
    expect(node.brief.crop).toBeUndefined();
    // rendered is this run's own record, never the stale [7,7]
    expect(node.brief.rendered?.sizes?.[0]).not.toEqual([7, 7]);
    expect(node.brief.quality).toBe('high');
    expect(node.brief.tokens).toHaveLength(2);
    await app.close();
  });

  // The composer refuses a photo chip the engine cannot carry, and it learns
  // the room from the preview: the engine's slots, less the source frame on
  // a refine. A wrong or missing cap would make the gate lie in one direction
  // or the other.
  it('the preview says how many photo groups the engine carries', async () => {
    const { buildServer } = await import('../src/server.js');
    const { createDemoEngine } = await import('@scenri/engine-demo');
    const demo = createDemoEngine((b) => core.images.save(b));
    // The demo engine's own generate and edit, behind a five-slot contract:
    // the preview only ever asks an engine for its capabilities.
    const mock = { ...demo, capabilities: () => caps(5) };
    const app = buildServer({ core, engines: { all: () => [mock], get: () => mock } });
    const brand = (
      await app.inject({
        method: 'POST',
        url: '/api/brands',
        payload: { brand: { specVersion: '0.1', ...brandWith(productHash) } },
      })
    ).json();
    const proj = (
      await app.inject({ method: 'POST', url: '/api/projects', payload: { brandId: brand.id, name: 'p' } })
    ).json();
    const brief = {
      tokens: [
        { t: 'text', v: 'hero shot of ' },
        { t: 'product', id: 'p1' },
      ],
    };

    const fresh = await app.inject({
      method: 'POST',
      url: '/api/brief/preview',
      payload: { brief, engineId: 'demo', brandId: brand.id },
    });
    expect(fresh.statusCode).toBe(200);
    expect(fresh.json().cap).toBe(5);

    const created = await app.inject({
      method: 'POST',
      url: '/api/nodes',
      payload: { projectId: proj.project.id, kind: 'generation', engineId: 'demo', count: 1, brief },
    });
    expect(created.statusCode).toBe(202);
    const parent = await waitDone(app, created.json().id);

    const refine = await app.inject({
      method: 'POST',
      url: '/api/brief/preview',
      payload: {
        brief: { tokens: [{ t: 'text', v: 'warmer' }] },
        engineId: 'demo',
        brandId: brand.id,
        parentId: parent.id,
      },
    });
    expect(refine.statusCode).toBe(200);
    // one slot holds the photograph being refined
    expect(refine.json().cap).toBe(4);
    await app.close();
  });

  // Past an engine's photo seats an identity rides as words, by the brief's
  // own order. The route used to refuse the whole generation for a budget
  // loss while the composer said the chip was described; only a photo that
  // does not exist, or an engine that reads no images at all, is fatal.
  it('a budget loss on an engine that reads images generates; a blind engine still refuses', async () => {
    const { buildServer } = await import('../src/server.js');
    const { createDemoEngine } = await import('@scenri/engine-demo');
    const demo = createDemoEngine((b) => core.images.save(b));
    const seven = Array.from({ length: 7 }, (_, i) => ({
      id: `p${i + 1}`,
      name: `Product ${i + 1}`,
      shots: [{ file: `asset:${productHash}`, locked: true }],
    }));
    const brandSpec = { specVersion: '0.1', meta: { name: 'Acme' }, products: seven };
    const tokens = seven.map((p) => ({ t: 'product', id: p.id }));

    const roomy = { ...demo, capabilities: () => caps(5) };
    const app = buildServer({ core, engines: { all: () => [roomy], get: () => roomy } });
    const brand = (await app.inject({ method: 'POST', url: '/api/brands', payload: { brand: brandSpec } })).json();
    const proj = (
      await app.inject({ method: 'POST', url: '/api/projects', payload: { brandId: brand.id, name: 'p' } })
    ).json();
    const created = await app.inject({
      method: 'POST',
      url: '/api/nodes',
      payload: { projectId: proj.project.id, kind: 'generation', engineId: 'demo', count: 1, brief: { tokens } },
    });
    expect(created.statusCode).toBe(202);
    // the two that found no seat still reach the engine as their words
    expect(created.json().prompt).toContain('Product 6');
    expect(created.json().prompt).toContain('Product 7');
    await waitDone(app, created.json().id);
    await app.close();

    const blind = { ...demo, capabilities: () => caps(0) };
    const app2 = buildServer({ core, engines: { all: () => [blind], get: () => blind } });
    const refused = await app2.inject({
      method: 'POST',
      url: '/api/nodes',
      payload: { projectId: proj.project.id, kind: 'generation', engineId: 'demo', count: 1, brief: { tokens } },
    });
    expect(refused.statusCode).toBe(400);
    expect(refused.json().error).toContain('cannot carry enough reference images');
    await app2.close();
  });

  // Re-attaching a carried product at another token shape (an angle, or none)
  // is still the same product: the inherited record must not keep a twin.
  it('an edit re-asking for the carried product records it once', async () => {
    const { buildServer } = await import('../src/server.js');
    const { createDemoEngine } = await import('@scenri/engine-demo');
    const mock = createDemoEngine((b) => core.images.save(b));
    const app = buildServer({ core, engines: { all: () => [mock], get: () => mock } });
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
    const gen = await app.inject({
      method: 'POST',
      url: '/api/nodes',
      payload: {
        projectId: proj.project.id,
        kind: 'generation',
        engineId: 'demo',
        count: 1,
        brief: { tokens: [{ t: 'product', id: 'p1', angle: 'detail' }] },
      },
    });
    const genNode = await waitDone(app, gen.json().id);
    const edit = await app.inject({
      method: 'POST',
      url: '/api/nodes',
      payload: {
        projectId: proj.project.id,
        parentId: genNode.id,
        kind: 'edit',
        engineId: 'demo',
        sourceImage: genNode.images[0],
        brief: {
          tokens: [
            { t: 'text', v: 'warmer light ' },
            { t: 'product', id: 'p1' },
          ],
        },
      },
    });
    const editNode = await waitDone(app, edit.json().id);
    // the angled twin collapsed into the own copy: nothing product-shaped rides inherited
    expect((editNode.brief.inherited ?? []).filter((t: any) => t.t === 'product')).toHaveLength(0);
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

  it('with two presenters the figure is shared, and nobody is composed out', () => {
    const brand = brandWith(productHash);
    const r = compileBrief(
      {
        tokens: [
          { t: 'character', id: 'c1' },
          { t: 'character', id: 'c2' },
          { t: 'template', id: base.id },
        ],
      },
      withScene() && {
        ...ctx({ templateById: (id: string) => (id === base.id ? base : undefined) }),
        brand: { ...brand, characters: [...brand.characters, { ...brand.characters[0], id: 'c2', name: 'Lena' }] },
      },
    );
    // "one figure, never a second person" composed the second presenter out
    // three times in four on codex; the role is shared, and both are present.
    expect(r.prompt).toContain('The attached presenters share that role');
    expect(r.prompt).not.toContain('never a second person');
    expect(r.prompt).toContain('Marco is in this photograph');
    expect(r.prompt).toContain('Lena is in this photograph');
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

  // The fictional-brands rule and an attached mark were in direct conflict:
  // "resembling no existing brand" read as an instruction to mutate the one
  // real mark the user deliberately attached.
  it('carves the attached brand mark out of the fictional-brands rule', () => {
    const logoHash = core.images.save(Buffer.from('logo-bytes'));
    const brand = { ...brandWith(productHash), logos: [{ role: 'wordmark', file: `asset:${logoHash}` }] };
    const scene = { ...base, figureTreatment: 'the face entirely covered in overlapping printed stickers' };
    const r = compileBrief(
      {
        tokens: [
          { t: 'character', id: 'c1' },
          { t: 'mark', imageHash: logoHash },
          { t: 'template', id: base.id },
        ],
      },
      ctx({ templateById: (id: string) => (id === base.id ? scene : undefined), brand }),
    );
    expect(r.prompt).toContain('plausible but fictional, resembling no existing brand');
    expect(r.prompt).toContain('The one exception is the attached brand mark');
    expect(r.prompt).toContain('the fictional-brands rule above does not apply to it');
    // and the exception speaks the script contract: small non-Latin lettering
    // is exactly what kept being re-spelled under the old wording
    expect(r.prompt).toContain('every character, including the smallest lettering, in its original script');
  });

  it('keeps the fictional-brands rule absolute when no mark is attached', () => {
    const r = compileBrief(
      {
        tokens: [
          { t: 'character', id: 'c1' },
          { t: 'template', id: base.id },
        ],
      },
      withScene({ figureTreatment: 'the face entirely covered in overlapping printed stickers' }),
    );
    expect(r.prompt).toContain('plausible but fictional, resembling no existing brand');
    expect(r.prompt).not.toContain('The one exception is the attached brand mark');
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
  // lettering and the treatment loses. The picture settles it. The fixture
  // scene carries a drawn plate, the shape every engine-built scene has: the
  // plate is what conditions, and the raw upload is evidence for the analyzer.
  const refd = (over: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) =>
    ctx({
      templateById: (id: string) =>
        id === base.id
          ? {
              ...base,
              preview: `asset:${core.images.save(Buffer.from('scene-plate'))}`,
              refs: [{ file: `asset:${productHash}` }],
              ...over,
            }
          : undefined,
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

  // The conditioning-image contract, pinned: exactly ONE image conditions a
  // figure-led generation - the drawn plate when one exists, else refs[0],
  // the first upload. References 2..N reach only the analyzer, as prose. A
  // tester asked whether reference order secretly weights a scene - this is
  // the honest answer, held in place.
  it('with no plate, conditions on refs[0] alone, however many references the scene holds', () => {
    const second = core.images.save(Buffer.from('second-scene-ref'));
    const r = compileBrief(
      { tokens: [{ t: 'template', id: base.id }] },
      ctx({
        templateById: (id: string) =>
          id === base.id
            ? { ...base, refs: [{ file: `asset:${productHash}` }, { file: `asset:${second}` }] }
            : undefined,
      }),
    );
    const scene = r.attachments.filter((a) => a.role === 'scene');
    expect(scene).toHaveLength(1);
    expect(scene[0].hash).toBe(productHash);
  });

  it('prefers the drawn plate over the raw upload, and falls back when there is none', () => {
    const plate = core.images.save(Buffer.from('identity-neutral-plate'));
    const withPlate = compileBrief(
      { tokens: [{ t: 'template', id: base.id }] },
      ctx({
        templateById: (id: string) =>
          id === base.id ? { ...base, preview: `asset:${plate}`, refs: [{ file: `asset:${productHash}` }] } : undefined,
      }),
    );
    const scene = withPlate.attachments.filter((a) => a.role === 'scene');
    expect(scene).toHaveLength(1);
    expect(scene[0].hash).toBe(plate);

    // engine-less scenes have no preview and keep the historical fallback
    const withoutPlate = compileBrief(
      { tokens: [{ t: 'template', id: base.id }] },
      ctx({
        templateById: (id: string) =>
          id === base.id ? { ...base, refs: [{ file: `asset:${productHash}` }] } : undefined,
      }),
    );
    expect(withoutPlate.attachments.filter((a) => a.role === 'scene')[0]?.hash).toBe(productHash);
  });

  // The raw upload is an identity hazard the moment a presenter is selected:
  // it may be a full-bleed photograph of a real person nobody chose. With a
  // plate the question never arises; without one, the scene degrades to
  // prose rather than ship a competing face - and with nobody attached the
  // upload still rides, because there is no selected identity to protect.
  it('with no plate and a presenter attached, the raw upload never rides', () => {
    const noPlate = (tokens: Brief['tokens']) =>
      compileBrief(
        { tokens },
        ctx({
          templateById: (id: string) =>
            id === base.id ? { ...base, refs: [{ file: `asset:${productHash}` }] } : undefined,
        }),
      );
    const withPresenter = noPlate([
      { t: 'character', id: 'c1' },
      { t: 'template', id: base.id },
    ]);
    expect(withPresenter.attachments.map((a) => a.role)).not.toContain('scene');
    expect(withPresenter.prompt).not.toContain("the scene's own photograph");
    // quiet degrade: never tell someone their scene was left out
    expect(withPresenter.warnings.join(' ')).not.toContain(base.name);

    const productOnly = noPlate([
      { t: 'product', id: 'p1' },
      { t: 'template', id: base.id },
    ]);
    expect(productOnly.attachments.filter((a) => a.role === 'scene')[0]?.hash).toBe(productHash);
  });

  it('a vanished plate with a presenter attached also degrades to prose', () => {
    const r = compileBrief(
      {
        tokens: [
          { t: 'character', id: 'c1' },
          { t: 'template', id: base.id },
        ],
      },
      ctx({
        templateById: (id: string) =>
          id === base.id
            ? {
                ...base,
                preview: 'asset:0000000000000000000000000000dead',
                refs: [{ file: `asset:${productHash}` }],
              }
            : undefined,
      }),
    );
    expect(r.attachments.map((a) => a.role)).not.toContain('scene');
  });

  it('a vanished refs[0] attaches nothing and keeps the photo guard unsaid', () => {
    const r = compileBrief(
      { tokens: [{ t: 'template', id: base.id }] },
      ctx({
        templateById: (id: string) =>
          id === base.id ? { ...base, refs: [{ file: 'asset:0000000000000000000000000000dead' }] } : undefined,
      }),
    );
    expect(r.attachments.map((a) => a.role)).not.toContain('scene');
    // the guard describes an image the engine received; without one it is a lie
    expect(r.prompt).not.toContain("the scene's own photograph");
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
    // And the prompt keeps quiet about a photograph the cap forced out: a
    // directive about an image the engine never received is the composer lying.
    expect(r.attachments.map((a) => a.role)).not.toContain('scene');
    expect(r.prompt).not.toContain("the scene's own photograph");
  });

  // The 2026-08 leak: the scene photograph showed a staged demo object and the
  // prose guards only disowned "the scene direction" — the words, never the
  // picture. The picture gets its own disowning, and it names the replacements.
  it('tells the model the scene photograph stages stand-ins, and who replaces them', () => {
    const r = compileBrief(
      {
        tokens: [
          { t: 'product', id: 'p1' },
          { t: 'character', id: 'c1' },
          { t: 'template', id: base.id },
        ],
      },
      refd(),
    );
    expect(r.attachments.map((a) => a.role)).toContain('scene');
    expect(r.prompt).toContain("One attached reference is the scene's own photograph");
    expect(r.prompt).toContain('The product in the scene photograph is not in this shot');
    expect(r.prompt).toContain('Any person in the scene photograph lends their role, never their face');
    // The prose guards keep their rank; the photo guard is the most specific
    // word and comes after them, and after the figure directives it must not
    // argue with.
    const cast = r.prompt.indexOf('describes the set, not the cast');
    const photo = r.prompt.indexOf("the scene's own photograph");
    const figure = r.prompt.indexOf('This world is built around one figure');
    expect(cast).toBeGreaterThan(-1);
    expect(figure).toBeGreaterThan(-1);
    expect(cast).toBeLessThan(photo);
    expect(figure).toBeLessThan(photo);
  });

  it('the photo guard names only what is attached', () => {
    const productOnly = compileBrief(
      {
        tokens: [
          { t: 'product', id: 'p1' },
          { t: 'template', id: base.id },
        ],
      },
      refd(),
    );
    expect(productOnly.prompt).toContain('The product in the scene photograph is not in this shot');
    expect(productOnly.prompt).not.toContain('Any person in the scene photograph');
    const personOnly = compileBrief(
      {
        tokens: [
          { t: 'character', id: 'c1' },
          { t: 'template', id: base.id },
        ],
      },
      refd(),
    );
    expect(personOnly.prompt).toContain('Any person in the scene photograph');
    expect(personOnly.prompt).not.toContain('The product in the scene photograph');
  });

  it('keeps quiet about the photograph on an edit, where none is sent', () => {
    const r = compileBrief(
      {
        tokens: [
          { t: 'product', id: 'p1' },
          { t: 'template', id: base.id },
        ],
      },
      refd({}, { mode: 'edit' as const }),
    );
    expect(r.attachments.map((a) => a.role)).not.toContain('scene');
    expect(r.prompt).not.toContain("the scene's own photograph");
  });
});

// Presenter over reference, for identity: nothing used to relate the two, so
// "match their face exactly" (the presenter) and "match this image" (a ref
// that may contain a stranger) rode side by side. The guard is conditional -
// a lone reference deliberately carrying a person keeps working.
describe('the presenter outranks a reference for identity', () => {
  it('presenter + reference: the guard rides, after the reference directive', () => {
    const r = compileBrief(
      {
        tokens: [
          { t: 'character', id: 'c1' },
          { t: 'ref', imageHash: refHash },
        ],
      },
      ctx(),
    );
    expect(r.prompt).toContain('the attached presenter is the only source of person identity');
    expect(r.prompt).toContain('the attached presenter is that someone');
    const refDirective = r.prompt.indexOf('Match the composition, lighting and treatment');
    const guard = r.prompt.indexOf('the only source of person identity');
    expect(refDirective).toBeGreaterThan(-1);
    expect(guard).toBeGreaterThan(refDirective);
  });

  it('a lone reference stays neutral: no presenter, no guard', () => {
    const r = compileBrief({ tokens: [{ t: 'ref', imageHash: refHash }] }, ctx());
    expect(r.prompt).not.toContain('only source of person identity');
  });

  it('a presenter with no reference has nothing to guard against', () => {
    const r = compileBrief({ tokens: [{ t: 'character', id: 'c1' }] }, ctx());
    expect(r.prompt).not.toContain('only source of person identity');
  });

  it('an edit never emits it: the source frame carries identity there', () => {
    const r = compileBrief(
      {
        tokens: [
          { t: 'character', id: 'c1' },
          { t: 'ref', imageHash: refHash },
        ],
      },
      ctx({ mode: 'edit' as const }),
    );
    expect(r.prompt).not.toContain('only source of person identity');
  });

  it('a reference the cap forced out is not guarded against', () => {
    const r = compileBrief(
      {
        tokens: [
          { t: 'character', id: 'c1' },
          { t: 'ref', imageHash: refHash },
        ],
      },
      ctx({ engineCaps: caps(1) }),
    );
    expect(r.attachments.map((a) => a.role)).not.toContain('reference');
    expect(r.prompt).not.toContain('only source of person identity');
  });
});

// A shed corroboration angle whose essential survived is a quiet degrade, not
// a lost identity: the refine path has filtered dropped names against kept
// labels since 0.6.9, and the generation path used to say the presenter "was
// left out" while their first image had in fact boarded.
describe('the drop warning names only what was fully lost', () => {
  const twoAngles = () => ({
    ...brandWith(productHash),
    products: [
      {
        id: 'p1',
        name: 'House Blend',
        shots: [
          { file: `asset:${productHash}`, locked: true },
          { file: `asset:${core.images.save(Buffer.from('angle-two'))}`, locked: true },
        ],
      },
    ],
  });

  it('a shed second angle stays quiet while the identity rode', () => {
    const r = compileBrief(
      {
        tokens: [
          { t: 'product', id: 'p1' },
          { t: 'character', id: 'c1' },
          { t: 'ref', imageHash: refHash },
        ],
      },
      ctx({ brand: twoAngles(), engineCaps: caps(3) }),
    );
    // p1 essential + c1 essential + ref boarded; p2's second angle dropped
    expect(r.dropped.map((d) => d.label)).toContain('House Blend');
    expect(r.warnings.join(' ')).not.toContain('House Blend');
  });

  it('an identity dropped whole rides in words, and is not called lost', () => {
    const r = compileBrief(
      {
        tokens: [
          { t: 'product', id: 'p1' },
          { t: 'ref', imageHash: refHash },
        ],
      },
      ctx({ engineCaps: caps(1, 'Codex CLI') }),
    );
    expect(r.prompt).toContain('was attached but not sent this time');
    expect(r.warnings.join(' ')).not.toMatch(/left out|House Blend/);
  });
});

// The identity claim names only the kinds that rode. It used to say "the same
// product and the same person" about every inheritance - including a carried
// mood image containing a stranger, whose face the sentence then handed to
// the picture, and product-only threads with no person at all.
describe('the inherited-identity claim covers only what rides', () => {
  const editTokens: Brief['tokens'] = [{ t: 'text', v: 'warmer light' }];

  it('product and person: the legacy sentence, byte for byte', () => {
    const r = compileBrief(
      { tokens: editTokens },
      ctx({ mode: 'edit', inheritedIdentity: { product: true, person: true } }),
    );
    expect(r.prompt).toContain('the same product and the same person that are already in this picture');
  });

  it('product only: no person is claimed', () => {
    const r = compileBrief(
      { tokens: editTokens },
      ctx({ mode: 'edit', inheritedIdentity: { product: true, person: false } }),
    );
    expect(r.prompt).toContain('the same product that is already in this picture');
    expect(r.prompt).not.toContain('and the same person');
  });

  it('person only: no product is claimed', () => {
    const r = compileBrief(
      { tokens: editTokens },
      ctx({ mode: 'edit', inheritedIdentity: { product: false, person: true } }),
    );
    expect(r.prompt).toContain('the same person who is already in this picture');
    expect(r.prompt).not.toContain('the same product and');
  });
});

describe('directives stay truthful to what actually rides', () => {
  const brandWithLogo = (hash: string) => ({
    ...brandWith(productHash, refHash),
    logos: [{ role: 'wordmark', file: `asset:${hash}` }],
  });

  // The failure this whole block exists to prevent: the cap drops a picture
  // and the prompt keeps instructing the model about it. A directive about an
  // image the engine never received is the compiler lying about what was sent.
  it('a budget-dropped mark leaves no mark directive in the prompt', () => {
    const logoHash = core.images.save(Buffer.from('logo-bytes'));
    const r = compileBrief(
      {
        // the mark comes last, so on a two-seat engine it is the one left out:
        // seats go out in the brief's order
        tokens: [
          { t: 'product', id: 'p1' },
          { t: 'character', id: 'c1' },
          { t: 'mark', imageHash: logoHash },
        ],
      },
      ctx({ brand: brandWithLogo(logoHash), engineCaps: caps(2) }),
    );
    expect(r.attachments.map((a) => a.role).sort()).toEqual(['character', 'product']);
    expect(r.dropped.map((d) => `${d.role}:${d.reason}`)).toEqual(['brand:budget']);
    expect(r.prompt).not.toContain('attached brand mark');
    // it is carried in words instead: by name, with the rule that keeps the
    // engine from inventing it
    expect(r.prompt).toContain('was not attached this time; keep every branded surface plain and do not invent a logo');
  });

  it('a budget-dropped reference leaves no composition directive', () => {
    const r = compileBrief(
      {
        // the reference comes last, so on a two-seat engine it is the one left
        // out: seats go out in the brief's order
        tokens: [
          { t: 'product', id: 'p1' },
          { t: 'character', id: 'c1' },
          { t: 'ref', imageHash: refHash },
        ],
      },
      ctx({ brand: brandWith(productHash, core.images.save(Buffer.from('cast-bytes'))), engineCaps: caps(2) }),
    );
    expect(r.dropped.map((d) => d.role)).toEqual(['reference']);
    expect(r.prompt).not.toContain('of the attached reference');
    // no words behind this image: the prompt says only that it did not ride
    expect(r.prompt).toContain('A reference image was attached but not sent this time.');
  });

  it('a budget-dropped reference that was one of our shots is described from that shot', () => {
    const r = compileBrief(
      {
        tokens: [
          { t: 'product', id: 'p1' },
          { t: 'character', id: 'c1' },
          { t: 'ref', imageHash: refHash },
        ],
      },
      ctx({
        brand: brandWith(productHash, core.images.save(Buffer.from('cast-bytes'))),
        engineCaps: caps(2),
        wordsFor: (h) => (h === refHash ? 'a vase on a marble ledge at dusk' : null),
      }),
    );
    expect(r.prompt).toContain(
      'A reference shot was not attached this time; it showed a vase on a marble ledge at dusk. Match that composition, lighting and treatment.',
    );
    expect(r.prompt).not.toContain('of the attached reference');
  });

  it('the fidelity claim counts the angles that rode, not the angles asked for', () => {
    const a2 = core.images.save(Buffer.from('angle-2'));
    const a3 = core.images.save(Buffer.from('angle-3'));
    const brand = {
      ...brandWith(productHash),
      products: [
        {
          id: 'p1',
          name: 'House Blend',
          shots: [{ file: `asset:${productHash}` }, { file: `asset:${a2}` }, { file: `asset:${a3}` }],
        },
      ],
    };
    const r = compileBrief({ tokens: [{ t: 'product', id: 'p1' }] }, ctx({ brand, engineCaps: caps(1) }));
    expect(r.attachments).toHaveLength(1);
    // One image rode, so the singular claim speaks - the plural one told the
    // model three pictures showed the product when it was handed one.
    expect(r.prompt).toContain('The attached product image is the exact product');
    expect(r.prompt).not.toContain('product images all show');
  });

  it('an identity with no usable photo is an essential loss, not a warning nobody reads', () => {
    const gone = 'f'.repeat(32);
    const brand = {
      ...brandWith(productHash),
      products: [{ id: 'p1', name: 'House Blend', shots: [{ file: `asset:${gone}` }] }],
    };
    const r = compileBrief({ tokens: [{ t: 'product', id: 'p1' }] }, ctx({ brand }));
    expect(r.dropped).toEqual([
      { role: 'product', id: 'p1', label: 'House Blend', hash: '', essential: true, reason: 'missing' },
    ]);
    expect(r.warnings.join(' ')).toContain('House Blend has no usable photo');
  });

  it('a presenter with no usable photo is the same essential loss', () => {
    const gone = 'e'.repeat(32);
    const brand = {
      ...brandWith(productHash),
      characters: [{ id: 'c1', name: 'Marco', shots: [{ file: `asset:${gone}` }] }],
    };
    const r = compileBrief({ tokens: [{ t: 'character', id: 'c1' }] }, ctx({ brand }));
    expect(r.dropped).toEqual([
      { role: 'character', id: 'c1', label: 'Marco', hash: '', essential: true, reason: 'missing' },
    ]);
  });

  // Same artwork, two roles, one slot: the identity carries the pixels and
  // the composition contract dies with the reference copy. The mark version
  // of this rule has held since the ref-vs-mark dedupe above.
  it('a reference byte-identical to a product photo rides once, as the product', () => {
    const r = compileBrief(
      {
        tokens: [
          { t: 'product', id: 'p1' },
          { t: 'ref', imageHash: productHash },
        ],
      },
      ctx(),
    );
    expect(r.attachments.map((a) => a.role)).toEqual(['product']);
    expect(r.prompt).not.toContain('Match the composition, lighting and treatment');
    expect(r.warnings.join(' ')).toContain('same image as House Blend');
  });

  // The edit route makes a wider allocation than one compile can see, then
  // compiles the prompt again against the survivors. An empty survivor list
  // must silence every attachment claim even though this compile kept them.
  it('presentAttachments overrides the compile-local allocation for the claims', () => {
    const logoHash = core.images.save(Buffer.from('logo-bytes'));
    const r = compileBrief(
      { tokens: [{ t: 'mark', imageHash: logoHash }] },
      ctx({ brand: brandWithLogo(logoHash), presentAttachments: [] }),
    );
    expect(r.attachments.map((a) => a.role)).toEqual(['brand']);
    expect(r.prompt).not.toContain('attached brand mark');
  });
});
