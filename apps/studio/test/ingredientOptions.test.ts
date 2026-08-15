import { describe, it, expect } from 'vitest';
import {
  NOUN,
  PAGE,
  buildCandidates,
  filterCandidates,
  pickerKind,
  sectionsFor,
  type Candidate,
  type IngredientCatalog,
} from '../src/composer/ingredientOptions.js';
import type { DemoProduct, Presenter, Product, Scene } from '../src/api.js';

const scene = (over: Partial<Scene> = {}): Scene =>
  ({
    id: 's1',
    name: 'Ice Core',
    description: 'a frozen block',
    lighting: 'cold raking key',
    subject: 'product',
    collections: ['Studio'],
    verticals: ['Beauty'],
    prompt: '',
    width: 1024,
    height: 1280,
    previewUrl: '/api/scene-thumbnails/s1.jpg',
    previewColor: '#4a86c8',
    legacyNames: ['Glacier Ice Core'],
    keywords: ['glacier', 'frozen'],
    ...over,
  }) as Scene;

const presenter = (over: Partial<Presenter> = {}): Presenter =>
  ({
    id: 'p1',
    name: 'Nadia',
    presentation: 'woman',
    descriptor: 'Cool minimal · white-blonde pixie',
    ageRange: '30s',
    facial: 'freckled',
    skin: 'fair',
    hair: 'white-blonde pixie',
    build: 'slight',
    wardrobeDefault: 'ribbed knit',
    suitableCategories: ['Beauty'],
    suitableStyles: ['Minimal'],
    identityNotes: '',
    negativeConstraints: [],
    width: 1024,
    height: 1280,
    previewUrl: '/api/presenter-thumbnails/p1.jpg',
    avatarUrl: '/api/presenter-avatars/p1.jpg',
    ...over,
  }) as Presenter;

const demo = (over: Partial<DemoProduct> = {}): DemoProduct =>
  ({
    id: 'd1',
    name: 'Peach Soda',
    category: 'beverage',
    description: '',
    width: 1024,
    height: 1024,
    previewUrl: '/api/demo-product-thumbnails/d1.jpg',
    brand: 'Kova',
    format: '330ml can',
    keywords: ['fizzy'],
    ...over,
  }) as DemoProduct;

const owned = (over: Partial<Product> = {}): Product =>
  ({ id: 'o1', name: 'Cold brew can', shots: [{ file: 'asset:abc' }], origin: 'manual', ...over }) as Product;

const catalog = (over: Partial<IngredientCatalog> = {}): IngredientCatalog => ({
  libraryProducts: [],
  brandProducts: [],
  demoProducts: [],
  presenters: [],
  cast: [],
  scenes: [],
  productCategory: null,
  ...over,
});

const opts = (over: Partial<Parameters<typeof sectionsFor>[2]> = {}) => ({
  currentId: null,
  query: '',
  starred: new Set<string>(),
  categoryTitle: null,
  shown: {},
  ...over,
});

const ids = (cs: Candidate[]) => cs.map((c) => c.id);

describe('pickerKind', () => {
  it('maps the three catalog chips', () => {
    expect(pickerKind({ t: 'product', id: 'x' })).toBe('product');
    expect(pickerKind({ t: 'character', id: 'x' })).toBe('presenter');
    expect(pickerKind({ t: 'template', id: 'x' })).toBe('scene');
  });

  it('leaves everything else to the caret menu — those are not visual catalogs', () => {
    expect(pickerKind({ t: 'color', hex: '#ffffff' })).toBeNull();
    expect(pickerKind({ t: 'ref', imageHash: 'h' })).toBeNull();
    expect(pickerKind({ t: 'mark', imageHash: 'h' })).toBeNull();
    expect(pickerKind({ t: 'text', v: 'hello' })).toBeNull();
    expect(pickerKind(null)).toBeNull();
    expect(pickerKind(undefined)).toBeNull();
  });

  it('names each kind for headings and aria labels', () => {
    expect(NOUN.product).toBe('product');
    expect(NOUN.presenter).toBe('presenter');
    expect(NOUN.scene).toBe('scene');
  });
});

