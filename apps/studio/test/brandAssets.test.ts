import { describe, it, expect } from 'vitest';
import {
  customPresenterById,
  customPresentersOf,
  customSceneById,
  customScenesOf,
  withCustomFirst,
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
