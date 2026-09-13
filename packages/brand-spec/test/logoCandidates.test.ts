import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as cheerio from 'cheerio';
import { describe, expect, it } from 'vitest';
import { largestFromSrcset, logoCandidates, svgAsMark } from '../src/logoCandidates.js';

/**
 * The site a tester actually pasted had exactly one candidate under the old
 * rule, a 16x16 favicon, which the size floor then demoted to an alternate -
 * so a page with a real logo in its nav produced a brand with no primary mark.
 */

const fixture = (name: string) =>
  cheerio.load(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fixtures', name), 'utf8'));

const best = (name: string, base = 'https://lucid.example/') => logoCandidates(fixture(name), new URL(base))[0];

describe('picking the mark off a marketing site', () => {
  it('takes the logo out of the header, not the favicon and not the social card', () => {
    const top = best('marketing.html');
    expect(top.source).toBe('header-img');
    expect(top.url).toBe('https://lucid.example/assets/lucid-logo.svg');
    expect(top.role).toBe('primary');
  });

  it.each([
    ['a wall of customer logos', 'acme.png'],
    ['hero photography', 'hero-photo.jpg'],
    ['a social icon', 'social-facebook.svg'],
    ['a tracking pixel', 'facebook.com/tr'],
  ])('never picks %s', (_what, needle) => {
    const top = best('marketing.html');
    expect(top.url).not.toContain(needle);
  });

  it('keeps the favicon and the social card as candidates, ranked below the real mark', () => {
    const all = logoCandidates(fixture('marketing.html'), new URL('https://lucid.example/'));
    const og = all.find((c) => c.source === 'og-image');
    expect(og?.role).toBe('alternate');
    expect(all.findIndex((c) => c.source === 'header-img')).toBeLessThan(
      all.findIndex((c) => c.source === 'link-icon'),
    );
  });
});

describe('the signals that outrank a guess', () => {
  it('believes a declared organisation logo first, resolved against <base>', () => {
    const top = best('jsonld-svg.html', 'https://ora.example/');
    expect(top.source).toBe('json-ld');
    expect(top.url).toBe('https://ora.example/brand/ora-mark.png');
  });

  it('takes the largest source out of a srcset', () => {
    expect(largestFromSrcset('/a.png 400w, /b.png 800w')).toBe('/b.png');
    expect(largestFromSrcset('/a.png 1x, /b.png 3x')).toBe('/b.png');
    expect(largestFromSrcset('')).toBeNull();
  });

  it('prefers a manifest icon that was sized on purpose over a favicon', () => {
    const all = logoCandidates(fixture('marketing.html'), new URL('https://lucid.example/'), {
      icons: [{ src: '/icons/512.png', sizes: '512x512' }],
    });
    const manifest = all.find((c) => c.source === 'manifest');
    const favicon = all.find((c) => c.source === 'link-icon');
    expect(manifest).toBeDefined();
    expect((manifest?.score ?? 0) > (favicon?.score ?? 0)).toBe(true);
  });

  it('marks a dark variant as one rather than treating it as a different logo', () => {
    const all = logoCandidates(fixture('jsonld-svg.html'), new URL('https://ora.example/'));
    const dark = all.find((c) => c.url?.includes('dark-logo'));
    if (dark) expect(dark.background).toBe('dark');
  });

  it('says why it chose what it chose, so a bad pick can be argued with', () => {
    expect(best('marketing.html').why.join(' ')).toContain('header');
  });
});

/**
 * The quiet failure this prevents: toMarkPng rasterises from viewBox units, so
 * a 24x24 nav icon becomes about 96px, falls under the size floor and gets
 * demoted exactly as a favicon does. Found, then thrown away.
 */
describe('svgAsMark', () => {
  it('sizes a viewBox-only icon up to something a mark can be made from', () => {
    const out = svgAsMark('<svg viewBox="0 0 24 24"><path d="M0 0h24v24H0z"/></svg>', 1024);
    expect(out).toContain('width="1024"');
    expect(out).toContain('height="1024"');
  });

  it('keeps the aspect of a wordmark', () => {
    const out = svgAsMark('<svg viewBox="0 0 300 100"><path d="M0 0h1v1H0z"/></svg>', 600);
    expect(out).toContain('width="600"');
    expect(out).toContain('height="200"');
  });

  it('adds the namespace the HTML parser implied away, because librsvg refuses without it', () => {
    expect(svgAsMark('<svg viewBox="0 0 10 10"></svg>')).toContain('xmlns="http://www.w3.org/2000/svg"');
  });

  it('refuses markup that would run or fetch something', () => {
    expect(svgAsMark('<svg viewBox="0 0 10 10"><script>x()</script></svg>')).toBeNull();
    expect(svgAsMark('<svg viewBox="0 0 10 10"><image href="https://x.example/a.png"/></svg>')).toBeNull();
    expect(svgAsMark('<svg viewBox="0 0 10 10"><foreignObject/></svg>')).toBeNull();
  });

  it('gives up on an svg with no size at all rather than guessing one', () => {
    expect(svgAsMark('<svg><path d="M0 0h1v1H0z"/></svg>')).toBeNull();
  });
});
