import { describe, expect, it } from 'vitest';
import { normalizeSiteUrl } from '../src/siteUrl.js';

/**
 * Every row here was measured against Node's WHATWG parser before it was
 * written down. The second one is the bug a tester hit on 0.9.2: a pasted
 * address with a leading space became `https://  https://www.lucid.now/`,
 * which threw a bare TypeError that reached the screen as "Invalid URL" under
 * a perfectly good website.
 */

const ok = (input: string) => {
  const r = normalizeSiteUrl(input);
  if (!r.ok) throw new Error(`expected ok, got ${r.reason}: ${r.message}`);
  return r;
};
const bad = (input: string) => {
  const r = normalizeSiteUrl(input);
  if (r.ok) throw new Error(`expected a refusal, got ${r.url}`);
  return r;
};

describe('addresses a person might paste', () => {
  it.each([
    ['acme.com', 'https://acme.com/'],
    ['www.acme.com/shop', 'https://www.acme.com/shop'],
    ['https://acme.com', 'https://acme.com/'],
    ['  https://acme.com', 'https://acme.com/'],
    ['https://acme.com  ', 'https://acme.com/'],
    [' acme.com', 'https://acme.com/'],
    ['​acme.com', 'https://acme.com/'],
    ['ac​me.com', 'https://acme.com/'],
    ['HTTPS://ACME.com', 'https://acme.com/'],
    ['acme.com:8080', 'https://acme.com:8080/'],
    ['//acme.com', 'https://acme.com/'],
    ['<https://acme.com>', 'https://acme.com/'],
    ['"acme.com"', 'https://acme.com/'],
    ['https://acme.com.', 'https://acme.com/'],
  ])('reads %j as %s', (input, expected) => {
    expect(ok(input).url).toBe(expected);
  });

  it('keeps the query and drops the fragment, because a kit is built from a page not a scroll position', () => {
    expect(ok('www.acme.com/shop?ref=x#top').url).toBe('https://www.acme.com/shop?ref=x');
  });

  it('does not quietly upgrade http, because following the redirect is what the fetcher does', () => {
    expect(ok('http://acme.com').url).toBe('http://acme.com/');
  });

  it('drops credentials, which have no business in a brand kit', () => {
    expect(ok('https://user:pw@acme.com/x').url).toBe('https://acme.com/x');
  });

  it('punycodes an international host and reports it that way', () => {
    expect(ok('münchen.de').host).toBe('xn--mnchen-3ya.de');
    expect(ok('акме.рф').host).toMatch(/^xn--/);
  });

  it('says when it supplied the scheme, so the caller can say so too', () => {
    expect(ok('acme.com').addedScheme).toBe(true);
    expect(ok('https://acme.com').addedScheme).toBe(false);
  });
});

describe('addresses it has to refuse', () => {
  it.each([
    ['', 'empty'],
    ['   ', 'empty'],
    ['​', 'empty'],
    ['file:///etc/passwd', 'scheme'],
    ['javascript:alert(1)', 'scheme'],
    ['data:text/html,x', 'scheme'],
    ['mailto:sam@acme.com', 'scheme'],
    ['acme .com', 'space'],
    ['acme .com', 'space'],
    ['acme', 'host'],
    ['https://', 'unparseable'],
  ])('refuses %j as %s', (input, reason) => {
    expect(bad(input).reason).toBe(reason);
  });

  it('offers the address it thinks was meant when a space is the only problem', () => {
    const r = bad('acme .com');
    expect(r.suggestion).toBe('acme.com');
    expect(r.message).toContain('Did you mean acme.com?');
  });

  it('says something a person can act on, never a parser message', () => {
    for (const input of ['', 'file:///etc/passwd', 'acme', 'https://']) {
      expect(normalizeSiteUrl(input)).toMatchObject({ ok: false });
      const r = bad(input);
      expect(r.message).not.toMatch(/invalid url|typeerror|err_/i);
      expect(r.message.endsWith('.') || r.message.endsWith('?')).toBe(true);
    }
  });

  // safeFetch refuses these, not the parser: an e2e fixture has to be able to
  // serve from 127.0.0.1 while a pasted address must not reach it.
  it('parses a loopback or private address rather than pretending it is malformed', () => {
    expect(ok('localhost:4747').host).toBe('localhost');
    expect(ok('192.168.1.5').host).toBe('192.168.1.5');
  });
});
