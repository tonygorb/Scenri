import { describe, expect, it } from 'vitest';
import {
  customPresenterById,
  customPresentersOf,
  customSceneById,
  customScenesOf,
  headPresenterId,
  newestFirst,
  productsNewestFirst,
  withCustomFirst,
  withHeadPresenters,
} from '../src/brandAssets.js';
import type { Brand } from '../src/api.js';

const HASH_A = 'a'.repeat(32);
const HASH_B = 'b'.repeat(32);
const HASH_C = 'c'.repeat(32);

const brandWith = (json: any): Brand => ({
  id: 'b1',
  slug: 'acme',
  json: { specVersion: '0.1', meta: { name: 'Acme' }, ...json },
  createdAt: '',
  updatedAt: '',
});

const PERSON = {
  id: 'up-1234abcd',
  name: 'Mara',
  origin: 'custom',
  promptName: 'a woman in her early thirties with dark waves',
  presentation: 'woman',
  descriptor: 'Warm editorial',
  ageRange: 'early 30s',
  hair: 'dark waves',
  identityNotes: 'the wide-set eyes must survive',
  negativeConstraints: ['no straightened hair'],
  shots: [{ file: `asset:${HASH_A}` }, { file: `asset:${HASH_B}` }],
  sourceRefs: [{ file: `asset:${HASH_C}` }],
  preview: `asset:${HASH_A}`,
};

const PLACE = {
  id: 'us-9876fedc',
  name: 'Wet Basalt Shore',
  promptName: 'Volcanic Shore at Dusk',
  lighting: 'Low directional sunset',
  description: 'A dark volcanic shoreline.',
  subject: 'product',
  collections: ['Editorial'],
  verticals: ['Beauty'],
  keywords: ['volcanic'],
  prompt: 'A wet dark basalt shelf at low sunset light.',
  width: 1024,
  height: 1280,
  refs: [{ file: `asset:${HASH_C}` }],
  preview: `asset:${HASH_B}`,
  instruction: 'less orange',
};

describe('customPresentersOf', () => {
  it('reads the casting prose and the origin a studio-built person carries, and leaves an older record empty', () => {
    const [p] = customPresentersOf(
      brandWith({
        characters: [
          {
            ...PERSON,
            source: 'photos',
            likeness: { attestedAt: '2026-09-08T00:00:00Z', version: 'v1' },
            facial: 'oval face',
            skin: 'olive',
            build: 'slender',
          },
        ],
      }),
    );
    expect(p.source).toBe('photos');
    expect(p.likeness).toEqual({ attestedAt: '2026-09-08T00:00:00Z', version: 'v1' });
    expect(p.facial).toBe('oval face');
    expect(p.skin).toBe('olive');
    expect(p.build).toBe('slender');
    const [old] = customPresentersOf(brandWith({ characters: [PERSON] }));
    expect(old.source).toBeUndefined();
    expect(old.likeness).toBeUndefined();
    expect(old.facial).toBe('');
  });

  it('reads a person the brand built, in the catalog shape every card takes', () => {
    const [p] = customPresentersOf(brandWith({ characters: [PERSON] }));
    expect(p.id).toBe('up-1234abcd');
    expect(p.name).toBe('Mara');
    expect(p.promptName).toBe('a woman in her early thirties with dark waves');
    expect(p.custom).toBe(true);
    expect(p.shots).toEqual([`/api/images/${HASH_A}`, `/api/images/${HASH_B}`]);
    expect(p.sourceRefs).toEqual([`/api/images/${HASH_C}`]);
    expect(p.previewUrl).toBe(`/api/images/${HASH_A}`);
    // A curated presenter carries a casting sheet; one built here folds that
    // into identityNotes rather than inventing values to fill the shape.
    expect(p.facial).toBe('');
    expect(p.suitableCategories).toEqual([]);
  });

  it('leaves an older hand-added cast alone', () => {
    const brand = brandWith({ characters: [{ id: 'legacy', name: 'Old Cast' }, PERSON] });
    expect(customPresentersOf(brand).map((p) => p.id)).toEqual(['up-1234abcd']);
  });

  it('falls back through preview, first view, then the photographs', () => {
    const noPreview = customPresentersOf(brandWith({ characters: [{ ...PERSON, preview: undefined }] }))[0];
    expect(noPreview.previewUrl).toBe(`/api/images/${HASH_A}`);
    const photosOnly = customPresentersOf(brandWith({ characters: [{ ...PERSON, preview: undefined, shots: [] }] }))[0];
    expect(photosOnly.previewUrl).toBe(`/api/images/${HASH_C}`);
  });

  it('answers nothing for a brand with no people, and finds one by id', () => {
    expect(customPresentersOf(brandWith({}))).toEqual([]);
    expect(customPresentersOf(null)).toEqual([]);
    expect(customPresenterById(brandWith({ characters: [PERSON] }), 'up-1234abcd')?.name).toBe('Mara');
    expect(customPresenterById(brandWith({ characters: [PERSON] }), 'nobody')).toBeUndefined();
  });

  it('lists only the heads, resolves a superseded id, and maps any id to its head', () => {
    const old = { ...PERSON, id: 'up-old', supersededBy: 'up-1234abcd' };
    const head = { ...PERSON, revisionOf: 'up-old', identityEdits: ['shorter hair'] };
    const brand = brandWith({ characters: [old, head] });
    const listed = customPresentersOf(brand);
    expect(listed.map((p) => p.id)).toEqual(['up-1234abcd']);
    expect(listed[0].revisionOf).toBe('up-old');
    expect(listed[0].supersededBy).toBeUndefined();
    expect(listed[0].identityEdits).toEqual(['shorter hair']);
    // an old shot still names the old record, and its page still opens
    expect(customPresenterById(brand, 'up-old')?.supersededBy).toBe('up-1234abcd');
    expect(customPresenterById(brand, 'up-old')?.identityEdits).toEqual([]);
    expect(headPresenterId(brand, 'up-old')).toBe('up-1234abcd');
    expect(headPresenterId(brand, 'up-1234abcd')).toBe('up-1234abcd');
    expect(headPresenterId(brand, 'nobody')).toBe('nobody');
  });

  it('shows the newest person first, even though the document appends', () => {
    const later = { ...PERSON, id: 'up-later', name: 'Nia' };
    expect(customPresentersOf(brandWith({ characters: [PERSON, later] })).map((p) => p.id)).toEqual([
      'up-later',
      'up-1234abcd',
    ]);
  });
});