describe('buildCandidates — products', () => {
  it('includes the scenri library, so a demo-product chip can reach its own siblings', () => {
    const cs = buildCandidates('product', catalog({ libraryProducts: [owned()], demoProducts: [demo()] }));
    expect(ids(cs)).toEqual(['o1', 'd1']);
    expect(cs.find((c) => c.id === 'd1')?.source).toBe('catalog');
    expect(cs.find((c) => c.id === 'o1')?.source).toBe('brand');
  });

  it('falls back to brand.json products when the library has not loaded', () => {
    const cs = buildCandidates('product', catalog({ brandProducts: [owned({ id: 'b1' })], demoProducts: [demo()] }));
    expect(ids(cs)).toEqual(['b1', 'd1']);
  });

  it('resolves a thumbnail from an asset ref, and null when a catalog import brought no image', () => {
    const [withShot, noShot] = buildCandidates(
      'product',
      catalog({ libraryProducts: [owned(), owned({ id: 'o2', shots: [] })] }),
    );
    expect(withShot.thumb).toBe('/api/images/abc');
    expect(noShot.thumb).toBeNull();
  });

  it('carries no angle: a slot pinned for one product may not exist on another', () => {
    const [c] = buildCandidates('product', catalog({ libraryProducts: [owned()] }));
    expect(c.token).toEqual({ t: 'product', id: 'o1' });
    expect('angle' in c.token).toBe(false);
  });

  it('never claims a product is recommended — there is no product-to-product compat', () => {
    const cs = buildCandidates('product', catalog({ demoProducts: [demo()], productCategory: 'beverage' }));
    expect(cs.every((c) => !c.recommended)).toBe(true);
  });

  it('labels a card the way the chip it makes will read, with the brand underneath', () => {
    // "Birchwood Page Leather Derby" in a 92px cell ellipsised down to the
    // brand, so every card read the same and none of them matched its chip.
    const [c] = buildCandidates('product', catalog({ demoProducts: [demo()] }));
    expect(c.label).toBe('Peach Soda');
    // the brand alone: the picture already shows it is a can
    expect(c.sub).toBe('Kova');
    expect(c.full).toBe('Kova Peach Soda · 330ml can');
  });

  it('never restates the name, because the format is not on the card at all', () => {
    const [c] = buildCandidates(
      'product',
      catalog({ demoProducts: [demo({ name: 'Field Watch', brand: 'Aldergate', format: 'Field watch' })] }),
    );
    expect(c.label).toBe('Field Watch');
    expect(c.sub).toBe('Aldergate');
  });

  it('leaves the sub off entirely for a product with no brand', () => {
    const [c] = buildCandidates('product', catalog({ libraryProducts: [owned()] }));
    expect(c.label).toBe('Cold brew can');
    expect(c.sub).toBeUndefined();
  });

  it('searches keywords, brand and the format, not just the name', () => {
    const [c] = buildCandidates('product', catalog({ demoProducts: [demo()] }));
    expect(filterCandidates([c], 'fizzy')).toHaveLength(1);
    expect(filterCandidates([c], 'kova')).toHaveLength(1);
    expect(filterCandidates([c], '330ml')).toHaveLength(1);
  });
});

