import { describe, expect, it } from 'vitest';
import { ScrapeError } from '../src/scrapeError.js';
import { assertPublicHost, createGuardedFetch, isPrivateAddress } from '../src/safeFetch.js';

/**
 * The guard on a URL a person pasted. Scenri is local-first and this is the
 * same page they could open in a tab, but the brand field must not become a
 * way to probe their own network, and the body must actually be bounded: the
 * path this replaces cleared its only timeout before it started reading.
 */

describe('isPrivateAddress', () => {
  it.each([
    '127.0.0.1',
    '10.0.0.1',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '255.255.255.255',
    '224.0.0.1',
    '::1',
    '::',
    'fc00::1',
    'fe80::1',
    'ff02::1',
    '::ffff:10.0.0.1',
    '2002::1',
    'not-an-address',
  ])('refuses %s', (ip) => {
    expect(isPrivateAddress(ip)).toBe(true);
  });

  it.each(['1.1.1.1', '172.66.44.130', '8.8.8.8', '2606:4700::1111', '::ffff:8.8.8.8'])('allows %s', (ip) => {
    expect(isPrivateAddress(ip)).toBe(false);
  });
});

describe('assertPublicHost', () => {
  it('refuses a name that resolves onto this network', () => {
    expect(() => assertPublicHost('acme.example', ['10.1.2.3'], false)).toThrow(/private network/);
  });

  it('refuses an address typed straight in, without asking DNS', () => {
    expect(() => assertPublicHost('192.168.1.5', [], false)).toThrow(/private network/);
  });

  it.each(['localhost', 'printer', 'nas.local', 'db.internal'])('refuses %s', (host) => {
    expect(() => assertPublicHost(host, [], false)).toThrow(/private network/);
  });

  it('lets a public site through', () => {
    expect(() => assertPublicHost('acme.example', ['172.66.44.130'], false)).not.toThrow();
  });

  // The e2e fixture serves from 127.0.0.1, and only it ever sets this.
  it('stands aside when a harness says so', () => {
    expect(() => assertPublicHost('127.0.0.1', [], true)).not.toThrow();
  });
});

const publicLookup = async () => ['172.66.44.130'];
const page = (body: string, headers: Record<string, string> = { 'content-type': 'text/html' }) =>
  new Response(body, { status: 200, headers });

describe('the guarded fetch', () => {
  it('reads a page and reports where it ended up', async () => {
    const get = createGuardedFetch({
      lookup: publicLookup,
      fetchImpl: (async () => page('<title>Acme</title>')) as never,
    });
    const res = await get('https://acme.example/', 'html');
    expect(res.text).toContain('Acme');
    expect(res.truncated).toBe(false);
  });

  it('re-checks every redirect hop, so a public name cannot hand off to a private one', async () => {
    const fetchImpl = (async (url: string) =>
      String(url).includes('acme.example')
        ? new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/latest/meta-data/' } })
        : page('secrets')) as never;
    const get = createGuardedFetch({ lookup: publicLookup, fetchImpl });
    await expect(get('https://acme.example/', 'html')).rejects.toThrow(/private network/);
  });

  it('gives up on a redirect loop rather than following it forever', async () => {
    let n = 0;
    const fetchImpl = (async () => {
      n++;
      return new Response(null, { status: 302, headers: { location: `https://acme.example/${n}` } });
    }) as never;
    const get = createGuardedFetch({ lookup: publicLookup, fetchImpl, maxRedirects: 2 });
    await expect(get('https://acme.example/', 'html')).rejects.toThrow(/kept redirecting/);
    expect(n).toBe(3);
  });

  it('stops reading an enormous page at the cap instead of swallowing it whole', async () => {
    const body = 'x'.repeat(5000);
    const get = createGuardedFetch({
      lookup: publicLookup,
      fetchImpl: (async () => page(body)) as never,
      maxHtmlBytes: 1000,
    });
    const res = await get('https://acme.example/', 'html');
    expect(res.truncated).toBe(true);
    expect(res.bytes.byteLength).toBe(1000);
  });

  it('refuses an oversized image outright, because half a logo is not a logo', async () => {
    const get = createGuardedFetch({
      lookup: publicLookup,
      fetchImpl: (async () =>
        new Response('x'.repeat(5000), { status: 200, headers: { 'content-type': 'image/png' } })) as never,
      maxAssetBytes: 1000,
    });
    await expect(get('https://acme.example/logo.png', 'asset')).rejects.toThrow(/too large/);
  });

  it('refuses a page that is not a page, before any parser sees it', async () => {
    const get = createGuardedFetch({
      lookup: publicLookup,
      fetchImpl: (async () => page('id,name\n1,x', { 'content-type': 'text/csv' })) as never,
    });
    await expect(get('https://acme.example/data.csv', 'html')).rejects.toThrow(/not a web page/);
  });

  it('refuses a logo that is not an image, before sharp sees it', async () => {
    const get = createGuardedFetch({
      lookup: publicLookup,
      fetchImpl: (async () => page('<html>nope</html>', { 'content-type': 'text/html' })) as never,
    });
    await expect(get('https://acme.example/logo.png', 'asset')).rejects.toThrow(/not an image/);
  });

  it('says a site that will not answer took too long, and stops', async () => {
    const fetchImpl = (async (_u: string, init: RequestInit) =>
      new Promise<Response>((_res, rej) => {
        init.signal?.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })));
      })) as never;
    const get = createGuardedFetch({ lookup: publicLookup, fetchImpl, requestMs: 40 });
    await expect(get('https://slow.example/', 'html')).rejects.toThrow(/took too long/);
  });

  it('refuses a scheme that is not the web, at every hop', async () => {
    const get = createGuardedFetch({ lookup: publicLookup, fetchImpl: (async () => page('x')) as never });
    await expect(get('file:///etc/passwd', 'html')).rejects.toBeInstanceOf(ScrapeError);
  });

  it('reports how much of the whole-scrape budget is left, so optional work can be skipped', async () => {
    const get = createGuardedFetch({ lookup: publicLookup, budgetMs: 5_000 });
    expect(get.remaining()).toBeGreaterThan(0);
    expect(get.remaining()).toBeLessThanOrEqual(5_000);
  });
});