describe('customScenesOf', () => {
  it('reads a place the brand built, in the catalog shape every card takes', () => {
    const [s] = customScenesOf(brandWith({ scenes: [PLACE] }));
    expect(s.id).toBe('us-9876fedc');
    expect(s.custom).toBe(true);
    expect(s.subject).toBe('product');
    expect(s.prompt).toContain('basalt');
    expect(s.refs).toEqual([`/api/images/${HASH_C}`]);
    expect(s.previewUrl).toBe(`/api/images/${HASH_B}`);
    expect(s.instruction).toBe('less orange');
  });

  it("carries its examples in the set's order, marking the ones drawn from an earlier picture", () => {
    const [s] = customScenesOf(
      brandWith({
        scenes: [
          {
            ...PLACE,
            examples: [
              { role: 'hero', file: `asset:${HASH_A}`, from: PLACE.preview, product: 'vial' },
              {
                role: 'close',
                file: `asset:${HASH_C}`,
                from: 'asset:0123456789abcdef0123456789abcdef',
                setup: 'close',
                presenter: 'astrid',
              },
              { role: 'wide', file: `asset:${HASH_A}`, from: PLACE.preview },
            ],
          },
        ],
      }),
    );
    expect(s.examples).toEqual([
      { role: 'hero', url: `/api/images/${HASH_A}`, hash: HASH_A, earlier: false, with: 'product' },
      { role: 'close', url: `/api/images/${HASH_C}`, hash: HASH_C, earlier: true, setup: 'close', with: 'presenter' },
    ]);
  });

  it('shows the first reference until an example has been drawn', () => {
    const [s] = customScenesOf(brandWith({ scenes: [{ ...PLACE, preview: undefined }] }));
    expect(s.previewUrl).toBe(`/api/images/${HASH_C}`);
  });

  it('has no thumbnail at all when there is nothing to show, rather than a broken one', () => {
    const [s] = customScenesOf(brandWith({ scenes: [{ ...PLACE, preview: undefined, refs: [] }] }));
    expect(s.previewUrl).toBeNull();
  });

  it('defaults a malformed subject rather than trusting it', () => {
    const [s] = customScenesOf(brandWith({ scenes: [{ ...PLACE, subject: 'landscape' }] }));
    expect(s.subject).toBe('either');
  });

  it('answers nothing for a brand with no scenes, and finds one by id', () => {
    expect(customScenesOf(brandWith({}))).toEqual([]);
    expect(customSceneById(brandWith({ scenes: [PLACE] }), 'us-9876fedc')?.name).toBe('Wet Basalt Shore');
  });

  it('shows the newest place first, even though the document appends', () => {
    const later = { ...PLACE, id: 'us-later', name: 'Fog Pier' };
    expect(customScenesOf(brandWith({ scenes: [PLACE, later] })).map((s) => s.id)).toEqual(['us-later', 'us-9876fedc']);
  });
});

