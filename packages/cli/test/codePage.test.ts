import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CODE_PAGE_COPY, LOCKUP_PATHS, codePage } from '../src/network/codePage.js';

const LOCKUP_SVG = fileURLToPath(new URL('../../../apps/studio/brand/scenri-lockup.svg', import.meta.url));
const page = codePage(null);
/** What a person can read: the page without its style and script. */
const visible = (html: string) =>
  html
    .replace(/<style>[\s\S]*?<\/style>/g, '')
    .replace(/<script>[\s\S]*?<\/script>/g, '')
    .replace(/<[^>]+>/g, ' ');

describe('the code page', () => {
  it('carries the Scenri lockup exactly as the artwork of record draws it', () => {
    const artwork = [...readFileSync(LOCKUP_SVG, 'utf8').matchAll(/ d="([^"]+)"/g)].map((m) => m[1]);
    expect(LOCKUP_PATHS).toEqual(artwork);
    for (const d of artwork) expect(page).toContain(`d="${d}"`);
    expect(page).toContain('aria-label="Scenri"');
  });

  it('fetches nothing: no stylesheet, script, font or image from anywhere', () => {
    expect(page).not.toMatch(/<link[^>]+rel="stylesheet"/);
    expect(page).not.toMatch(/<script[^>]+src=/);
    expect(page).not.toMatch(/<img\b/);
    expect(page).not.toMatch(/url\((?!#)/);
    // the one link is the tab icon, and it is inline
    expect(page).toMatch(/<link rel="icon" href="data:image\/svg\+xml,/);
  });

  it('asks for six digits the way phones expect a one-time code', () => {
    const input = page.match(/<input [^>]+>/)?.[0] ?? '';
    for (const attr of [
      'name="t"',
      'inputmode="numeric"',
      'pattern="[0-9]*"',
      'autocomplete="one-time-code"',
      'enterkeyhint="go"',
      'autocapitalize="off"',
      'spellcheck="false"',
      'aria-describedby="where msg"',
    ]) {
      expect(input, attr).toContain(attr);
    }
    // a password manager's icon has no business on a one-time code
    expect(input).toContain('data-1p-ignore');
    expect(input).toContain('data-lpignore="true"');
    // the field is labelled, and the six boxes are drawing only
    expect(page).toContain(`<label class="vh" for="code">${CODE_PAGE_COPY.label}</label>`);
    expect(page.match(/<span class="slot"><\/span>/g)).toHaveLength(6);
    expect(page).toContain('<div class="slots" aria-hidden="true">');
  });

  it('works without script: a plain field in a form that sends the code', () => {
    expect(page).toContain('<html lang="en" class="nojs">');
    expect(page).toMatch(/<form id="form" method="get" action=""/);
    expect(page).toContain('<button type="submit" class="go" id="go">Open Scenri</button>');
  });

  it('says what went wrong, where a screen reader hears it', () => {
    expect(codePage('wrong')).toContain(`<p class="msg" id="msg" role="alert">${CODE_PAGE_COPY.wrong}</p>`);
    expect(codePage('locked')).toContain(CODE_PAGE_COPY.locked);
    expect(page).toContain('<p class="msg" id="msg" role="alert"></p>');
  });

  it('keeps its keyboard from zooming iOS, and its layout clear of the notch', () => {
    expect(page).toContain('viewport-fit=cover');
    expect(page).toMatch(/\.js \.otp input \{[^}]*font-size: 16px/);
    expect(page).toContain('env(safe-area-inset-top)');
    expect(page).toContain('prefers-reduced-motion: reduce');
    expect(page).toContain('prefers-color-scheme: dark');
  });

  it('every sentence obeys the copy rules', () => {
    const all = [visible(page), visible(codePage('wrong')), ...Object.values(CODE_PAGE_COPY)].join('\n');
    expect(all).not.toMatch(/[–—]/);
    expect(all).not.toMatch(/!/);
    expect(all).not.toMatch(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]|\u{FE0F}/u);
    expect(all).not.toMatch(/\bscenri\b/);
  });
});
