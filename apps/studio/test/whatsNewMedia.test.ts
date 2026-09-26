import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ReleaseEntry } from '../src/api.js';
import { ReleaseMeta, VersionChip, WhatsNewFallback, pictureOf } from '../src/views/WhatsNewParts.js';

/**
 * What's New's media rules, rendered: a version is a label chip and the
 * running one is lit; the fallback is the dialog's artwork with the version
 * on it, and a release without a picture of its own owns none.
 */

const html = (el: ReturnType<typeof createElement>) => renderToStaticMarkup(el);

const release = (over: Partial<ReleaseEntry> = {}): ReleaseEntry => ({
  version: '0.19.1',
  date: '2026-09-26',
  title: 'Codex keeps no copy of your pictures',
  sections: [{ heading: 'Codex', body: 'Codex keeps no copy of a picture once Scenri has it.' }],
  ...over,
});

describe('the version chip', () => {
  it('is a small label, never a control, the version with its name for a screen reader', () => {
    const out = html(createElement(VersionChip, { version: '0.19.0' }));
    expect(out).toContain('class="sc-wn-chip"');
    expect(out).not.toContain('<button');
    expect(out).not.toContain('data-on');
    expect(out).toContain('<span class="sc-vh">Version </span>0.19.0');
  });

  it('lights the version this computer runs by colour alone: the number and nothing else to see', () => {
    const out = html(createElement(VersionChip, { version: '0.19.1', current: true }));
    expect(out).toContain('data-on');
    // what shows is the number; what a screen reader hears says whose it is
    expect(out.replace(/<span class="sc-vh">[^<]*<\/span>/g, '').replace(/<[^>]+>/g, '')).toBe('0.19.1');
    expect(out).toContain('<span class="sc-vh">, the version you are on</span>');
  });

  it('sits after the date, unless the picture already carries it', () => {
    const entry = { version: '0.18.1', date: '2026-09-26' };
    expect(html(createElement(ReleaseMeta, { entry }))).toContain('sc-wn-chip');
    expect(html(createElement(ReleaseMeta, { entry, hideVersion: true }))).not.toContain('sc-wn-chip');
  });
});

describe('the dialog fallback', () => {
  it("is decorative artwork on the stage, carrying the release's version in the dark tokens", () => {
    const out = html(createElement(WhatsNewFallback, { version: '0.18.1', current: false }));
    expect(out).toContain('class="sc-wn-media sc-wn-fallback"');
    // small enough that the build inlines it: recognised by the og-image's own ground, #11100E
    expect(out).toMatch(/<img src="(data:image\/svg\+xml[^"]*%2311100E|[^"]*whatsnew-fallback[^"]*\.svg)[^"]*" alt=""/);
    expect(out).toContain('data-theme="dark"');
    expect(out).toContain('0.18.1');
    // not a control: nothing to press, nothing that opens larger
    expect(out).not.toContain('<button');
    expect(out).not.toContain('sc-wn-open');
  });

  it('never becomes the release picture: a release without an image owns none', () => {
    expect(pictureOf(release())).toBeNull();
    expect(pictureOf(null)).toBeNull();
  });

  it('a picture the build does not carry reads as none, so the dialog falls back and the page shows no hole', () => {
    const missing = release({
      sections: [
        {
          heading: 'Codex',
          body: 'Codex keeps no copy of a picture once Scenri has it.',
          image: { file: '0.19.1-not-in-this-build.webp', alt: 'A picture that was never shipped.' },
        },
      ],
    });
    expect(pictureOf(missing)).toBeNull();
  });

  it('a picture the build carries is the release picture, with its own words', () => {
    const shipped = release({
      version: '0.19.0',
      sections: [
        {
          heading: 'Library',
          body: 'The library now holds 30 products, 19 presenters and 42 scenes.',
          image: { file: '0.19.0-home-examples.webp', alt: 'Home in a full-size window.' },
        },
      ],
    });
    const pic = pictureOf(shipped);
    expect(pic?.alt).toBe('Home in a full-size window.');
    expect(pic?.src).toMatch(/0\.19\.0-home-examples/);
  });
});