describe('buildCandidates — presenters', () => {
  it('makes the whole casting sheet searchable, not just name and descriptor', () => {
    const [c] = buildCandidates('presenter', catalog({ presenters: [presenter()] }));
    expect(filterCandidates([c], 'freckled')).toHaveLength(1);
    expect(filterCandidates([c], 'slight')).toHaveLength(1);
    expect(filterCandidates([c], 'ribbed knit')).toHaveLength(1);
  });

  it('prefers the square avatar — a 1:1 box crops the head off the 4:5 card', () => {
    const [withAvatar] = buildCandidates('presenter', catalog({ presenters: [presenter()] }));
    expect(withAvatar.thumb).toBe('/api/presenter-avatars/p1.jpg');
    const [noAvatar] = buildCandidates('presenter', catalog({ presenters: [presenter({ avatarUrl: null })] }));
    expect(noAvatar.thumb).toBe('/api/presenter-thumbnails/p1.jpg');
  });

  it('includes a legacy brand cast, which the chip already resolves first', () => {
    const cs = buildCandidates(
      'presenter',
      catalog({ presenters: [presenter()], cast: [owned({ id: 'marco', name: 'Marco' })] }),
    );
    expect(ids(cs)).toEqual(['p1', 'marco']);
    expect(cs.find((c) => c.id === 'marco')?.source).toBe('brand');
  });

  it('marks a suited presenter against the active product category', () => {
    const [c] = buildCandidates('presenter', catalog({ presenters: [presenter()], productCategory: 'beauty' }));
    expect(c.recommended).toBe(true);
    const [none] = buildCandidates('presenter', catalog({ presenters: [presenter()], productCategory: null }));
    expect(none.recommended).toBe(false);
  });
});

