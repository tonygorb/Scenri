import { describe, it, expect } from 'vitest';
import { mergeScrape, validateBrand } from '../src/index.js';

const scraped = {
  specVersion: '0.1',
  meta: {
    name: 'Acme Coffee Co',
    tagline: 'Buy coffee online today',
    website: 'https://acme.coffee',
    updatedAt: '2026-08-13T00:00:00Z',
  },
  palette: { primary: { hex: '#1F3D2B' }, accent: [{ hex: '#D96C3B' }] },
  logos: [{ role: 'primary', file: 'asset:aaaa' }],
};

describe('mergeScrape', () => {
  it('keeps every hand-edited field and refreshes the website', () => {
    const { brand } = mergeScrape(
      { specVersion: '0.1', meta: { name: 'Acme', tagline: 'Slow mornings', website: 'https://old.example' } },
      scraped,
    );
    expect((brand as any).meta).toMatchObject({
      name: 'Acme',
      tagline: 'Slow mornings',
      website: 'https://acme.coffee',
    });
  });

  it('fills only what is missing', () => {
    const { brand } = mergeScrape({ specVersion: '0.1', meta: { name: 'Acme' } }, scraped);
    expect((brand as any).meta.name).toBe('Acme');
    expect((brand as any).meta.tagline).toBe('Buy coffee online today');
  });

  it('takes the palette wholesale only when the brand has none', () => {
    const fresh = mergeScrape({ specVersion: '0.1', meta: { name: 'Acme' } }, scraped);
    expect((fresh.brand as any).palette).toEqual(scraped.palette);
    expect(fresh.suggestions.palette).toEqual([]);
  });

  it('never overwrites an existing palette — it suggests instead', () => {
    const existing = {
      specVersion: '0.1',
      meta: { name: 'Acme' },
      palette: { primary: { hex: '#000000', name: 'Ink' } },
    };
    const { brand, suggestions } = mergeScrape(existing, scraped);
    expect((brand as any).palette).toEqual(existing.palette);
    expect(suggestions.palette).toEqual([{ hex: '#1F3D2B' }, { hex: '#D96C3B' }]);
  });

  it('appends a new mark once and never twice', () => {
    const existing = { specVersion: '0.1', meta: { name: 'Acme' }, logos: [{ role: 'mark', file: 'asset:bbbb' }] };
    const once = mergeScrape(existing, scraped);
    expect((once.brand as any).logos.map((l: any) => l.file)).toEqual(['asset:bbbb', 'asset:aaaa']);
    const twice = mergeScrape(once.brand, scraped);
    expect((twice.brand as any).logos).toHaveLength(2);
  });

  it('never removes a mark a scrape failed to find', () => {
    const existing = { specVersion: '0.1', meta: { name: 'Acme' }, logos: [{ role: 'mark', file: 'asset:bbbb' }] };
    const { brand } = mergeScrape(existing, { specVersion: '0.1', meta: { name: 'Acme' } });
    expect((brand as any).logos).toEqual(existing.logos);
  });

  it('leaves every field a scrape has no business touching exactly as it was', () => {
    const existing = {
      specVersion: '0.1',
      meta: { name: 'Acme' },
      products: [{ id: 'bag', name: 'House Blend' }],
      characters: [{ id: 'marco', name: 'Marco' }],
      imagery: { mood: 'crafted', keywords: ['warm'], avoid: ['neon'] },
      rules: { never: ['competitor logos in frame'] },
      typography: { display: { family: 'Canela' } },
      voice: { tone: ['warm'] },
      extensions: { 'dev.scenri.studio': { theme: 'dark' } },
    };
    const { brand } = mergeScrape(existing, scraped) as any;
    for (const key of ['products', 'characters', 'imagery', 'rules', 'typography', 'voice', 'extensions']) {
      expect(brand[key]).toEqual((existing as any)[key]);
    }
    expect(validateBrand(brand).valid).toBe(true);
  });

  it('produces a document that still validates in the ordinary case', () => {
    const { brand } = mergeScrape({ specVersion: '0.1', meta: { name: 'Acme' } }, scraped);
    expect(validateBrand(brand).errors).toEqual([]);
  });
});
