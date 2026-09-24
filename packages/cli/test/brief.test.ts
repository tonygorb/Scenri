import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { createCore, type Core, type EngineCapabilities } from '@scenri/core';
import { compileBrief, brandRuleDirectives, validateBrief, PRODUCT_REF_MAX, type Brief } from '../src/brief.js';
import { askedView, characterRefs, shotAsksForAPerson } from '../src/briefDirectives.js';
import { loadScenes, sceneResolver, defaultScenesDir } from '../src/scenes.js';
import { waitDone } from './helpers.js';
import { drainTracked, track } from './servers.js';

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
afterEach(async () => {
  await drainTracked();
  try {
    core.close();
  } catch {
    // A drained server closes the core on its way out; closing twice throws.
  }
  rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

/**
 * These contracts were written against scenes that have since left the catalog (the
 * 2026-09-24 refresh). They stay as fixtures, so each contract keeps the scene it was
 * written for instead of being bent to whatever the catalog ships today.
 */
const RETIRED_SCENES = fileURLToPath(new URL('./fixtures/scenes/', import.meta.url));
const allScenes = [...loadScenes(defaultScenesDir()).scenes, ...loadScenes(RETIRED_SCENES).scenes];
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
  it('a person built here carries facial, skin and build prose the way a curated one does', () => {
    const brand = brandWith(productHash);
    (brand.characters[0] as any).origin = 'custom';
    (brand.characters[0] as any).promptName = 'a man in his forties with cropped grey hair';
    (brand.characters[0] as any).facial = 'square jaw, deep-set eyes';
    (brand.characters[0] as any).skin = 'fair with visible freckles';
    (brand.characters[0] as any).build = 'broad shoulders, athletic';
    const r = compileBrief({ tokens: [{ t: 'character', id: 'c1' }] }, ctx({ brand }));
    const who = 'a man in his forties with cropped grey hair';
    expect(r.prompt).toContain(
      `${who}'s face, which must survive every generation unchanged: square jaw, deep-set eyes.`,
    );
    expect(r.prompt).toContain(
      `${who}'s skin, exactly as the reference photographs show it: fair with visible freckles.`,
    );
    expect(r.prompt).toContain(`${who}'s build: broad shoulders, athletic.`);
  });

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

  // A packshot fills its own frame, so the picture says nothing about size.
  // A hand-made product used to carry no words about it either, and came out
  // armchair-sized (2026-09-22).
  it('every product is told it is a real object at its real size, and made to read by the camera', () => {
    const plain = compileBrief({ tokens: [{ t: 'product', id: 'p1' }] }, mkCtx());
    expect(plain.prompt).toContain('It is a real object: keep it at its true real-world size');
    expect(plain.prompt).toContain('never by being enlarged beyond its real size');
    // still named once: the size line points at it, it never names it again
    expect(plain.prompt.match(/House Blend/g)).toHaveLength(1);

    const brand = brandWith(productHash);
    (brand.products[0] as any).description = 'A 250 g bag of whole-bean coffee';
    const described = compileBrief({ tokens: [{ t: 'product', id: 'p1' }] }, ctx({ brand }));
    expect(described.prompt).toContain('What this object physically is: A 250 g bag of whole-bean coffee.');
    expect(described.prompt).not.toContain('It is a real object');

    (brand.products[0] as any).dimensions = '20 cm tall';
    const measured = compileBrief({ tokens: [{ t: 'product', id: 'p1' }] }, ctx({ brand }));
    expect(measured.prompt).toContain('Its real-world size is 20 cm tall');
    expect(measured.prompt).not.toContain('It is a real object');
    expect(measured.prompt.match(/never by being enlarged/g)).toHaveLength(1);
  });

  // 2026-09-23: a phone and a laptop came back as their packshots stood in the
  // room, with the photo's flat light, its lit screen pasted flat and its
  // front-and-back pair repeated (4 of 4, on Codex as on the test engine).
  it('lights a glossy product as a campaign hero, its screen off, and shows it once', () => {
    const alone = compileBrief({ tokens: [{ t: 'product', id: 'p1' }] }, mkCtx());
    expect(alone.prompt).toContain('Where it has glass, a screen, polished metal or a glossy finish');
    expect(alone.prompt).toContain('switched off whatever its product photo shows');
    expect(alone.prompt).toContain('this shot contains exactly one of it');
    expect(alone.prompt).toContain('the camera comes low and close');
    // a presenter's shot keeps the light but not the product's camera
    const withSomeone = compileBrief(
      {
        tokens: [
          { t: 'character', id: 'c1' },
          { t: 'text', v: ' with ' },
          { t: 'product', id: 'p1' },
        ],
      },
      mkCtx(),
    );
    expect(withSomeone.prompt).toContain('Where it has glass');
    expect(withSomeone.prompt).not.toContain('the camera comes low and close');
    const edit = compileBrief({ tokens: [{ t: 'product', id: 'p1' }] }, ctx({ mode: 'edit' }));
    expect(edit.prompt).not.toContain('Where it has glass');
    const nothing = compileBrief({ tokens: [{ t: 'text', v: 'a quiet stone room' }] }, mkCtx());
    expect(nothing.prompt).not.toContain('Where it has glass');
  });

  // A screen shows an attached picture only when a product rides and the words
  // bring the picture into the sentence; the model reads what they ask for.
  it('says what a screen displays only when the words put a picture beside a product', () => {
    const tokens = [
      { t: 'text' as const, v: 'Show ' },
      { t: 'ref' as const, imageHash: refHash },
      { t: 'text' as const, v: ' on the screen of ' },
      { t: 'product' as const, id: 'p1' },
    ];
    const screen = compileBrief({ tokens }, mkCtx());
    expect(screen.prompt).toContain('the screen is on and shows it');
    expect(screen.prompt).toContain('never add a screen to a product that has none');
    // a mockup or browser window around the picture is not carried onto the product
    expect(screen.prompt).toContain('only what that screen shows goes onto this one');
    // a phone design on a wide screen becomes the desktop app, not the phone app stretched
    expect(screen.prompt).toContain('its navigation in a sidebar or top bar');
    const chipAlone = compileBrief(
      {
        tokens: [
          { t: 'product', id: 'p1' },
          { t: 'ref', imageHash: refHash },
        ],
      },
      mkCtx(),
    );
    expect(chipAlone.prompt).not.toContain('the screen is on and shows it');
    const noProduct = compileBrief({ tokens: tokens.filter((t) => t.t !== 'product') }, mkCtx());
    expect(noProduct.prompt).not.toContain('the screen is on and shows it');
    const edit = compileBrief({ tokens }, ctx({ mode: 'edit' }));
    expect(edit.prompt).not.toContain('the screen is on and shows it');
    // a refine that names a picture for a screen swaps what the screen shows, and nothing else
    expect(edit.prompt).toContain('that screen now shows that image and nothing of what it showed before');
    const plainEdit = compileBrief({ tokens: [{ t: 'text', v: 'warmer light' }] }, ctx({ mode: 'edit' }));
    expect(plainEdit.prompt).not.toContain('that screen now shows');
  });

  // 2026-09-22: "rests on, hangs from, is worn by or is held by something
  // real" went to every product shot, and a loft shot of a sneaker with nobody
  // attached came back with a man in the armchair wearing it.
  it('never offers a product to be worn or held when nobody is attached to do it', () => {
    const alone = compileBrief({ tokens: [{ t: 'product', id: 'p1' }] }, mkCtx());
    // 2026-09-23: "rests on a real surface" stood every product upright in the
    // middle of the set, a catalogue picture in an art-directed world (Tony);
    // it is held the way the world holds its own things, grounded where they are
    expect(alone.prompt).toContain('This is a campaign image, not a catalogue picture');
    expect(alone.prompt).toContain('resting where they rest, floating only where they float');
    expect(alone.prompt).not.toMatch(/\b(worn|held|wear|hold)\b/i);
    const withSomeone = compileBrief(
      {
        tokens: [
          { t: 'character', id: 'c1' },
          { t: 'text', v: ' with ' },
          { t: 'product', id: 'p1' },
        ],
      },
      mkCtx(),
    );
    expect(withSomeone.prompt).toContain('it is worn, held or placed the way an object of its size and use is');
  });

  // A catalog scene carries no figure of its own. With nobody attached the
  // compiler names the role it is leaving empty rather than letting the prose
  // invent someone; with a presenter it says nothing here, because the guards
  // own the cast and the showcase golden fixture holds those prompts byte for
  // byte.
  const personScene = () => ({
    ...allScenes.find((s) => s.id === 'interiors-marble-kitchen-counter')!,
    subject: 'person' as const,
    name: 'Test Portrait',
  });

  it('a person-only scene without anyone in the cast says so, and leaves the role empty', () => {
    const r = compileBrief({ tokens: [{ t: 'text', v: 'x' }] }, ctx({ template: personScene() }));
    expect(r.warnings.join(' ')).toContain('built around a person');
    expect(r.prompt).toContain('This world is built around one figure: the one person this set is shot around');
    expect(r.prompt).toContain('Nobody is attached to take that role, so the role stays empty');
    expect(r.prompt).toContain(
      'Disregard any person, figure, hand, face or silhouette described in the scene direction',
    );
    expect(r.prompt).not.toContain('nobody in particular');
  });

  it("a person-only scene still gets a person when the brief's own words ask for one", () => {
    const r = compileBrief({ tokens: [{ t: 'text', v: 'a woman holds the jar' }] }, ctx({ template: personScene() }));
    // Anonymous, invented for this photograph: the compiler decided, not the
    // model reading the scene prose as "the direction above".
    expect(r.prompt).toContain('The brief asks for a person and nobody is attached');
    expect(r.prompt).toContain('nobody in particular');
    expect(r.prompt).not.toContain('role stays empty');
    expect(r.prompt).not.toContain('Disregard any person, figure');
  });

  it('a person-only scene with a presenter attached leaves the cast to the guards', () => {
    const r = compileBrief({ tokens: [{ t: 'character', id: 'c1' }] }, ctx({ template: personScene() }));
    expect(r.warnings.join(' ')).not.toContain('built around a person');
    expect(r.prompt).not.toContain('This world is built around one figure');
    expect(r.prompt).toContain('describes the set, not the cast');
  });

  it('a scene not built around a person invents nobody and forbids nobody', () => {
    const r = compileBrief(
      { tokens: [{ t: 'text', v: 'x' }] },
      ctx({ template: allScenes.find((s) => s.id === 'interiors-marble-kitchen-counter')! }),
    );
    expect(r.prompt).not.toContain('built around one figure');
    expect(r.prompt).not.toContain('role stays empty');
  });

  it('a person-only scene on a refinement says nothing about the empty role', () => {
    // The source frame already holds whoever was rendered; "no person" read
    // there is an order to paint someone out.
    const r = compileBrief({ tokens: [{ t: 'text', v: 'x' }] }, ctx({ template: personScene(), mode: 'edit' }));
    expect(r.prompt).not.toContain('built around one figure');
    expect(r.prompt).not.toContain('role stays empty');
    expect(r.prompt).not.toContain('Disregard any person, figure');
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
    expect(r.prompt).toContain('poster in (brand color Terracotta #D96C3B)');
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
    // words beside the chip say what it is for; with none, the old meaning
    expect(r.prompt).toContain('like this the attached image');
    expect(r.prompt).toContain('where they do not say what it is for, match its composition, lighting and treatment');
  });

  // 2026-09-23: "Show [img] on the phone's screen" compiled to "Show on the
  // phone's screen" and the picture went out as a style reference, so the
  // screen came back black (0 of 4). The chip keeps its words; alone, nothing
  // about it changes.
  it('keeps a picture chip in the sentence when words stand beside it, and alone says what it always did', () => {
    const said = compileBrief(
      {
        tokens: [
          { t: 'text', v: 'Show ' },
          { t: 'ref', imageHash: refHash },
          { t: 'text', v: ' on its screen' },
        ],
      },
      ctx(),
    );
    expect(said.prompt).toContain('Show the attached image on its screen');
    expect(said.prompt).toContain("The attached image is used the way this shot's words use it");
    const alone = compileBrief({ tokens: [{ t: 'ref', imageHash: refHash }] }, ctx());
    expect(alone.prompt).toContain('Match the composition, lighting and treatment of the attached reference.');
    expect(alone.prompt).not.toContain('the attached image');
  });

  it('numbers the chips when two pictures are in the sentence', () => {
    const two = core.images.save(Buffer.from('second-reference'));
    const r = compileBrief(
      {
        tokens: [
          { t: 'text', v: 'Show ' },
          { t: 'ref', imageHash: refHash },
          { t: 'text', v: ' on the laptop and use ' },
          { t: 'ref', imageHash: two },
          { t: 'text', v: ' only for colour' },
        ],
      },
      ctx(),
    );
    expect(r.prompt).toContain('Show attached image 1 on the laptop and use attached image 2 only for colour');
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
    const templates = allScenes;
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
    const templates = allScenes;
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
    expect(r.prompt).toContain(
      'Use #1F3D2B as a defining color in the composition, in surfaces, materials and light, never as lettering.',
    );
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
    const app = track(
      buildServer({
        core,
        engines: { all: () => [mock], get: (id: string) => (id === 'demo' ? mock : null) },
      }),
    );

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
    expect(preview.json().prompt).toContain('hero shot of House Blend in (brand color Terracotta #D96C3B)');
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
    const app = track(buildServer({ core, engines: { all: () => [mock], get: () => mock } }));
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
    const app = track(buildServer({ core, engines: { all: () => [mock], get: () => mock } }));
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
    const app = track(buildServer({ core, engines: { all: () => [roomy], get: () => roomy } }));
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
    const app2 = track(buildServer({ core, engines: { all: () => [blind], get: () => blind } }));
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
    const app = track(buildServer({ core, engines: { all: () => [mock], get: () => mock } }));
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
    const app = track(buildServer({ core, engines: { all: () => [mock], get: () => mock } }));
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

  it('a name in the brief is a thing to show, never a word to write', () => {
    const r = compileBrief(
      {
        tokens: [
          { t: 'character', id: 'c1' },
          { t: 'text', v: ' presenting ' },
          { t: 'product', id: 'p1' },
        ],
      },
      ctx(),
    );
    // Four of four codex outputs painted the product names on the wall in
    // gold before this line existed.
    expect(r.prompt).toContain('never text to render');
    expect(r.prompt.indexOf('never text to render')).toBeGreaterThan(r.prompt.indexOf('House Blend'));
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

  it('with nobody attached, leaves the role empty rather than inventing a person', () => {
    const r = compileBrief(
      {
        tokens: [
          { t: 'product', id: 'p1' },
          { t: 'template', id: base.id },
        ],
      },
      withScene(),
    );
    // Until 2026-09-05 an anonymous stand-in filled the role so a figure-led
    // world would not come back as a bare wall. Reversed: a presenter is the
    // only way a person enters a shot, and the brief's own words stay the one
    // way to ask for one without a presenter.
    expect(r.prompt).toContain('This world is built around one figure: one person at close portrait range');
    expect(r.prompt).toContain('Nobody is attached to take that role, so the role stays empty');
    expect(r.prompt).toContain('The frame holds the set, the light and any treatment this world applies');
    expect(r.prompt).not.toContain('nobody in particular');
    expect(r.prompt).not.toContain('Show them unless');
    // The guard repeats it after the camera note, where it outranks the scene
    // prose that still describes the role (the first battery painted that
    // figure from the prose alone).
    const head = r.prompt.indexOf('the role stays empty');
    const guard = r.prompt.indexOf('Disregard any person, figure, hand, face or silhouette');
    expect(guard).toBeGreaterThan(head);
    expect(r.prompt.slice(guard)).toContain(
      '(one person at close portrait range, squared to camera, filling the frame)',
    );
    expect(r.prompt.slice(guard)).toContain(
      'Nobody is in this image: no person, no hands, no reflection or shadow of anyone',
    );
  });

  it("the brief's own words can still ask for a person, and get an anonymous one", () => {
    const r = compileBrief(
      {
        tokens: [
          { t: 'text', v: 'a man in a green shirt reaches for ' },
          { t: 'product', id: 'p1' },
          { t: 'template', id: base.id },
        ],
      },
      withScene(),
    );
    expect(r.prompt).toContain('The brief asks for a person and nobody is attached');
    expect(r.prompt).toContain('nobody in particular');
    expect(r.prompt).not.toContain('role stays empty');
    expect(r.prompt).not.toContain('Disregard any person, figure');
  });

  it('scene prose naming a figure is not the brief asking for one', () => {
    // The scene's own prose describes the role; only the user's text counts.
    const r = compileBrief(
      { tokens: [{ t: 'template', id: base.id }] },
      withScene({ prompt: 'A seamless ground; one figure stands mid-frame, a hand raised.' }),
    );
    expect(r.prompt).toContain('role stays empty');
    expect(r.prompt).toContain('Disregard any person, figure, hand, face or silhouette');
    expect(r.prompt).not.toContain('nobody in particular');
  });

  it('on a refinement the empty role goes unsaid, and an attached presenter still takes it', () => {
    const tokens = (cast: Brief['tokens']) => [...cast, { t: 'template' as const, id: base.id }];
    const nobody = compileBrief({ tokens: tokens([{ t: 'product', id: 'p1' }]) }, { ...withScene(), mode: 'edit' });
    expect(nobody.prompt).not.toContain('built around one figure');
    expect(nobody.prompt).not.toContain('role stays empty');
    expect(nobody.prompt).not.toContain('Disregard any person, figure');
    const someone = compileBrief({ tokens: tokens([{ t: 'character', id: 'c1' }]) }, { ...withScene(), mode: 'edit' });
    expect(someone.prompt).toContain('The attached presenter is that figure');
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
    // No presenter, so there is no identity to reconcile and no claim about
    // one, and no body in shot for the treatment to be said to cover.
    expect(r.prompt).not.toContain('still exactly theirs');
    expect(r.prompt).not.toContain('bodily present');
    expect(r.prompt).toContain('If no person appears in this shot, the treatment does not go with them');
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

  it('a scene with no figure, and no person to leave out, says nothing at all', () => {
    const r = compileBrief(
      {
        tokens: [
          { t: 'product', id: 'p1' },
          { t: 'template', id: base.id },
        ],
      },
      // subject: person with no figure is the catalog shape, covered above
      withScene({ figure: undefined, figureTreatment: undefined, subject: 'either' }),
    );
    expect(r.prompt).not.toContain('built around one figure');
    expect(r.prompt).not.toContain('nobody stands in for them');
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
              // the plate rides for a treatment, the thing its prose cannot carry
              figureTreatment: 'the face entirely covered in overlapping printed stickers',
              ...over,
            }
          : undefined,
      ...extra,
    });

  it('sends a picture when the scene is built around a figure and a presenter takes the role', () => {
    const r = compileBrief(
      {
        tokens: [
          { t: 'character', id: 'c1' },
          { t: 'template', id: base.id },
        ],
      },
      refd(),
    );
    const scene = r.attachments.filter((a) => a.role === 'scene');
    expect(scene).toHaveLength(1);
    expect(scene[0].essential).toBeFalsy();
  });

  // A figure with nothing done to it is a role and a pose, and words carry
  // both. Sent as a picture, its one pose became every presenter shot's pose
  // and a portrait came back full length (battery 2026-09-23).
  it('sends no picture for a figure with no treatment: the role is said in words', () => {
    const r = compileBrief(
      {
        tokens: [
          { t: 'character', id: 'c1' },
          { t: 'template', id: base.id },
        ],
      },
      refd({ figureTreatment: undefined }),
    );
    expect(r.attachments.map((a) => a.role)).not.toContain('scene');
    expect(r.prompt).toContain('This world is built around one figure');
    expect(r.prompt).not.toContain("the scene's own photograph");
  });

  it('sends nothing when the scene is only an environment', () => {
    const r = compileBrief(
      { tokens: [{ t: 'template', id: base.id }] },
      refd({ figure: undefined, figureTreatment: undefined }),
    );
    expect(r.attachments.map((a) => a.role)).not.toContain('scene');
  });

  /*
   * The anchor (CustomScene.anchor): drawn beside the scene's own pictures and
   * made nobody's, it is the world's picture a shot is given. A preview without
   * the flag keeps the rule the tests above pin.
   */
  describe('an anchor', () => {
    const place = { figure: undefined, figureTreatment: undefined, anchor: true as const };
    const sceneOf = (r: ReturnType<typeof compileBrief>) => r.attachments.filter((a) => a.role === 'scene');

    it("rides as the world's picture when nobody is in it, whoever is attached", () => {
      for (const tokens of [
        [{ t: 'template' as const, id: base.id }],
        [
          { t: 'product' as const, id: 'p1' },
          { t: 'template' as const, id: base.id },
        ],
        [
          { t: 'character' as const, id: 'c1' },
          { t: 'template' as const, id: base.id },
        ],
      ]) {
        const r = compileBrief({ tokens }, refd(place));
        const scene = sceneOf(r);
        expect(scene).toHaveLength(1);
        expect(scene[0].essential).toBeFalsy();
        // the shot finds its own frame in it
        expect(r.prompt).toContain('It is not the shot to copy');
      }
    });

    it('sends its drawn picture and never the pictures it was read from', () => {
      const r = compileBrief({ tokens: [{ t: 'template', id: base.id }] }, refd(place));
      expect(sceneOf(r).map((a) => a.hash)).not.toContain(productHash);
    });

    it('with a person in it rides only beside a presenter, who takes their place', () => {
      const figureAnchor = { figureTreatment: undefined, anchor: true as const };
      const alone = compileBrief(
        {
          tokens: [
            { t: 'product', id: 'p1' },
            { t: 'template', id: base.id },
          ],
        },
        refd(figureAnchor),
      );
      expect(sceneOf(alone)).toHaveLength(0);
      expect(alone.prompt).toContain('role stays empty');
      const beside = compileBrief(
        {
          tokens: [
            { t: 'character', id: 'c1' },
            { t: 'template', id: base.id },
          ],
        },
        refd(figureAnchor),
      );
      expect(sceneOf(beside)).toHaveLength(1);
      expect(beside.prompt).toContain('The person in the scene photograph is a stand-in for the attached presenter');
    });

    it('hands its hero object over to an attached product, never its size', () => {
      const r = compileBrief(
        {
          tokens: [
            { t: 'product', id: 'p1' },
            { t: 'template', id: base.id },
          ],
        },
        refd(place),
      );
      expect(r.prompt).toContain('only its hero object stands in for anything attached to this shot');
      expect(r.prompt).toContain('only marks where the attached product goes');
      expect(r.prompt).toContain('at its own size, and that object does not appear');
      // an older picture is never told that: nothing in it stands in
      const older = compileBrief(
        {
          tokens: [
            { t: 'product', id: 'p1' },
            { t: 'character', id: 'c1' },
            { t: 'template', id: base.id },
          ],
        },
        refd(),
      );
      expect(older.prompt).toContain('none of them stands in for anything attached to this shot');
      expect(older.prompt).not.toContain('only marks where the attached product goes');
    });

    it('never rides on a refinement', () => {
      const r = compileBrief({ tokens: [{ t: 'template', id: base.id }] }, refd(place, { mode: 'edit' as const }));
      expect(sceneOf(r)).toHaveLength(0);
    });

    it('gives way to every identity picture, and is never essential', () => {
      const r = compileBrief(
        {
          tokens: [
            { t: 'product', id: 'p1' },
            { t: 'character', id: 'c1' },
            { t: 'template', id: base.id },
          ],
        },
        refd(place, { engineCaps: caps(2) }),
      );
      const kept = r.attachments.map((a) => a.role);
      expect(kept).toEqual(['product', 'character']);
      expect(r.dropped.some((d) => d.role === 'scene')).toBe(true);
      expect(r.dropped.every((d) => !d.essential)).toBe(true);
    });

    // One picture of a scene per shot: a picked one is the scene's picture.
    it('stays home when a picture of the same scene is picked for the shot', () => {
      const preview = core.images.save(Buffer.from('anchor-picked'));
      const hero = core.images.save(Buffer.from('anchor-example-hero'));
      const scene = {
        ...place,
        preview: `asset:${preview}`,
        examples: [{ role: 'hero', file: `asset:${hero}`, from: `asset:${preview}` }],
      };
      for (const picked of [preview, hero]) {
        const r = compileBrief(
          {
            tokens: [
              { t: 'template', id: base.id },
              { t: 'ref', imageHash: picked },
            ],
          },
          refd(scene),
        );
        expect(sceneOf(r)).toHaveLength(0);
        expect(r.attachments.filter((a) => a.role === 'reference').map((a) => a.hash)).toEqual([picked]);
        expect(r.prompt).toContain('Match the composition, lighting and treatment of the attached reference');
      }
    });

    it('never sends its hero, and a cover changes nothing a shot is given', () => {
      const hero = core.images.save(Buffer.from('scene-hero'));
      const tokens = [
        { t: 'product' as const, id: 'p1' },
        { t: 'template' as const, id: base.id },
      ];
      const plain = compileBrief({ tokens }, refd(place));
      for (const cover of ['hero', 'close', 'place']) {
        const covered = compileBrief(
          { tokens },
          refd({ ...place, cover, examples: [{ role: 'hero', file: `asset:${hero}`, from: 'asset:x' }] }),
        );
        expect(covered.prompt).toBe(plain.prompt);
        expect(covered.attachments.map((a) => [a.role, a.hash])).toEqual(
          plain.attachments.map((a) => [a.role, a.hash]),
        );
        expect(covered.attachments.map((a) => a.hash)).not.toContain(hero);
      }
    });

    it('a frame picked to follow sets the camera for a product alone, and the product keeps its own size in it', () => {
      const view = core.images.save(Buffer.from('picked-view'));
      const tokens = (withRef: boolean) => [
        { t: 'product' as const, id: 'p1' },
        { t: 'template' as const, id: base.id },
        ...(withRef ? [{ t: 'ref' as const, imageHash: view }] : []),
      ];
      const alone = compileBrief({ tokens: tokens(false) }, refd(place));
      expect(alone.prompt).toContain("This shot is framed at the product's own scale");
      const picked = compileBrief({ tokens: tokens(true) }, refd(place));
      expect(picked.attachments.some((a) => a.role === 'reference' && a.hash === view)).toBe(true);
      expect(picked.prompt).toContain("The attached reference sets this shot's camera");
      expect(picked.prompt).toContain('never enlarged to fill it');
      expect(picked.prompt).not.toContain("This shot is framed at the product's own scale");
      expect(picked.prompt).not.toContain('the camera comes low and close');
    });
  });

  // A reference's own product never becomes the shot's: the doctrine said it,
  // and nothing in the prompt did.
  it('tells a shot with a product that a reference lends everything but its product', () => {
    const ref = core.images.save(Buffer.from('a-picked-reference'));
    const tokens = [
      { t: 'product' as const, id: 'p1' },
      { t: 'ref' as const, imageHash: ref },
    ];
    const fresh = compileBrief({ tokens }, ctx());
    expect(fresh.prompt).toContain('A reference shot lends its composition, lighting and treatment, never its product');
    const noProduct = compileBrief({ tokens: [{ t: 'ref', imageHash: ref }] }, ctx());
    expect(noProduct.prompt).not.toContain('never its product');
    const edit = compileBrief({ tokens }, ctx({ mode: 'edit' as const }));
    expect(edit.prompt).not.toContain('never its product');
  });

  /**
   * The battery's arm, and the proof it is only that.
   *
   * `SCENRI_SCENE_REFS=n` is how one scene is measured at several reference
   * counts against the same words. Unset it changes nothing, which every test
   * above this one is already asserting; set, it sends the scene's own
   * pictures whatever the scene is and whoever is attached.
   */
  it("sends as many of the scene's own pictures as the battery seam asks for", () => {
    const plain = { figure: undefined, figureTreatment: undefined };
    expect(
      compileBrief({ tokens: [{ t: 'template', id: base.id }] }, refd(plain)).attachments.map((a) => a.role),
    ).not.toContain('scene');

    process.env.SCENRI_SCENE_REFS = '2';
    try {
      const r = compileBrief({ tokens: [{ t: 'template', id: base.id }] }, refd(plain));
      const scene = r.attachments.filter((a) => a.role === 'scene');
      // the drawn plate first, then the uploads, and never more than asked
      expect(scene).toHaveLength(2);
      expect(scene.every((a) => !a.essential)).toBe(true);
    } finally {
      process.env.SCENRI_SCENE_REFS = undefined;
      delete process.env.SCENRI_SCENE_REFS;
    }

    expect(
      compileBrief({ tokens: [{ t: 'template', id: base.id }] }, refd(plain)).attachments.map((a) => a.role),
    ).not.toContain('scene');
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
  // figure-led generation - the drawn plate - and only beside a presenter who
  // takes the role. The raw uploads reach only the analyzer, as prose, however
  // many the scene holds. A tester asked whether reference order secretly
  // weights a scene - this is the honest answer, held in place.
  it('with nobody attached, no scene image rides, plate or not', () => {
    const second = core.images.save(Buffer.from('second-scene-ref'));
    const plate = core.images.save(Buffer.from('identity-neutral-plate'));
    const alone = (scene: Record<string, unknown>) =>
      compileBrief(
        {
          tokens: [
            { t: 'product', id: 'p1' },
            { t: 'template', id: base.id },
          ],
        },
        ctx({ templateById: (id: string) => (id === base.id ? { ...base, ...scene } : undefined) }),
      );
    const rawOnly = alone({ refs: [{ file: `asset:${productHash}` }, { file: `asset:${second}` }] });
    const plated = alone({ preview: `asset:${plate}`, refs: [{ file: `asset:${productHash}` }] });
    for (const r of [rawOnly, plated]) {
      expect(r.attachments.map((a) => a.role)).not.toContain('scene');
      // the guard describes an image the engine received; without one it is a lie
      expect(r.prompt).not.toContain("the scene's own photograph");
      // quiet degrade: the only warning naming the scene is the subject one
      expect(r.warnings.filter((w) => !w.includes('built around a person')).join(' ')).not.toContain(base.name);
      expect(r.prompt).toContain('role stays empty');
    }
  });

  it('with a presenter attached, the drawn plate rides and the raw upload never does', () => {
    const plate = core.images.save(Buffer.from('identity-neutral-plate'));
    const withPresenter = (scene: Record<string, unknown>) =>
      compileBrief(
        {
          tokens: [
            { t: 'character', id: 'c1' },
            { t: 'template', id: base.id },
          ],
        },
        ctx({ templateById: (id: string) => (id === base.id ? { ...base, ...scene } : undefined) }),
      );
    const sticker = 'the face entirely covered in overlapping printed stickers';
    const withPlate = withPresenter({
      preview: `asset:${plate}`,
      refs: [{ file: `asset:${productHash}` }],
      figureTreatment: sticker,
    });
    const scene = withPlate.attachments.filter((a) => a.role === 'scene');
    expect(scene).toHaveLength(1);
    expect(scene[0].hash).toBe(plate);

    // The raw upload may be a full-bleed photograph of a real person nobody
    // chose: a competing identity in the payload. Without a plate the scene
    // degrades to prose rather than ship a face.
    const withoutPlate = withPresenter({ refs: [{ file: `asset:${productHash}` }], figureTreatment: sticker });
    expect(withoutPlate.attachments.map((a) => a.role)).not.toContain('scene');
    expect(withoutPlate.prompt).not.toContain("the scene's own photograph");
    // quiet degrade: never tell someone their scene was left out
    expect(withoutPlate.warnings.join(' ')).not.toContain(base.name);
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
  // picture. The picture gets its own disowning, and it names who replaces the
  // figure. Only the figure: 2026-09-22, "any prop is a stand-in ... at the
  // placement and scale the photograph demonstrates" sized a sneaker to a
  // loft's armchair and took its place.
  it('tells the model the scene photograph is the world: its figure a stand-in, its props only set', () => {
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
    expect(r.prompt).toContain('none of them stands in for anything attached to this shot');
    expect(r.prompt).toContain('Nothing in the scene photograph is this product or measures its size');
    expect(r.prompt).toContain('The person in the scene photograph is a stand-in for the attached presenter');
    expect(r.prompt).toContain('lend their role, never their face');
    expect(r.prompt).not.toMatch(/stand-in's position|placement and scale the scene photograph/);
    // a figure-led plate is its figure's framing, so it is not told to reframe
    expect(r.prompt).not.toContain('It is not the shot to copy');
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
    // nobody attached: no photograph rides, so no guard speaks of one
    expect(productOnly.attachments.map((a) => a.role)).not.toContain('scene');
    expect(productOnly.prompt).not.toContain("the scene's own photograph");
    const personOnly = compileBrief(
      {
        tokens: [
          { t: 'character', id: 'c1' },
          { t: 'template', id: base.id },
        ],
      },
      refd(),
    );
    expect(personOnly.prompt).toContain('The person in the scene photograph is a stand-in');
    expect(personOnly.prompt).not.toContain('Nothing in the scene photograph is this product');
    const both = compileBrief(
      {
        tokens: [
          { t: 'product', id: 'p1' },
          { t: 'character', id: 'c1' },
          { t: 'template', id: base.id },
        ],
      },
      refd(),
    );
    expect(both.prompt).toContain('Nothing in the scene photograph is this product or measures its size');
    expect(both.prompt).toContain('The person in the scene photograph is a stand-in');
  });

  it('a picture of a place with no figure is the world, never the shot to copy', () => {
    // only the battery seam sends one today; what it is told is the same rule
    process.env.SCENRI_SCENE_REFS = '1';
    try {
      const r = compileBrief(
        {
          tokens: [
            { t: 'product', id: 'p1' },
            { t: 'template', id: base.id },
          ],
        },
        refd({ figure: undefined, figureTreatment: undefined, subject: 'either' }),
      );
      expect(r.attachments.map((a) => a.role)).toContain('scene');
      expect(r.prompt).toContain('none of them stands in for anything attached to this shot');
      expect(r.prompt).toContain('It is not the shot to copy');
      expect(r.prompt).toContain('at its own real-world size');
      expect(r.prompt).not.toContain('stand-in for the attached presenter');
    } finally {
      delete process.env.SCENRI_SCENE_REFS;
    }
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
          { t: 'ref', imageHash: refHash },
        ],
      },
      ctx({
        brand: brandWith(productHash),
        engineCaps: caps(1),
        wordsFor: (h) => (h === refHash ? 'a vase on a marble ledge at dusk' : null),
      }),
    );
    expect(r.prompt).toContain(
      'A reference shot was not attached this time; it showed a vase on a marble ledge at dusk. Match that composition, lighting and treatment.',
    );
    expect(r.prompt).not.toContain('of the attached reference');
  });

  it('with a presenter attached, a dropped shot is never described in its own words', () => {
    // The head of another shot's prompt opens with its chips, and a
    // studio-built person's name is a description of them.
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
        wordsFor: (h) => (h === refHash ? 'a woman in her late thirties with shoulder-length auburn hair' : null),
      }),
    );
    expect(r.dropped.map((d) => d.role)).toEqual(['reference']);
    expect(r.prompt).not.toContain('auburn');
    expect(r.prompt).toContain('A reference image was attached but not sent this time.');
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

describe('shotAsksForAPerson: the words that put a person in the shot', () => {
  it('reads people, hands and wearers', () => {
    for (const t of [
      'a woman holds the jar',
      'someone reaching in',
      'two hands cradle it',
      'a model wearing it',
      'the customer',
    ])
      expect(shotAsksForAPerson(t), t).toBe(true);
  });
  it('leaves objects and compounds alone', () => {
    for (const t of ['hand-painted label', 'the watch face', 'an armchair by the window', 'worn kraft edges', 'x'])
      expect(shotAsksForAPerson(t), t).toBe(false);
  });
});

describe('the view a shot asks for', () => {
  it('reads back, profile and three-quarter off the typed words, and nothing off anything else', () => {
    expect(askedView('walking away down the beach')).toBe('back');
    expect(askedView('seen from behind, looking at the sea')).toBe('back');
    expect(askedView('a rear view of the jacket')).toBe('back');
    expect(askedView('in profile against the window')).toBe('profile');
    expect(askedView('a side view of her')).toBe('profile');
    expect(askedView('from the side')).toBe('profile');
    expect(askedView('a three-quarter portrait')).toBe('three-quarter');
    expect(askedView('three quarter view')).toBe('three-quarter');
    expect(askedView('looking over the shoulder')).toBe('three-quarter');
    expect(askedView('an over-the-shoulder glance')).toBe('three-quarter');
    expect(askedView('turned toward the light')).toBe('three-quarter');
    expect(askedView('')).toBeNull();
    expect(askedView('holding the bottle up to camera')).toBeNull();
    // the words are matched whole: a backpack is not a back view
    expect(askedView('a backpack on the back seat')).toBeNull();
    expect(askedView('the profiled aluminium edge')).toBeNull();
  });

  it('characterRefs: the leading view first, the asked view second, the full body third, the rest as stored', () => {
    const studio = [
      { file: 'asset:p', angle: 'portrait' },
      { file: 'asset:f', angle: 'front' },
      { file: 'asset:q', angle: 'three-quarter' },
      { file: 'asset:b', angle: 'back' },
      { file: 'asset:l', angle: 'left' },
      { file: 'asset:r', angle: 'right' },
    ];
    const angles = (shots: { angle?: string }[]) => shots.map((s) => s.angle);
    // no words: the stored order, cut at the cap
    expect(angles(characterRefs(studio, '', 3))).toEqual(['portrait', 'front', 'three-quarter']);
    expect(angles(characterRefs(studio, 'holding it up', 6))).toEqual(angles(studio));
    expect(angles(characterRefs(studio, 'from behind', 3))).toEqual(['portrait', 'back', 'front']);
    expect(angles(characterRefs(studio, 'in profile', 3))).toEqual(['portrait', 'left', 'front']);
    expect(angles(characterRefs(studio, 'three-quarter', 3))).toEqual(['portrait', 'three-quarter', 'front']);
    // the rest follow in stored order once the asked view and the full body have boarded
    expect(angles(characterRefs(studio, 'from behind', 6))).toEqual([
      'portrait',
      'back',
      'front',
      'three-quarter',
      'left',
      'right',
    ]);
    // a profile falls through left, right, then the curated names
    const curated = [
      { file: 'asset:p', angle: 'portrait' },
      { file: 'asset:f', angle: 'front' },
      { file: 'asset:rp', angle: 'right-profile' },
      { file: 'asset:b', angle: 'back' },
    ];
    expect(angles(characterRefs(curated, 'side view', 3))).toEqual(['portrait', 'right-profile', 'front']);
    // no portrait: the first stored shot leads, whatever it is called
    const legacy = [
      { file: 'asset:i', angle: 'identity' },
      { file: 'asset:f', angle: 'front' },
      { file: 'asset:b', angle: 'back' },
    ];
    expect(angles(characterRefs(legacy, 'seen from behind', 2))).toEqual(['identity', 'back']);
    expect(angles(characterRefs(legacy, '', 2))).toEqual(['identity', 'front']);
    // the same file stored twice rides once
    const twice = [
      { file: 'asset:p', angle: 'portrait' },
      { file: 'asset:p', angle: 'front' },
      { file: 'asset:b', angle: 'back' },
    ];
    expect(angles(characterRefs(twice, '', 3))).toEqual(['portrait', 'back']);
    expect(characterRefs([], 'from behind', 3)).toEqual([]);
    expect(characterRefs(studio, 'from behind', 0)).toEqual([]);
  });
});