describe('buildCandidates — scenes', () => {
  it('carries the preview, the normalized tint and the full search vocabulary', () => {
    const [c] = buildCandidates('scene', catalog({ scenes: [scene()] }));
    expect(c.label).toBe('Ice Core');
    expect(c.sub).toBe('cold raking key');
    expect(c.thumb).toBe('/api/scene-thumbnails/s1.jpg');
    expect(c.tint).toMatch(/^hsl\(/);
    expect(filterCandidates([c], 'glacier')).toHaveLength(1);
    expect(filterCandidates([c], 'Glacier Ice Core')).toHaveLength(1);
  });

  it('marks a suited scene against the active product category', () => {
    const [c] = buildCandidates('scene', catalog({ scenes: [scene()], productCategory: 'beauty' }));
    expect(c.recommended).toBe(true);
  });
});

describe('filterCandidates', () => {
  const cs = buildCandidates(
    'scene',
    catalog({
      scenes: [
        scene(),
        scene({
          id: 's2',
          name: 'Rosé Terrace',
          lighting: 'warm afternoon sun',
          description: 'a stone balcony',
          legacyNames: [],
          keywords: ['balcony'],
        }),
      ],
    }),
  );

  it('is the library matcher: folded, AND across terms, plural-stemmed', () => {
    expect(ids(filterCandidates(cs, 'rose'))).toEqual(['s2']);
    expect(ids(filterCandidates(cs, 'ice cold'))).toEqual(['s1']);
    expect(filterCandidates(cs, 'ice terrace')).toHaveLength(0);
  });

  it('an empty query is not a filter', () => {
    expect(filterCandidates(cs, '')).toHaveLength(2);
    expect(filterCandidates(cs, '   ')).toHaveLength(2);
  });
});

describe('sectionsFor — searching', () => {
  const cs = buildCandidates('scene', catalog({ scenes: [scene(), scene({ id: 's2', name: 'Rosé Terrace' })] }));

  it('collapses every kind to one list: sections would lie about what the filter did', () => {
    const secs = sectionsFor('scene', cs, opts({ query: 'rose', currentId: 's1', starred: new Set(['s1']) }));
    expect(secs).toHaveLength(1);
    expect(secs[0].id).toBe('results');
    expect(ids(secs[0].items)).toEqual(['s2']);
  });

  it('reports zero matches as an empty results section rather than no section', () => {
    const secs = sectionsFor('scene', cs, opts({ query: 'zzzz' }));
    expect(secs).toHaveLength(1);
    expect(secs[0].items).toHaveLength(0);
  });
});

describe('sectionsFor — scenes', () => {
  const many = Array.from({ length: 6 }, (_, i) =>
    scene({ id: `s${i}`, name: `Scene ${i}`, verticals: i < 3 ? ['Beauty'] : ['Sport'] }),
  );
  const cs = buildCandidates('scene', catalog({ scenes: many, productCategory: 'beauty' }));

  it('orders current, starred, suited, all', () => {
    const secs = sectionsFor('scene', cs, opts({ currentId: 's0', starred: new Set(['s4']), categoryTitle: 'Beauty' }));
    expect(secs.map((s) => s.id)).toEqual(['current', 'starred', 'suited', 'all']);
    expect(secs[0].title).toBe('Current');
    expect(secs[2].title).toBe('Suited to Beauty');
    expect(secs[3].title).toBe('All scenes');
  });

  it('shows every candidate exactly once across every section', () => {
    const secs = sectionsFor('scene', cs, opts({ currentId: 's0', starred: new Set(['s4']), categoryTitle: 'Beauty' }));
    const seen = secs.flatMap((s) => ids(s.items));
    expect(seen.slice().sort()).toEqual(ids(cs).slice().sort());
    expect(new Set(seen).size).toBe(seen.length);
  });

  it('drops a lift back into All rather than losing it when the section is not drawn', () => {
    // no categoryTitle, so there is no Suited heading to put a suited scene under
    const secs = sectionsFor('scene', cs, opts({ categoryTitle: null }));
    expect(secs.map((s) => s.id)).toEqual(['all']);
    expect(ids(secs[0].items).slice().sort()).toEqual(ids(cs).slice().sort());
  });

  it('omits Current when the chip holds an id the catalog no longer has', () => {
    const secs = sectionsFor('scene', cs, opts({ currentId: 'deleted-scene' }));
    expect(secs.some((s) => s.id === 'current')).toBe(false);
    expect(secs.flatMap((s) => ids(s.items))).toHaveLength(cs.length);
  });

  it('omits Starred when nothing is starred', () => {
    expect(sectionsFor('scene', cs, opts()).some((s) => s.id === 'starred')).toBe(false);
  });

  it('never counts the starred scene twice when it is also suited', () => {
    const secs = sectionsFor('scene', cs, opts({ starred: new Set(['s1']), categoryTitle: 'Beauty' }));
    const starred = secs.find((s) => s.id === 'starred')!;
    const suited = secs.find((s) => s.id === 'suited')!;
    expect(ids(starred.items)).toEqual(['s1']);
    expect(ids(suited.items)).not.toContain('s1');
  });
});

describe('sectionsFor — presenters', () => {
  const cs = buildCandidates(
    'presenter',
    catalog({
      presenters: [presenter(), presenter({ id: 'p2', name: 'Marek', suitableCategories: ['Sport'] })],
      productCategory: 'beauty',
    }),
  );

  it('orders current, suited, all — no starred, because presenters have no favourites', () => {
    const secs = sectionsFor('presenter', cs, opts({ currentId: 'p2', categoryTitle: 'Beauty' }));
    expect(secs.map((s) => s.id)).toEqual(['current', 'suited', 'all']);
    expect(secs[2].title).toBe('All presenters');
  });

  it('ignores a starred set entirely', () => {
    const secs = sectionsFor('presenter', cs, opts({ starred: new Set(['p1']) }));
    expect(secs.some((s) => s.id === 'starred')).toBe(false);
    expect(secs.flatMap((s) => ids(s.items))).toHaveLength(2);
  });
});

describe('sectionsFor — products', () => {
  const cs = buildCandidates(
    'product',
    catalog({ libraryProducts: [owned(), owned({ id: 'o2' })], demoProducts: [demo(), demo({ id: 'd2' })] }),
  );

  it('splits the brand library from the scenri one, so 44 curated products stay reachable past 576 imported', () => {
    const secs = sectionsFor('product', cs, opts());
    expect(secs.map((s) => s.id)).toEqual(['mine', 'library']);
    expect(ids(secs[0].items)).toEqual(['o1', 'o2']);
    expect(ids(secs[1].items)).toEqual(['d1', 'd2']);
  });

  it('has no Suited section — inventing one would be worse than none', () => {
    const withCat = buildCandidates(
      'product',
      catalog({ libraryProducts: [owned()], demoProducts: [demo()], productCategory: 'beverage' }),
    );
    expect(sectionsFor('product', withCat, opts({ categoryTitle: 'Beverage' })).some((s) => s.id === 'suited')).toBe(
      false,
    );
  });

  it('keeps Your products even at zero, because that is exactly when adding one is the move', () => {
    const onlyDemo = buildCandidates('product', catalog({ demoProducts: [demo()] }));
    const secs = sectionsFor('product', onlyDemo, opts());
    const mine = secs.find((s) => s.id === 'mine')!;
    expect(mine.items).toHaveLength(0);
    // the heading still carries Add, so an empty shelf is one line rather than
    // a grid with a single dashed box alone in it
    expect(mine.action).toBe('add-product');
  });

  it('ticks a demo product as Current and still offers the rest of the library', () => {
    const secs = sectionsFor('product', cs, opts({ currentId: 'd1' }));
    expect(ids(secs.find((s) => s.id === 'current')!.items)).toEqual(['d1']);
    expect(ids(secs.find((s) => s.id === 'library')!.items)).toEqual(['d2']);
  });

  it('drops the library section when there are no scenri products to show', () => {
    const own = buildCandidates('product', catalog({ libraryProducts: [owned()] }));
    expect(sectionsFor('product', own, opts()).some((s) => s.id === 'library')).toBe(false);
  });
});

describe('sectionsFor — paging', () => {
  const build = (n: number) =>
    buildCandidates('scene', catalog({ scenes: Array.from({ length: n }, (_, i) => scene({ id: `s${i}` })) }));

  it('draws everything and owes nothing at exactly one page', () => {
    const [all] = sectionsFor('scene', build(PAGE), opts());
    expect(all.items).toHaveLength(PAGE);
    expect(all.remaining).toBe(0);
    expect(all.total).toBe(PAGE);
  });

  it('says what it is holding back rather than stopping silently', () => {
    const [all] = sectionsFor('scene', build(PAGE + 1), opts());
    expect(all.items).toHaveLength(PAGE);
    expect(all.remaining).toBe(1);
    expect(all.total).toBe(PAGE + 1);
  });

  it('pages a 576-product library one section at a time', () => {
    const cs = buildCandidates(
      'product',
      catalog({
        libraryProducts: Array.from({ length: 576 }, (_, i) => owned({ id: `o${i}` })),
        demoProducts: [demo()],
      }),
    );
    const secs = sectionsFor('product', cs, opts());
    const mine = secs.find((s) => s.id === 'mine')!;
    expect(mine.items).toHaveLength(PAGE);
    expect(mine.remaining).toBe(576 - PAGE);
    // the scenri library is not buried behind them
    expect(secs.find((s) => s.id === 'library')!.items).toHaveLength(1);
  });

  it('honours a per-section Show more without touching its siblings', () => {
    const cs = buildCandidates(
      'product',
      catalog({
        libraryProducts: Array.from({ length: 60 }, (_, i) => owned({ id: `o${i}` })),
        demoProducts: Array.from({ length: 44 }, (_, i) => demo({ id: `d${i}` })),
      }),
    );
    const secs = sectionsFor('product', cs, opts({ shown: { mine: PAGE * 2 } }));
    expect(secs.find((s) => s.id === 'mine')!.items).toHaveLength(PAGE * 2);
    expect(secs.find((s) => s.id === 'library')!.items).toHaveLength(PAGE);
  });

  it('pages the results of a search too', () => {
    const [results] = sectionsFor('scene', build(PAGE + 5), opts({ query: 'ice' }));
    expect(results.id).toBe('results');
    expect(results.items).toHaveLength(PAGE);
    expect(results.remaining).toBe(5);
  });
});
