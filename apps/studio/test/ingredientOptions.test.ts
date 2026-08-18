import { describe, it, expect } from 'vitest';
import {
  INSERT_CAP,
  INSERT_EMPTY,
  NOUN,
  PAGE,
  buildCandidates,
  filterCandidates,
  insertShortlist,
  pickList,
  chipOpensPicker,
  pickerKind,
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

const opts = (over: Partial<Parameters<typeof pickList>[2]> = {}) => ({
  currentId: null,
  query: '',
  bookmarked: new Set<string>(),
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

describe('chipOpensPicker', () => {
  it('maps a colour chip to its own palette menu', () => {
    expect(chipOpensPicker({ t: 'color', hex: '#ffffff' })).toBe('color');
    expect(chipOpensPicker({ t: 'product', id: 'x' })).toBe('product');
  });

  it('still leaves a reference, a mark and prose without a picker', () => {
    expect(chipOpensPicker({ t: 'ref', imageHash: 'h' })).toBeNull();
    expect(chipOpensPicker({ t: 'mark', imageHash: 'h' })).toBeNull();
    expect(chipOpensPicker({ t: 'text', v: 'hello' })).toBeNull();
    expect(chipOpensPicker(null)).toBeNull();
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

describe('ownership', () => {
  it('a scene this brand built reports itself as the brand’s, not scenri’s', () => {
    const cs = buildCandidates('scene', catalog({ scenes: [scene({ id: 'us-1', custom: true } as any)] }));
    expect(cs[0]?.source).toBe('brand');
  });

  it('a presenter this brand cast reports itself as the brand’s', () => {
    const cs = buildCandidates('presenter', catalog({ presenters: [presenter({ id: 'up-1', custom: true } as any)] }));
    expect(cs[0]?.source).toBe('brand');
  });

  it('scenri’s own still report as the catalog’s', () => {
    expect(buildCandidates('scene', catalog({ scenes: [scene()] }))[0]?.source).toBe('catalog');
    expect(buildCandidates('presenter', catalog({ presenters: [presenter()] }))[0]?.source).toBe('catalog');
  });

  it('owning products never hides the ones scenri ships', () => {
    const cs = buildCandidates(
      'product',
      catalog({ libraryProducts: [owned({ id: 'mine' })], demoProducts: [demo({ id: 'theirs' })] }),
    );
    expect(ids(cs)).toContain('theirs');
  });
});

describe('thumb framing', () => {
  it('marks a 4:5 fallback so a square tile can pull the face up', () => {
    const cs = buildCandidates('presenter', catalog({ presenters: [presenter({ avatarUrl: null } as any)] }));
    expect(cs[0]?.crop).toBe('top');
  });

  it('leaves a real square avatar alone', () => {
    expect(buildCandidates('presenter', catalog({ presenters: [presenter()] }))[0]?.crop).toBeUndefined();
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

describe('pickList', () => {
  const scenes = (n: number, over: (i: number) => Partial<Scene> = () => ({})) =>
    buildCandidates(
      'scene',
      catalog({ scenes: Array.from({ length: n }, (_, i) => scene({ id: `s${i}`, ...over(i) })) }),
    );

  it('lifts what is on out of the grid, so it is never in two places', () => {
    const cs = scenes(4);
    const l = pickList('scene', cs, opts({ currentId: 's1' }));
    expect(l.current?.id).toBe('s1');
    expect(ids(l.items)).toEqual(['s0', 's2', 's3']);
    expect(l.total).toBe(3);
  });

  it('has no current when the chip holds an id the catalog lost', () => {
    const l = pickList('scene', scenes(3), opts({ currentId: 'deleted' }));
    expect(l.current).toBeNull();
    expect(l.items).toHaveLength(3);
  });

  it('is one list: every candidate is either current or in it, exactly once', () => {
    const cs = scenes(9, (i) => ({ verticals: i % 2 ? ['Beauty'] : ['Sport'] }));
    const l = pickList('scene', cs, opts({ currentId: 's0', bookmarked: new Set(['s5']) }));
    const seen = [...(l.current ? [l.current.id] : []), ...ids(l.items)];
    expect(seen.slice().sort()).toEqual(ids(cs).slice().sort());
    expect(new Set(seen).size).toBe(seen.length);
  });

  describe('order is the lift, not a heading', () => {
    it('scenes: bookmarked, then suited, then the catalog as authored', () => {
      const cs = buildCandidates(
        'scene',
        catalog({
          scenes: [
            scene({ id: 'plain-a', verticals: ['Sport'] }),
            scene({ id: 'suited-a', verticals: ['Beauty'] }),
            scene({ id: 'plain-b', verticals: ['Sport'] }),
            scene({ id: 'marked-a', verticals: ['Sport'] }),
          ],
          productCategory: 'beauty',
        }),
      );
      const l = pickList('scene', cs, opts({ bookmarked: new Set(['marked-a']) }));
      expect(ids(l.items)).toEqual(['marked-a', 'suited-a', 'plain-a', 'plain-b']);
    });

    it('presenters: suited first, and nothing else moves', () => {
      const cs = buildCandidates(
        'presenter',
        catalog({
          presenters: [
            presenter({ id: 'p-plain', suitableCategories: ['Sport'] }),
            presenter({ id: 'p-suited', suitableCategories: ['Beauty'] }),
          ],
          productCategory: 'beauty',
        }),
      );
      expect(ids(pickList('presenter', cs, opts()).items)).toEqual(['p-suited', 'p-plain']);
    });

    it('presenters have no bookmarks, so a bookmarked set does nothing to them', () => {
      const cs = buildCandidates('presenter', catalog({ presenters: [presenter(), presenter({ id: 'p2' })] }));
      expect(ids(pickList('presenter', cs, opts({ bookmarked: new Set(['p2']) })).items)).toEqual(['p1', 'p2']);
    });

    it('products: the brand’s own before the ones scenri ships', () => {
      const cs = buildCandidates(
        'product',
        catalog({ libraryProducts: [owned({ id: 'mine' })], demoProducts: [demo({ id: 'theirs' })] }),
      );
      expect(ids(pickList('product', cs, opts()).items)).toEqual(['mine', 'theirs']);
    });

    it('keeps catalog order inside a band rather than re-sorting it', () => {
      const cs = scenes(5);
      expect(ids(pickList('scene', cs, opts()).items)).toEqual(['s0', 's1', 's2', 's3', 's4']);
    });

    it('presenters: your own person outranks a merely suited one of ours', () => {
      const cs = buildCandidates(
        'presenter',
        catalog({
          presenters: [
            presenter({ id: 'ours-suited', suitableCategories: ['Beauty'] }),
            presenter({ id: 'up-mine', suitableCategories: [], custom: true } as any),
          ],
          productCategory: 'beauty',
        }),
      );
      expect(ids(pickList('presenter', cs, opts()).items)).toEqual(['up-mine', 'ours-suited']);
    });

    it('scenes: your own place outranks a bookmarked one of ours', () => {
      const cs = buildCandidates(
        'scene',
        catalog({
          scenes: [scene({ id: 'ours-marked' }), scene({ id: 'us-mine', custom: true } as any)],
        }),
      );
      const l = pickList('scene', cs, opts({ bookmarked: new Set(['ours-marked']) }));
      expect(ids(l.items)).toEqual(['us-mine', 'ours-marked']);
    });
  });

  describe('search', () => {
    const cs = buildCandidates(
      'scene',
      catalog({
        scenes: [scene(), scene({ id: 's2', name: 'Rosé Terrace', legacyNames: [], keywords: ['balcony'] })],
      }),
    );

    it('filters the grid and leaves what is on where it is', () => {
      const l = pickList('scene', cs, opts({ currentId: 's1', query: 'rose' }));
      // still answers "what do I have" while you are looking for something else
      expect(l.current?.id).toBe('s1');
      expect(ids(l.items)).toEqual(['s2']);
    });

    it('reports no matches as an empty list, not as a missing one', () => {
      expect(pickList('scene', cs, opts({ query: 'zzzz' })).items).toHaveLength(0);
    });

    it('never offers what is already on as a result', () => {
      const l = pickList('scene', cs, opts({ currentId: 's1', query: 'ice' }));
      expect(ids(l.items)).not.toContain('s1');
    });
  });

  describe('paging', () => {
    it('draws everything and owes nothing at exactly one page', () => {
      const l = pickList('scene', scenes(PAGE), opts());
      expect(l.items).toHaveLength(PAGE);
      expect(l.remaining).toBe(0);
    });

    it('says what it is holding back rather than stopping silently', () => {
      const l = pickList('scene', scenes(PAGE + 5), opts());
      expect(l.items).toHaveLength(PAGE);
      expect(l.remaining).toBe(5);
      expect(l.total).toBe(PAGE + 5);
    });

    it('shows more when asked, without disturbing the order', () => {
      const cs = scenes(PAGE + 5);
      const l = pickList('scene', cs, opts({ shown: PAGE * 2 }));
      expect(l.items).toHaveLength(PAGE + 5);
      expect(l.remaining).toBe(0);
      expect(ids(l.items)).toEqual(ids(cs));
    });

    it('pages a 576-product library', () => {
      const cs = buildCandidates(
        'product',
        catalog({ libraryProducts: Array.from({ length: 576 }, (_, i) => owned({ id: `o${i}` })) }),
      );
      const l = pickList('product', cs, opts());
      expect(l.items).toHaveLength(PAGE);
      expect(l.remaining).toBe(576 - PAGE);
    });
  });
});

const choiceIds = (rows: ReturnType<typeof insertShortlist>) =>
  rows.map((r) => ('id' in r.token ? r.token.id : r.label));

describe('insertShortlist', () => {
  const manyProducts = () =>
    buildCandidates(
      'product',
      catalog({
        libraryProducts: [owned({ id: 'mine' })],
        demoProducts: Array.from({ length: 20 }, (_, i) => demo({ id: `d${i}`, name: `Demo ${i}` })),
      }),
    );
  const manyPresenters = () =>
    buildCandidates(
      'presenter',
      catalog({
        presenters: [
          presenter({ id: 'up-mine', name: 'Ours', custom: true } as any),
          presenter({ id: 'p-suited', name: 'Suited', suitableCategories: ['Beauty'] }),
          ...Array.from({ length: 8 }, (_, i) => presenter({ id: `p${i}`, name: `Cast ${i}` })),
        ],
        productCategory: 'beauty',
      }),
    );
  const manyScenes = () =>
    buildCandidates(
      'scene',
      catalog({
        scenes: [
          scene({ id: 'us-mine', name: 'Our set', custom: true } as any),
          scene({ id: 'marked', name: 'Booked', verticals: ['Sport'] }),
          scene({ id: 'suited', name: 'Suited set', verticals: ['Beauty'] }),
          ...Array.from({ length: 12 }, (_, i) => scene({ id: `s${i}`, name: `Place ${i}`, verticals: ['Sport'] })),
        ],
        productCategory: 'beauty',
      }),
    );
  const palette = [
    { hex: '#D96C3B', name: 'Terracotta', slot: 'primary' as const },
    { hex: '#1F2933', name: 'Ink', slot: 'secondary' as const },
    { hex: '#F5C518', name: 'Gold', slot: 'accent' as const },
  ];
  const pools = () => ({
    products: manyProducts(),
    presenters: manyPresenters(),
    scenes: manyScenes(),
    colors: palette,
  });

  it('empty $ is products only, yours first', () => {
    const rows = insertShortlist('$', pools(), { query: '' });
    expect(rows.every((r) => r.group === 'Products')).toBe(true);
    expect(choiceIds(rows)[0]).toBe('mine');
    expect(rows.length).toBeLessThanOrEqual(INSERT_EMPTY.Products);
  });

  it('empty / is scenes only, yours first', () => {
    const rows = insertShortlist('/', pools(), { query: '', bookmarked: new Set(['marked']) });
    expect(rows.every((r) => r.group === 'Scenes')).toBe(true);
    expect(choiceIds(rows).slice(0, 3)).toEqual(['us-mine', 'marked', 'suited']);
    expect(rows.length).toBeLessThanOrEqual(INSERT_EMPTY.Scenes);
  });

  it('empty @ is presenters only, yours first', () => {
    const rows = insertShortlist('@', pools(), { query: '' });
    expect(rows.every((r) => r.group === 'Presenters')).toBe(true);
    expect(rows[0]?.token).toMatchObject({ t: 'character', id: 'up-mine' });
    expect(rows.length).toBeLessThanOrEqual(INSERT_EMPTY.Presenters);
  });

  it('empty # is colours only', () => {
    const rows = insertShortlist('#', pools(), { query: '' });
    expect(rows.every((r) => r.group === 'Colors')).toBe(true);
    expect(rows.map((r) => r.label)).toEqual(['Terracotta', 'Ink', 'Gold']);
    expect(rows[0]?.token).toMatchObject({ t: 'color', hex: '#D96C3B', name: 'Terracotta' });
    expect(rows.length).toBeLessThanOrEqual(INSERT_EMPTY.Colors);
  });

  it('typing # searches colours, not scenes', () => {
    const rows = insertShortlist('#', pools(), { query: 'ink' });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.token).toMatchObject({ t: 'color', hex: '#1F2933' });
    expect(insertShortlist('#', pools(), { query: 'f5c' }).map((r) => r.label)).toEqual(['Gold']);
    expect(insertShortlist('#', pools(), { query: 'our set' })).toEqual([]);
  });

  it('typing searches that catalog and caps silently at INSERT_CAP', () => {
    const products = buildCandidates(
      'product',
      catalog({ libraryProducts: Array.from({ length: 80 }, (_, i) => owned({ id: `can-${i}`, name: `Can ${i}` })) }),
    );
    const rows = insertShortlist('$', { products, presenters: [] }, { query: 'can' });
    expect(rows).toHaveLength(INSERT_CAP);
    expect(rows.every((r) => r.group === 'Products')).toBe(true);
  });

  it('a typed query that matches nothing is an empty list, not a close', () => {
    expect(insertShortlist('@', { products: [], presenters: manyPresenters() }, { query: 'zzzz' })).toHaveLength(0);
  });
});
