import { describe, it, expect } from 'vitest';
import { validateBrand, buildFromUrl } from '../src/index.js';
import { nameFromTitle } from '../src/buildFromUrl.js';

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
  it('accepts a character built from a person’s own photos', () => {
    const r = validateBrand({
      specVersion: '0.1',
      meta: { name: 'Acme' },
      characters: [
        {
          id: 'up-8f2c41ab',
          name: 'Mara',
          promptName: 'a woman in her early thirties with dark shoulder-length waves',
          presentation: 'woman',
          descriptor: 'Warm editorial · dark waves · composed',
          ageRange: 'early 30s',
          hair: 'dark shoulder-length waves',
          identityNotes: 'the wide-set brown eyes must survive every generation',
          negativeConstraints: ['no straightened hair'],
          sourceRefs: [{ file: 'asset:deadbeef' }],
          shots: [{ file: 'asset:cafe1234', angle: 'front', locked: true }],
          origin: 'custom',
        },
      ],
    });
    expect(r.errors).toEqual([]);
    expect(r.valid).toBe(true);
  });
  it('still accepts a bare character, and rejects an unknown character field', () => {
    const base = { specVersion: '0.1', meta: { name: 'Acme' } };
    expect(validateBrand({ ...base, characters: [{ id: 'mara', name: 'Mara' }] }).valid).toBe(true);
    expect(validateBrand({ ...base, characters: [{ id: 'mara', name: 'Mara', origin: 'catalog' }] }).valid).toBe(false);
    expect(validateBrand({ ...base, characters: [{ id: 'mara', name: 'Mara', presentation: 'robot' }] }).valid).toBe(
      false,
    );
  });
  it('accepts a brand-owned scene', () => {
    const r = validateBrand({
      specVersion: '0.1',
      meta: { name: 'Acme' },
      scenes: [
        {
          id: 'us-3ab90c17',
          name: 'Wet Basalt Shore',
          promptName: 'Wet Basalt Shore',
          lighting: 'Low directional sunset, long shadows across wet stone',
          description: 'A dark volcanic shoreline at last light.',
          subject: 'product',
          prompt: 'A wet dark basalt shelf at low sunset light, cool atmospheric ocean haze behind.',
          collections: ['Editorial'],
          verticals: ['Beauty'],
          keywords: ['volcanic', 'shore'],
          instruction: 'like these rocks but less orange',
          refs: [{ file: 'asset:deadbeef' }],
          preview: 'asset:cafe1234',
          width: 1024,
          height: 1280,
        },
      ],
    });
    expect(r.errors).toEqual([]);
    expect(r.valid).toBe(true);
  });
  it('rejects a scene that is incomplete, mis-subjected, or names the product', () => {
    const base = { specVersion: '0.1', meta: { name: 'Acme' } };
    const ok = {
      id: 'us-3ab90c17',
      name: 'Shore',
      lighting: 'Low sunset',
      description: 'A shoreline.',
      subject: 'product' as const,
      prompt: 'A wet basalt shelf at low sunset light.',
      width: 1024,
      height: 1280,
    };
    expect(validateBrand({ ...base, scenes: [ok] }).valid).toBe(true);
    const { prompt: _drop, ...noPrompt } = ok;
    expect(validateBrand({ ...base, scenes: [noPrompt] }).valid).toBe(false);
    expect(validateBrand({ ...base, scenes: [{ ...ok, subject: 'landscape' }] }).valid).toBe(false);
    // the whole point of the model: the set never names what is staged in it
    expect(validateBrand({ ...base, scenes: [{ ...ok, prompt: 'A shelf holding {product_name}.' }] }).valid).toBe(
      false,
    );
    expect(validateBrand({ ...base, scenes: [{ ...ok, id: 'Us_3AB' }] }).valid).toBe(false);
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

describe('nameFromTitle', () => {
  // "Page Title | Site Name" is the near-universal convention, and taking the
  // first half named a tester's company after its homepage headline.
  it.each([
    ['One Solution for All Your Business Finances | Lucid', 'Lucid'],
    ['Bookkeeping, Tax and CFO Services – Lucid', 'Lucid'],
    ['Acme Coffee', 'Acme Coffee'],
    ['Acme Coffee | Slow mornings for people with somewhere to be', 'Acme Coffee'],
    ['Home · Studio Ora', 'Studio Ora'],
    ['', ''],
  ])('reads %j as %j', (title, expected) => {
    expect(nameFromTitle(title)).toBe(expected);
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

  it('stamps createdWith from the caller, falling back to the bare tool name', async () => {
    const { brand } = await buildFromUrl('https://acme.coffee/', { fetchImpl, createdWith: 'scenri/9.9.9' });
    expect((brand as any).meta.createdWith).toBe('scenri/9.9.9');
    const { brand: plain } = await buildFromUrl('https://acme.coffee/', { fetchImpl });
    expect((plain as any).meta.createdWith).toBe('scenri');
  });

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

  // og:image is usually a marketing photograph, not a mark. It is still saved
  // so the brand has a face, but "primary" is what the compiler asks a model
  // to reproduce exactly as drawn, and a share image must never be that.
  it('an og:image fallback is saved as an alternate, never called the primary', async () => {
    const ogOnly = (async (input: any) => {
      const url = String(input);
      if (url.endsWith('/share.jpg')) return new Response(PNG, { status: 200 });
      return new Response(
        '<html><head><title>OgOnly</title><meta property="og:image" content="/share.jpg"></head><body></body></html>',
        { status: 200 },
      );
    }) as typeof fetch;
    const { brand, warnings } = await buildFromUrl('https://og.example/', {
      fetchImpl: ogOnly,
      saveAsset: async () => 'asset:cafecafe',
    });
    const b = brand as any;
    expect(b.logos[0]).toEqual({ role: 'alternate', file: 'asset:cafecafe' });
    expect(warnings.join(' ')).toContain('social share image');
    expect(validateBrand(brand).valid).toBe(true);
  });

  /**
   * The shape lego.certifiedstore.co.il has, and the reason a 22px chip of it
   * was three pixels of red.
   *
   * Its logo is a wordmark 5.5 times wider than it is tall, and it wins the
   * logo contest on merit - that is the thing the compiler reproduces as
   * drawn. It is simply not a square, and every surface that wants a small
   * square badge had nothing else to ask for. The site declares one in markup
   * (`rel="shortcut icon"`, a CDN PNG); `/favicon.ico` there is a 404, which is
   * why guessing that address is not the fix.
   */
  it('keeps the site icon beside a header logo, as the mark', async () => {
    const ICON = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x01]);
    const store = (async (input: any) => {
      const url = String(input);
      if (url.endsWith('/wordmark.png')) return new Response(PNG, { status: 200 });
      if (url.includes('/cdn/shop/files/logo_32x32.png')) return new Response(ICON, { status: 200 });
      return new Response(
        `<html><head><title>Brick Store</title>
          <link rel="shortcut icon" href="//brick.example/cdn/shop/files/logo_32x32.png" type="image/png">
          </head><body><header class="site-header">
          <a href="/"><img src="/wordmark.png" alt="Brick Store logo" width="220" height="40"></a>
          </header></body></html>`,
        { status: 200 },
      );
    }) as typeof fetch;
    const { brand } = await buildFromUrl('https://brick.example/', {
      fetchImpl: store,
      saveAsset: async (buf) => `asset:${buf.length === ICON.length ? 'icon' : 'logo'}`,
    });
    expect((brand as any).logos).toEqual([
      { role: 'primary', file: 'asset:logo' },
      { role: 'mark', file: 'asset:icon' },
    ]);
    expect(validateBrand(brand).valid).toBe(true);
  });

  // "Primary" is what the compiler promises to reproduce exactly as drawn,
  // and 32px of favicon cannot say what to reproduce. Real onboardings used
  // to crown one anyway, which is where broken scraped logos began.
  it('a favicon-sized icon is saved as an alternate, with the size named', async () => {
    const { brand, warnings } = await buildFromUrl('https://acme.coffee/', {
      fetchImpl,
      saveAsset: async () => 'asset:beefbeef',
      inspectMark: async () => ({ longEdge: 32, width: 32, height: 32, blank: false }),
    });
    const b = brand as any;
    expect(b.logos[0]).toEqual({ role: 'alternate', file: 'asset:beefbeef' });
    expect(warnings.join(' ')).toContain('favicon-sized (32px)');
    expect(validateBrand(brand).valid).toBe(true);
  });

  it('a real-sized icon keeps its primary crown under the same probe', async () => {
    const { brand, warnings } = await buildFromUrl('https://acme.coffee/', {
      fetchImpl,
      saveAsset: async () => 'asset:beefbeef',
      inspectMark: async () => ({ longEdge: 1024, width: 1024, height: 1024, blank: false }),
    });
    expect((brand as any).logos[0].role).toBe('primary');
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

  /**
   * A refusal is not an absence.
   *
   * Every other request in a scrape already degrades - a stylesheet or a logo
   * that will not load costs a warning, not the kit. The homepage alone was
   * fatal, so a site that answered 429 once ended the step with a red box and
   * nothing created, while a site that refused everything *after* its homepage
   * produced a perfectly good brand. A person pasted `allbirds.com` and got
   * the first of those.
   *
   * The name, the address and the sentence are all still true; the logo and
   * the colours are two fields in Settings.
   */
  it('still makes a brand from a site that answers and refuses', async () => {
    for (const [status, host] of [
      [500, 'down.example'],
      [403, 'walled.example'],
      [429, 'busy.example'],
    ] as const) {
      const refusing = (async () => new Response('no', { status })) as unknown as typeof fetch;
      const { brand, warnings, report } = await buildFromUrl(`https://${host}/`, { fetchImpl: refusing });

      expect((brand as any).meta.name).toBe(host);
      expect((brand as any).meta.website).toBe(`https://${host}`);
      expect(validateBrand(brand).valid).toBe(true);
      // The kit is honestly empty rather than wrong.
      expect(report.logo.status).toBe('none');
      expect(report.colors.count).toBe(0);
      expect(report.name.source).toBe('hostname');
      // And it says what happened, and what to do about it.
      expect(warnings.join(' ')).toMatch(/Settings/);
      expect(warnings.join(' ')).not.toMatch(/\b[45]\d\d\b|undefined|null/);
    }
  });

  // A person reads this, so it names the site and says what happened rather
  // than quoting a status line at them.
  it('says what a refusing site answered, in a sentence a person can act on', async () => {
    const err = (async () => new Response('nope', { status: 500 })) as unknown as typeof fetch;
    const { warnings } = await buildFromUrl('https://down.example/', { fetchImpl: err });
    expect(warnings[0]).toBe('down.example had trouble answering. Try again in a moment.');
  });

  // A number is not an explanation, and 403 is almost always a CDN refusing
  // anything that is not a browser - not something the person did.
  it('explains a refusal instead of quoting its status code', async () => {
    const walled = (async () => new Response('no', { status: 403 })) as unknown as typeof fetch;
    const { warnings } = await buildFromUrl('https://walled.example/', { fetchImpl: walled });
    expect(warnings[0]).toMatch(/would not let Scenri read it.*by hand/s);
  });

  /**
   * The other half of the rule. A refusal means a server is there and
   * declining; a 404 means this address has no page on it, which is almost
   * always a typo. Inventing a brand for it would bury the mistake.
   */
  it('still refuses an address with nothing behind it', async () => {
    const gone = (async () => new Response('nope', { status: 404 })) as unknown as typeof fetch;
    await expect(buildFromUrl('https://typo.example/', { fetchImpl: gone })).rejects.toThrow(
      /no page at that address/i,
    );
  });

  /**
   * The 0.9.2 report. A pasted address with a leading space used to become
   * `https://  https://...`, and the TypeError reached the screen as "Invalid
   * URL" under a site that was perfectly fine.
   */
  it('reads a pasted address with a leading space, and fetches the site it meant', async () => {
    const asked: string[] = [];
    const spy = (async (u: string) => {
      asked.push(String(u));
      return new Response('<title>Acme</title>', { status: 200 });
    }) as unknown as typeof fetch;
    await buildFromUrl('  https://acme.example/', { fetchImpl: spy });
    expect(asked[0]).toBe('https://acme.example/');
  });

  // The studio used to write meta.website back over the kit after creating it.
  // It was always a no-op, and it was the last place the malformed string
  // could land, so it is gone. This is what made that safe.
  it('always records the website itself, whatever the caller passed', async () => {
    const page = (async () => new Response('<title>Acme</title>', { status: 200 })) as unknown as typeof fetch;
    for (const input of ['acme.example', '  https://acme.example/pricing?x=1']) {
      const { brand } = await buildFromUrl(input, { fetchImpl: page });
      expect((brand.meta as { website: string }).website).toBe('https://acme.example');
    }
  });

  it('refuses what is not a web address with a sentence, never a parser message', async () => {
    const never = (async () => {
      throw new Error('should not have been fetched');
    }) as unknown as typeof fetch;
    for (const [input, sentence] of [
      ['file:///etc/passwd', /http or https/],
      ['', /Paste a website address/],
      ['acme', /does not look like a website address/],
    ] as const) {
      await expect(buildFromUrl(input, { fetchImpl: never })).rejects.toThrow(sentence);
      await expect(buildFromUrl(input, { fetchImpl: never })).rejects.not.toThrow(/Invalid URL/);
    }
  });
});

/**
 * What a mark turns out to be once it has been decoded, which is the only
 * place some of this is knowable. Every case here was a real site handing back
 * a confidently wrong logo.
 */
describe('a mark has to survive being looked at', () => {
  const html = `<html><head><title>Acme</title></head><body>
    <header><img src="/mark.png" alt="Acme logo" width="200" height="60"></header>
  </body></html>`;
  const bytes = Buffer.from([1, 2, 3]);
  const fetchImpl = (async (input: any) =>
    String(input).endsWith('/mark.png') ? new Response(bytes) : new Response(html)) as unknown as typeof fetch;

  const build = (shape: Partial<Record<string, unknown>> | null) =>
    buildFromUrl('https://acme.example/', {
      fetchImpl,
      saveAsset: async () => 'asset:mark',
      inspectMark: async () =>
        shape === null ? null : ({ longEdge: 600, width: 600, height: 200, blank: false, ...shape } as never),
    });

  it('crowns a mark that is large, visible and a sensible shape', async () => {
    const { report } = await build({});
    expect(report.logo.status).toBe('primary');
  });

  // linear.app's header mark is white-on-dark: on a light background it is
  // nothing at all, and a mark nobody can see reads as a broken image.
  it('refuses a mark that would be invisible, rather than saving it', async () => {
    const { brand, warnings } = await build({ blank: true });
    expect(brand.logos).toBeUndefined();
    expect(warnings.join(' ')).toMatch(/no logo/i);
  });

  // paulgraham.com's only image is a 69x399 column of nav buttons.
  it('will not call a tall column the logo, but keeps it as an alternate', async () => {
    const { report, warnings } = await build({ width: 69, height: 399, longEdge: 399 });
    expect(report.logo.status).toBe('alternate');
    expect(warnings.join(' ')).toMatch(/taller than it is wide/i);
  });

  it('says out loud when it is not sure, instead of asserting', async () => {
    const weak = `<html><head><title>Acme</title><link rel="icon" href="/mark.png"></head><body></body></html>`;
    const weakFetch = (async (input: any) =>
      String(input).endsWith('/mark.png') ? new Response(bytes) : new Response(weak)) as unknown as typeof fetch;
    const { report, warnings } = await buildFromUrl('https://acme.example/', {
      fetchImpl: weakFetch,
      saveAsset: async () => 'asset:mark',
      inspectMark: async () => ({ longEdge: 300, width: 300, height: 300, blank: false }),
    });
    expect(report.logo.status).toBe('alternate');
    expect(warnings.join(' ')).toMatch(/not confident/i);
  });

  // A caller that supplies no way to measure has opted out of the judgement
  // rather than failed it.
  it('does not hold a missing measurement against a candidate', async () => {
    const { report } = await build(null);
    expect(report.logo.status).toBe('primary');
  });
});

/**
 * People paste the page they are looking at.
 *
 * That is very often a product or a collection, not a homepage. A deep path
 * that answered 404 used to end the whole thing - `example.com/a/b/c` gave
 * "There is no page at that address" and no brand, from a site whose homepage
 * read perfectly.
 */
describe('a pasted address that is not the homepage', () => {
  const site = (ok: (u: string) => boolean) =>
    (async (u: string) => {
      const url = String(u);
      if (!ok(url)) return new Response('nope', { status: 404 });
      return new Response(
        '<html><head><title>Acme</title><meta name="theme-color" content="#123456"></head><body>hi</body></html>',
        { status: 200, headers: { 'content-type': 'text/html' } },
      );
    }) as unknown as typeof fetch;

  it('falls back to the origin when the pasted page is not there', async () => {
    const asked: string[] = [];
    const fetchImpl = (async (u: string) => {
      asked.push(String(u));
      const url = String(u);
      if (new URL(url).pathname !== '/') return new Response('nope', { status: 404 });
      return new Response('<html><head><title>Acme</title></head><body>hi</body></html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      });
    }) as unknown as typeof fetch;

    const { brand, report } = await buildFromUrl('https://acme.example/products/a-thing', { fetchImpl });
    expect(report.name.value).toBe('Acme');
    expect((brand as any).meta.website).toBe('https://acme.example');
    // The pasted address was tried first, because a shop really can live at a path.
    expect(asked[0]).toContain('/products/a-thing');
    expect(asked[1]).toBe('https://acme.example');
  });

  it('keeps a site that really does live at a path', async () => {
    const fetchImpl = site((u) => u.includes('/shop'));
    const { report } = await buildFromUrl('https://acme.example/shop', { fetchImpl });
    expect(report.name.value).toBe('Acme');
  });

  it('does not ask twice when the homepage is the address', async () => {
    const asked: string[] = [];
    const fetchImpl = (async (u: string) => {
      asked.push(String(u));
      return new Response('nope', { status: 404 });
    }) as unknown as typeof fetch;
    await expect(buildFromUrl('https://acme.example/', { fetchImpl })).rejects.toThrow(/no page at that address/i);
    expect(asked).toHaveLength(1);
  });
});
