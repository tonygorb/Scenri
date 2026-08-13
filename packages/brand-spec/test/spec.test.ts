import { describe, it, expect } from 'vitest';
import { validateBrand, buildFromUrl } from '../src/index.js';

describe('validateBrand', () => {
  it('accepts minimal brand', () => {
    expect(validateBrand({ specVersion: '0.1', meta: { name: 'Acme' } }).valid).toBe(true);
  });
  it('accepts full brand with palette/typography/logos/products', () => {
    const r = validateBrand({
      specVersion: '0.1',
      meta: { name: 'Acme', slug: 'acme', website: 'https://acme.co' },
      palette: { primary: { hex: '#1F3D2B' }, accent: [{ hex: '#D96C3B', name: 'Terracotta' }] },
      typography: { display: { family: 'Canela', weights: [500] } },
      logos: [{ role: 'primary', file: 'assets/logo.svg', background: 'light' }],
      products: [{ id: 'bag', name: 'Bag', shots: [{ file: 'assets/bag.png', locked: true }] }],
      rules: { never: ['competitor logos in frame'], notes: 'Packaging always upright.' },
      extensions: { 'dev.scenri.studio': { theme: 'dark' } },
    });
    expect(r.errors).toEqual([]);
    expect(r.valid).toBe(true);
  });
  it('accepts brand rules, and a brand without them', () => {
    const base = { specVersion: '0.1', meta: { name: 'Acme' } };
    expect(validateBrand(base).valid).toBe(true);
    expect(validateBrand({ ...base, rules: {} }).valid).toBe(true);
    expect(validateBrand({ ...base, rules: { never: [] } }).valid).toBe(true);
    expect(validateBrand({ ...base, rules: { notes: 'Upright, unopened.' } }).valid).toBe(true);
  });
  it('rejects malformed rules and unknown top-level keys', () => {
    const base = { specVersion: '0.1', meta: { name: 'Acme' } };
    // rules.never is a list of short prohibitions, not free-form values
    expect(validateBrand({ ...base, rules: { never: [{ text: 'no' }] } }).valid).toBe(false);
    expect(validateBrand({ ...base, rules: { never: [''] } }).valid).toBe(false);
    expect(validateBrand({ ...base, rules: { never: 'competitor logos' } }).valid).toBe(false);
    expect(validateBrand({ ...base, rules: { always: ['upright'] } }).valid).toBe(false);
    // additionalProperties:false is what keeps a typo from silently becoming brand data
    expect(validateBrand({ ...base, ruels: {} }).valid).toBe(false);
  });
  it('pins specVersion to the 0.1 const', () => {
    expect(validateBrand({ specVersion: '0.2', meta: { name: 'Acme' } }).valid).toBe(false);
  });
  it('rejects missing name, bad hex, bad extension namespace', () => {
    expect(validateBrand({ specVersion: '0.1', meta: {} }).valid).toBe(false);
    expect(validateBrand({ specVersion: '0.1', meta: { name: 'x' }, palette: { primary: { hex: 'red' } } }).valid).toBe(
      false,
    );
    expect(validateBrand({ specVersion: '0.1', meta: { name: 'x' }, extensions: { noNamespace: {} } }).valid).toBe(
      false,
    );
  });
});

describe('buildFromUrl', () => {
  const HTML = `<!doctype html><html><head>
    <title>Acme Coffee — Slow mornings</title>
    <meta name="description" content="Espresso for people with somewhere to be.">
    <meta name="theme-color" content="#1F3D2B">
    <link rel="icon" href="/icon.png">
    <link rel="stylesheet" href="/main.css">
    <style>.btn{background:#D96C3B;color:#FAFAF7}.hero{color:#1F3D2B}</style>
  </head><body><div style="background:#1F3D2B">hi</div></body></html>`;
  const CSS = `.x{color:#1F3D2B}.y{border-color:#E8DCC8}.z{background:#111111}`;
  const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

  const fetchImpl = (async (input: any) => {
    const url = String(input);
    if (url.endsWith('/main.css')) return new Response(CSS, { status: 200 });
    if (url.endsWith('/icon.png')) return new Response(PNG, { status: 200 });
    return new Response(HTML, { status: 200 });
  }) as typeof fetch;

  it('extracts name, tagline, palette, logo; result validates', async () => {
    const saved: Buffer[] = [];
    const { brand, warnings } = await buildFromUrl('https://acme.coffee/', {
      fetchImpl,
      saveAsset: async (buf) => {
        saved.push(buf);
        return 'asset:deadbeef';
      },
    });
    const b = brand as any;
    expect(b.meta.name).toBe('Acme Coffee');
    expect(b.meta.tagline).toContain('Espresso');
    expect(b.palette.primary.hex.toLowerCase()).toBe('#1f3d2b');
    expect(b.logos[0].file).toBe('asset:deadbeef');
    expect(saved).toHaveLength(1);
    expect(validateBrand(brand).valid).toBe(true);
    expect(warnings).toEqual([]);
  });

  it('degrades gracefully: no colors, no logo saver', async () => {
    const bare = (async () =>
      new Response('<html><head><title>Plain</title></head><body></body></html>', {
        status: 200,
      })) as unknown as typeof fetch;
    const { brand, warnings } = await buildFromUrl('https://plain.example/', { fetchImpl: bare });
    expect((brand as any).meta.name).toBe('Plain');
    expect(warnings.join(' ')).toMatch(/palette/i);
    expect(warnings.join(' ')).toMatch(/logo/i);
    expect(validateBrand(brand).valid).toBe(true);
  });

  it('throws on HTTP error', async () => {
    const err = (async () => new Response('nope', { status: 500 })) as unknown as typeof fetch;
    await expect(buildFromUrl('https://down.example/', { fetchImpl: err })).rejects.toThrow(/HTTP 500/);
  });
});