describe('newestFirst', () => {
  it('leaves a short list alone and reverses a longer one without mutating it', () => {
    expect(newestFirst([])).toEqual([]);
    expect(newestFirst(['only'])).toEqual(['only']);
    const rows = ['old', 'new'];
    expect(newestFirst(rows)).toEqual(['new', 'old']);
    expect(rows).toEqual(['old', 'new']);
  });
});

/**
 * The two halves of the product library are sorted by different people, and
 * this is where that nearly went wrong. `newestFirst` is a whole-array reverse,
 * and it was applied to the unified library at a moment when the server had
 * just started returning imported products newest first. Nothing conflicted
 * textually, so it merged silently; the visible result would have been a
 * store's catalogue in oldest order with the hand-made products behind it.
 */
describe('productsNewestFirst', () => {
  const mine = (id: string) => ({ id, origin: 'manual' as const });
  const store = (id: string) => ({ id, origin: 'catalog' as const });

  it('reverses the hand-made half and leaves the store half as the server sorted it', () => {
    const rows = [mine('m1'), mine('m2'), store('c-newest'), store('c-oldest')];
    expect(productsNewestFirst(rows).map((p) => p.id)).toEqual(['m2', 'm1', 'c-newest', 'c-oldest']);
  });

  it('is a plain reverse when nothing came from a store', () => {
    const rows = [mine('m1'), mine('m2')];
    expect(productsNewestFirst(rows).map((p) => p.id)).toEqual(['m2', 'm1']);
  });

  it('leaves a store-only library exactly as it arrived', () => {
    const rows = [store('c1'), store('c2'), store('c3')];
    expect(productsNewestFirst(rows).map((p) => p.id)).toEqual(['c1', 'c2', 'c3']);
  });

  it('never mutates its input', () => {
    const rows = [mine('m1'), mine('m2'), store('c1')];
    productsNewestFirst(rows);
    expect(rows.map((p) => p.id)).toEqual(['m1', 'm2', 'c1']);
  });
});

describe('withCustomFirst', () => {
  it('puts the brand’s own ahead of the catalog', () => {
    const mine = [{ id: 'us-1' }, { id: 'us-2' }];
    const catalog = [{ id: 'studio-shelf' }, { id: 'marble-counter' }];
    expect(withCustomFirst(mine, catalog).map((x) => x.id)).toEqual(['us-1', 'us-2', 'studio-shelf', 'marble-counter']);
  });

  it('an id the brand owns wins, so a picker and a brief cannot disagree', () => {
    const merged = withCustomFirst([{ id: 'studio-shelf', mine: true }], [{ id: 'studio-shelf', mine: false }]);
    expect(merged).toHaveLength(1);
    expect((merged[0] as any).mine).toBe(true);
  });
});

describe('a brief started from an old shot', () => {
  it('carries each person as they are now, and leaves every other token alone', () => {
    const brand = {
      json: {
        characters: [
          { id: 'up-a', name: 'Maren', origin: 'custom', supersededBy: 'up-b' },
          { id: 'up-b', name: 'Maren', origin: 'custom', revisionOf: 'up-a' },
        ],
      },
    } as any;
    const tokens = [
      { t: 'character', id: 'up-a' },
      { t: 'product', id: 'p1' },
      { t: 'text', v: 'by a window' },
    ];
    expect(withHeadPresenters(brand, tokens)).toEqual([
      { t: 'character', id: 'up-b' },
      { t: 'product', id: 'p1' },
      { t: 'text', v: 'by a window' },
    ]);
    expect(withHeadPresenters(brand, [{ t: 'character', id: 'unknown' }])).toEqual([{ t: 'character', id: 'unknown' }]);
  });
});
