import { describe, it, expect } from 'vitest';
import {
  productLabel,
  sceneLabel,
  sceneSearchText,
  productSearchText,
  presenterSearchText,
  showcaseSearchText,
} from '../src/displayName.js';
import { matchesQuery } from '../src/layout/library/libraryRules.js';

const kova: any = {
  id: 'kova-peach-soda',
  name: 'Peach Soda',
  brand: 'Kova',
  format: '330ml can',
  subcategory: 'slim aluminium beverage can',
  legacyNames: ['Kova 330ml Peach Sparkling Beverage Aluminum Can'],
  keywords: ['soda', 'peach', 'fizzy'],
};

const iceCore: any = {
  id: 'studio-glacier-ice-core',
  name: 'Ice Core',
  lighting: 'Natural daylight refracted through the ice',
  description: 'A hollowed pocket carved into glacial ice.',
  subject: 'product',
  collections: ['Studio'],
  verticals: ['Beauty'],
  legacyNames: ['Glacier Ice Core'],
  keywords: ['glacier', 'frozen', 'crystalline', 'skincare'],
};

const nadia: any = {
  id: 'nadia',
  name: 'Nadia',
  presentation: 'woman',
  descriptor: 'Cool minimal · white-blonde pixie · composed stillness',
  ageRange: 'late 20s',
  facial: 'High cheekbones, sparse brows',
  skin: 'Fair, cool undertone',
  hair: 'White-blonde cropped pixie',
  build: 'Slight, long-necked',
  wardrobeDefault: 'Ecru silk slip',
  suitableCategories: ['Beauty', 'Fragrance'],
  suitableStyles: ['Editorial'],
  identityNotes: 'ZZZUNIQUEZZZ',
  negativeConstraints: [],
};

describe('productLabel', () => {
  it('gives a chip the bare name — the sentence around it supplies the context', () => {
    expect(productLabel(kova, 'chip')).toBe('Peach Soda');
  });

  it('gives a card and a heading the brand, which a tile has no other way to show', () => {
    expect(productLabel(kova, 'card')).toBe('Kova Peach Soda');
    expect(productLabel(kova, 'heading')).toBe('Kova Peach Soda');
  });

  it('gives a tooltip the full structured truth', () => {
    expect(productLabel(kova, 'tooltip')).toBe('Kova Peach Soda · 330ml can');
  });

  it('prefers the short `format` over the long `subcategory`', () => {
    const noFormat = { ...kova, format: undefined };
    expect(productLabel(noFormat, 'tooltip')).toBe('Kova Peach Soda · slim aluminium beverage can');
  });

  it('never doubles a brand already inside the name', () => {
    const imported: any = { id: 'x', name: 'Kova Peach Soda', vendor: 'Kova' };
    expect(productLabel(imported, 'card')).toBe('Kova Peach Soda');
  });

  it('is case-insensitive about that, since store titles are inconsistent', () => {
    const imported: any = { id: 'x', name: 'KOVA Peach Soda', vendor: 'Kova' };
    expect(productLabel(imported, 'card')).toBe('KOVA Peach Soda');
  });

  it('falls back cleanly for a product with no brand at all', () => {
    const bare: any = { id: 'x', name: 'Cold brew can' };
    expect(productLabel(bare, 'card')).toBe('Cold brew can');
    expect(productLabel(bare, 'tooltip')).toBe('Cold brew can');
  });

  it("reads an imported product's vendor and variant", () => {
    const imported: any = { id: 'x', name: 'Runner', vendor: 'Acme', variant: 'Midnight Black, 42mm' };
    expect(productLabel(imported, 'tooltip')).toBe('Acme Runner · Midnight Black, 42mm');
  });

  it('ignores whitespace-only fields rather than emitting a dangling separator', () => {
    const messy: any = { id: 'x', name: 'Runner', vendor: '   ', variant: '  ' };
    expect(productLabel(messy, 'tooltip')).toBe('Runner');
  });
});

describe('sceneLabel', () => {
  it('shows the name alone everywhere but the tooltip', () => {
    expect(sceneLabel(iceCore, 'chip')).toBe('Ice Core');
    expect(sceneLabel(iceCore, 'card')).toBe('Ice Core');
    expect(sceneLabel(iceCore, 'heading')).toBe('Ice Core');
  });

  it('adds the lighting phrase in a tooltip, which is what separates lookalikes', () => {
    expect(sceneLabel(iceCore, 'tooltip')).toBe('Ice Core · Natural daylight refracted through the ice');
  });
});

describe('search text', () => {
  it('finds a scene by a keyword that is nowhere in its name', () => {
    expect(sceneSearchText(iceCore)).toContain('glacier');
    expect(sceneSearchText(iceCore)).toContain('skincare');
  });

  it('finds a scene by the name it shipped under before the rename', () => {
    expect(sceneSearchText(iceCore)).toContain('Glacier Ice Core');
  });

  it('finds a product by its brand and by its old long name', () => {
    const t = productSearchText(kova);
    expect(t).toContain('Kova');
    expect(t).toContain('Peach Sparkling Beverage');
    expect(t).toContain('fizzy');
  });

  it('does not leak promptName into search — legacyNames already covers it', () => {
    const withPrompt: any = { ...kova, promptName: 'ZZZUNIQUEZZZ' };
    expect(productSearchText(withPrompt)).not.toContain('ZZZUNIQUEZZZ');
  });

  it('finds a presenter by casting detail the card never shows', () => {
    const t = presenterSearchText(nadia);
    expect(t).toContain('White-blonde cropped pixie');
    expect(t).toContain('Fair, cool undertone');
    expect(t).toContain('late 20s');
    expect(t).toContain('Ecru silk slip');
    expect(t).toContain('Editorial');
    expect(t).toContain('woman');
  });

  it('leaves a presenter identityNotes out of search — engine guardrail, not a casting term', () => {
    expect(presenterSearchText(nadia)).not.toContain('ZZZUNIQUEZZZ');
  });
});

describe('showcaseSearchText', () => {
  const tile = { title: 'Harvest crush, mid-air', category: 'food-drink' };

  it('folds in the whole recipe: a tile answers to its product keywords and its scene legacy name', () => {
    const t = showcaseSearchText(tile, { product: kova, scene: iceCore }, 'Food & drink');
    expect(matchesQuery(t, 'fizzy')).toBe(true);
    expect(matchesQuery(t, 'glacier ice core')).toBe(true);
    expect(matchesQuery(t, 'harvest')).toBe(true);
  });

  it('answers to the category label a visitor reads, not only the raw key', () => {
    const t = showcaseSearchText(tile, {}, 'Food & drink');
    expect(matchesQuery(t, 'drink')).toBe(true);
  });

  it('answers to casting detail of the presenter in frame', () => {
    const t = showcaseSearchText(tile, { presenter: nadia });
    expect(matchesQuery(t, 'pixie')).toBe(true);
  });

  it('survives a recipe with nothing resolved — title still finds it', () => {
    const t = showcaseSearchText(tile, {});
    expect(matchesQuery(t, 'mid-air')).toBe(true);
    expect(matchesQuery(t, 'fizzy')).toBe(false);
  });
});
