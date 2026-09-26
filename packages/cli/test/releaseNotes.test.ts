import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { globSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCore, type Core } from '@scenri/core';
import { buildServer } from '../src/server.js';
import { drainTracked, track } from './servers.js';
import {
  RELEASES,
  isNewsworthy,
  newFeaturesFor,
  newUntil,
  releaseFor,
  validateReleases,
  whatsNewWindow,
} from '../src/release/notes.data.js';
import type { ReleaseEntry, ReleaseSection } from '../src/release/notes.data.js';
import type { FastifyInstance } from 'fastify';

const pkg = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json'), 'utf8'));

let home: string;
let core: Core;
let app: FastifyInstance | null;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'sc-rel-'));
  core = createCore(home);
  app = null;
});
afterEach(async () => {
  // Drain rather than close, and every server rather than the one a variable
  // happens to hold: a thumbnail write outliving the home is ENOTEMPTY on
  // Linux and EBUSY on Windows.
  await drainTracked();
  try {
    core.close();
  } catch {
    // A drained server closes the core on its way out; closing twice throws.
  }
  rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

const build = () => track(buildServer({ core, engines: { all: () => [], get: () => null } }));

describe('the authored release notes', () => {
  it('is publishable: the validator finds nothing wrong with the real records', () => {
    expect(validateReleases(RELEASES, pkg.version)).toEqual([]);
  });

  it('knows a maintenance release from a newsworthy one', () => {
    // The one question that decides whether What's New may interrupt.
    expect(isNewsworthy(null)).toBe(false);
    expect(isNewsworthy({ version: '1.0.0', date: '2026-01-01', sections: [] })).toBe(false);
    expect(isNewsworthy({ version: '1.0.0', date: '2026-01-01', sections: [{ heading: 'Create', body: 'x' }] })).toBe(
      true,
    );
  });

  it('resolves by exact version, and answers null rather than guessing', () => {
    expect(releaseFor(RELEASES[0].version)).toBe(RELEASES[0]);
    expect(releaseFor('99.99.99')).toBeNull();
  });
});

describe('GET /api/release/notes', () => {
  it('seeds a fresh install as already seen, so nothing pops on first run', async () => {
    app = build();
    const res = await app.inject({ method: 'GET', url: '/api/release/notes' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.version).toBe(pkg.version);
    expect(body.seen).toBe(pkg.version);
    expect(body.entry).toEqual(releaseFor(pkg.version));
    expect(core.store.getSetting('install.firstVersion')).toBe(pkg.version);
  });

  it('an upgrade that already has brands and no marker is still stamped on first read', async () => {
    core.store.createBrand({ specVersion: '0.1', meta: { name: 'Existing' } });
    app = build();
    expect(core.store.getSetting('install.firstVersion')).toBeNull();
    const res = await app.inject({ method: 'GET', url: '/api/release/notes' });
    expect(res.json().seen).toBe(pkg.version);
    expect(core.store.getSetting('install.firstVersion')).toBe(pkg.version);
  });

  it('never links a tag that cannot exist', async () => {
    // Zero tags exist until the first release, so pointing "Full changelog" at
    // v0.0.0 is a guaranteed 404. The releases index is the honest target, and
    // every other version a user can run was published — which is what creates
    // the tag in the first place.
    app = build();
    const res = await app.inject({ method: 'GET', url: '/api/release/notes' });
    const { version, changelogUrl } = res.json();
    if (version === '0.0.0' || version === '0.1.0' || version === '0.1.1') {
      // 0.0.0 is the unbumped development placeholder, and the 0.1.x builds
      // were published, unpublished, and never tagged. In every one of those
      // cases the tag does not exist and null is the only honest answer.
      expect(changelogUrl).toBeNull();
    } else {
      expect(changelogUrl).toContain(`/releases/tag/v${version}`);
    }
  });

  it('points the archive at the index, not at one tag, and only when there is one', async () => {
    // "All releases" is the whole archive and outlives whatever is running, so
    // it must never be the sentinel for "was this build released" —
    // changelogUrl is.
    app = build();
    const { releasesUrl } = (await app.inject({ method: 'GET', url: '/api/release/notes' })).json();
    if (RELEASES.some(isNewsworthy)) {
      expect(releasesUrl).toMatch(/\/releases$/);
      expect(releasesUrl).not.toContain('/tag/');
    } else {
      expect(releasesUrl).toBeNull();
    }
  });

  it('leaves an older acknowledgement alone once the marker exists', async () => {
    app = build();
    await app.inject({ method: 'GET', url: '/api/release/notes' });
    core.store.setSetting('whatsnew.seen', '0.0.1');
    const res = await app.inject({ method: 'GET', url: '/api/release/notes' });
    expect(res.json().seen).toBe('0.0.1');
  });

  it('never asks the network for any of it', async () => {
    let called = false;
    app = track(
      buildServer({
        core,
        engines: { all: () => [], get: () => null },
        fetchImpl: (async () => {
          called = true;
          return new Response('{}', { status: 200 });
        }) as typeof fetch,
      }),
    );
    await app.inject({ method: 'GET', url: '/api/release/notes' });
    expect(called).toBe(false);
  });

  it('a fresh install gets the window with nothing unseen and nothing to lead', async () => {
    app = build();
    const body = (await app.inject({ method: 'GET', url: '/api/release/notes' })).json();
    expect(body.recent).toEqual(whatsNewWindow(RELEASES, pkg.version, pkg.version).recent);
    expect(body.unseen).toEqual([]);
    expect(body.lead).toBeNull();
  });

  it('an older acknowledgement answers exactly what the window says is new since then', async () => {
    app = build();
    expect(core.store.getSetting('install.firstVersion')).not.toBeNull();
    // The oldest record the app still shows: everything above it is unread.
    const older = whatsNewWindow(RELEASES, pkg.version).recent.at(-1)?.version as string;
    core.store.setSetting('whatsnew.seen', older);
    const body = (await app.inject({ method: 'GET', url: '/api/release/notes' })).json();
    const expected = whatsNewWindow(RELEASES, pkg.version, older);
    expect(body.seen).toBe(older);
    expect(body.recent).toEqual(expected.recent);
    expect(body.unseen).toEqual(expected.unseen);
    expect(body.lead).toBe(expected.lead);
    expect(body.unseen.length).toBeGreaterThan(0);
  });

  it('answers with the whole history beside the window, the same whatever was seen', async () => {
    app = build();
    const fresh = (await app.inject({ method: 'GET', url: '/api/release/notes' })).json();
    // The page's one list: the headline-only list it replaced is gone from the answer.
    expect(Object.keys(fresh).sort()).toEqual(
      [
        'changelogUrl',
        'entry',
        'history',
        'lead',
        'newFeatures',
        'recent',
        'releasesUrl',
        'seen',
        'unseen',
        'version',
      ].sort(),
    );
    expect(fresh.history).toEqual(whatsNewWindow(RELEASES, pkg.version, fresh.seen).history);
    expect(fresh.history.length).toBeGreaterThanOrEqual(fresh.recent.length);
    expect(fresh.history.slice(0, fresh.recent.length)).toEqual(fresh.recent);
    core.store.setSetting('whatsnew.seen', '0.0.1');
    const behind = (await app.inject({ method: 'GET', url: '/api/release/notes' })).json();
    expect(behind.seen).toBe('0.0.1');
    expect(behind.history).toEqual(whatsNewWindow(RELEASES, pkg.version, '0.0.1').history);
    expect(behind.history).toEqual(fresh.history);
  });

  it('a newer acknowledgement than this build is echoed as it is, with nothing unseen', async () => {
    app = build();
    core.store.setSetting('whatsnew.seen', '99.0.0');
    const body = (await app.inject({ method: 'GET', url: '/api/release/notes' })).json();
    expect(body.seen).toBe('99.0.0');
    expect(body.unseen).toEqual([]);
    expect(body.lead).toBeNull();
    expect(body.recent).toEqual(whatsNewWindow(RELEASES, pkg.version).recent);
    expect(core.store.getSetting('whatsnew.seen')).toBe('99.0.0');
  });

  it('heals a marked home that lost its acknowledgement to the running version', async () => {
    // A brand keeps the boot stamp away, so the marker below is the only one.
    core.store.createBrand({ specVersion: '0.1', meta: { name: 'Existing' } });
    core.store.setSetting('install.firstVersion', '0.2.0');
    app = build();
    expect(core.store.getSetting('whatsnew.seen')).toBeNull();
    const body = (await app.inject({ method: 'GET', url: '/api/release/notes' })).json();
    expect(body.seen).toBe(pkg.version);
    expect(body.unseen).toEqual([]);
    expect(core.store.getSetting('whatsnew.seen')).toBe(pkg.version);
    expect(core.store.getSetting('install.firstVersion')).toBe('0.2.0');
  });

  it('stamping a home from before the marker never lowers its acknowledgement', async () => {
    core.store.createBrand({ specVersion: '0.1', meta: { name: 'Existing' } });
    core.store.setSetting('whatsnew.seen', '99.0.0');
    app = build();
    const body = (await app.inject({ method: 'GET', url: '/api/release/notes' })).json();
    expect(core.store.getSetting('install.firstVersion')).toBe(pkg.version);
    expect(body.seen).toBe('99.0.0');
    expect(core.store.getSetting('whatsnew.seen')).toBe('99.0.0');
  });
});

describe('POST /api/release/seen', () => {
  it('records the version the client says it was shown', async () => {
    app = build();
    await app.inject({ method: 'GET', url: '/api/release/notes' });
    core.store.setSetting('whatsnew.seen', '0.0.1');
    const res = await app.inject({ method: 'POST', url: '/api/release/seen', payload: { version: '0.2.0' } });
    expect(res.statusCode).toBe(200);
    expect(core.store.getSetting('whatsnew.seen')).toBe('0.2.0');
  });

  it('falls back to the running version when the client sends nothing usable', async () => {
    app = build();
    core.store.setSetting('whatsnew.seen', '0.0.1');
    const res = await app.inject({ method: 'POST', url: '/api/release/seen', payload: {} });
    expect(res.statusCode).toBe(200);
    expect(core.store.getSetting('whatsnew.seen')).toBe(pkg.version);
  });

  it('never lowers the acknowledgement: a stale tab reading an older version changes nothing', async () => {
    app = build();
    await app.inject({ method: 'GET', url: '/api/release/notes' });
    core.store.setSetting('whatsnew.seen', '99.0.0');
    const res = await app.inject({ method: 'POST', url: '/api/release/seen', payload: { version: '0.2.0' } });
    expect(res.statusCode).toBe(200);
    expect(core.store.getSetting('whatsnew.seen')).toBe('99.0.0');
  });

  it('reads a version that is not a plain triplet as the running one', async () => {
    app = build();
    core.store.setSetting('whatsnew.seen', '0.0.1');
    const res = await app.inject({ method: 'POST', url: '/api/release/seen', payload: { version: 'latest' } });
    expect(res.statusCode).toBe(200);
    expect(core.store.getSetting('whatsnew.seen')).toBe(pkg.version);
  });
});

/** The validator is the gate a release has to pass, so it gets its own cases. */
describe('validateReleases', () => {
  const ok = (over: Partial<ReleaseEntry> = {}): ReleaseEntry => ({
    version: '0.2.0',
    date: '2026-08-16',
    title: 'Asset selection is steadier on mobile',
    sections: [{ heading: 'Create', body: 'Asset selection is steadier on mobile.' }],
    ...over,
  });

  it('passes a well-formed record', () => {
    expect(validateReleases([ok()], '0.2.0')).toEqual([]);
  });

  it('catches the mismatch this whole system exists to prevent', () => {
    const problems = validateReleases([ok({ version: '0.1.0' })], '0.2.0');
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('0.1.0');
    expect(problems[0]).toContain('0.2.0');
  });

  it('lets 0.0.0 through: nothing has been released yet, so nothing can mismatch', () => {
    expect(validateReleases([ok({ version: '0.1.0' })], '0.0.0')).toEqual([]);
  });

  it('refuses a version with no record at all', () => {
    expect(validateReleases([], '0.2.0')).toEqual(['there are no release records at all']);
  });

  it('accepts a maintenance release stating it has no news', () => {
    expect(validateReleases([ok({ title: undefined, sections: [] })], '0.2.0')).toEqual([]);
  });

  it('refuses a section that exists and says nothing', () => {
    expect(validateReleases([ok({ sections: [{ heading: 'Create', body: '  ' }] })], '0.2.0')).toEqual([
      'release 0.2.0: section "Create" says nothing',
    ]);
    expect(validateReleases([ok({ sections: [{ heading: '', body: 'x' }] })], '0.2.0')).toEqual([
      'release 0.2.0: a section with no heading',
    ]);
    expect(validateReleases([ok({ title: '   ' })], '0.2.0')).toContain('release 0.2.0: empty title');
  });

  it('refuses a duplicate version, and records that are not newest first', () => {
    const problems = validateReleases([ok(), ok()], '0.2.0');
    expect(problems).toContain('release 0.2.0: described twice');
    expect(problems).toContain('release 0.2.0: out of order; records run newest first');
  });

  it('refuses a changelog wearing a dialog: at most four sections', () => {
    const five = Array.from({ length: 5 }, (_, i) => ({ heading: `H${i}`, body: 'x' }));
    expect(validateReleases([ok({ sections: five })], '0.2.0')).toContain(
      'release 0.2.0: 5 sections; four is the ceiling',
    );
  });

  it('refuses hype, emoji and long dashes, wherever they hide', () => {
    expect(
      validateReleases([ok({ sections: [{ heading: 'Create', body: 'A revolutionary new way to work.' }] })], '0.2.0'),
    ).toContain('release 0.2.0: hype copy; say what changed, not how amazing it is');
    expect(validateReleases([ok({ title: 'Unlock the power of Scenri' })], '0.2.0')).toHaveLength(1);
    expect(validateReleases([ok({ sections: [{ heading: 'Create', body: 'Faster now 🚀' }] })], '0.2.0')).toContain(
      'release 0.2.0: emoji',
    );
    expect(validateReleases([ok({ sections: [{ heading: 'Create', body: 'Faster — really.' }] })], '0.2.0')).toContain(
      'release 0.2.0: long dash',
    );
  });

  it('refuses a malformed version or date', () => {
    expect(validateReleases([ok({ version: 'v0.2' })], '0.2.0').join(' ')).toContain('not a plain semver');
    expect(validateReleases([ok({ date: '16/08/2026' })], '0.2.0').join(' ')).toContain('yyyy-mm-dd');
  });

  it('refuses two sections with one heading', () => {
    const twice = [
      { heading: 'Create', body: 'One thing.' },
      { heading: 'Create', body: 'Another thing.' },
    ];
    expect(validateReleases([ok({ sections: twice })], '0.2.0')).toEqual([
      'release 0.2.0: two sections are called "Create"',
    ]);
  });

  it('refuses a headline update that does not say what it is', () => {
    expect(validateReleases([ok({ title: undefined, announce: true })], '0.2.0')).toContain(
      'release 0.2.0: a headline update announces itself with its title; write one',
    );
  });

  it('refuses a headline with nothing under it', () => {
    expect(validateReleases([ok({ title: 'A quiet one.', sections: [] })], '0.2.0')).toEqual([
      'release 0.2.0: a title with no sections; a maintenance release has neither',
    ]);
  });

  /** Pictures and the in-app copy rules, one rule per case: each fixture trips only the rule it names. */
  describe('pictures and the in-app window', () => {
    const alt = 'The Create page with the panel open beside the feed.';
    const section = (heading: string, image?: ReleaseSection['image']): ReleaseSection => ({
      heading,
      body: `The ${heading.toLowerCase()} view is steadier on mobile.`,
      ...(image ? { image } : {}),
    });
    const pictured = (file: string, altText = alt) => section('Create', { file, alt: altText });
    const headline = (over: Partial<ReleaseEntry> = {}): ReleaseEntry => ({
      version: '0.2.0',
      date: '2026-08-16',
      title: 'A calmer Create page',
      announce: true,
      sections: [pictured('0.2.0-create.webp')],
      ...over,
    });
    /** Five newer headlines above a record, which pushes it out of the window. */
    const outside = (r: ReleaseEntry): ReleaseEntry[] => [
      ...['0.7.0', '0.6.0', '0.5.0', '0.4.0', '0.3.0'].map((version) => ({
        version,
        date: '2026-08-20',
        title: `Headline ${version}`,
        announce: true as const,
        sections: [section('Create')],
      })),
      r,
    ];

    it('passes a headline with one picture, on any of its sections', () => {
      for (const at of [0, 1, 2]) {
        const sections = ['Create', 'Scenes', 'Presenters'].map((h, i) =>
          i === at ? section(h, { file: '0.2.0-create.webp', alt }) : section(h),
        );
        expect(validateReleases([headline({ sections })], '0.2.0'), `picture on section ${at}`).toEqual([]);
      }
    });

    it('passes a picture on a small update as well as a headline', () => {
      expect(validateReleases([headline({ announce: undefined })], '0.2.0')).toEqual([]);
    });

    it('refuses a second picture: one picture per release, never a set', () => {
      // A big release gets a smarter picture, not more of them.
      const two = [pictured('0.2.0-create.webp'), section('Scenes', { file: '0.2.0-scene-page.webp', alt })];
      expect(validateReleases([headline({ sections: two })], '0.2.0')).toEqual([
        'release 0.2.0: one picture per release; 2 sections carry one',
      ]);
      const three = ['Create', 'Scenes', 'Presenters'].map((h) =>
        section(h, { file: `0.2.0-${h.toLowerCase()}.webp`, alt }),
      );
      expect(validateReleases([headline({ sections: three })], '0.2.0')).toEqual([
        'release 0.2.0: one picture per release; 3 sections carry one',
      ]);
    });

    it('refuses a picture named anything but <version>-<words>.webp, and any path', () => {
      for (const file of [
        '../x.webp',
        '../0.2.0-create.webp',
        'whatsnew/0.2.0-create.webp',
        '0.1.0-create.webp',
        '0.2.1-create.webp',
        'create.webp',
        '0.2.0-.webp',
        '0.2.0-Create.webp',
        '0.2.0-create.png',
        '0.2.0-create.webp.png',
        '0x2x0-create.webp',
      ]) {
        expect(validateReleases([headline({ sections: [pictured(file)] })], '0.2.0'), file).toEqual([
          `release 0.2.0: picture "${file}" must be named 0.2.0-<words>.webp, a file name and never a path`,
        ]);
      }
    });

    it('refuses a picture with no words for someone who cannot see it', () => {
      expect(validateReleases([headline({ sections: [pictured('0.2.0-create.webp', '  ')] })], '0.2.0')).toEqual([
        'release 0.2.0: picture "0.2.0-create.webp" has no alt text',
      ]);
    });

    it('refuses alt text past 140 characters, and allows exactly 140', () => {
      const long = 'x'.repeat(141);
      expect(validateReleases([headline({ sections: [pictured('0.2.0-create.webp', long)] })], '0.2.0')).toEqual([
        'release 0.2.0: alt text for "0.2.0-create.webp" is 141 characters; say what is on screen in 140 or fewer',
      ]);
      const edge = 'x'.repeat(140);
      expect(validateReleases([headline({ sections: [pictured('0.2.0-create.webp', edge)] })], '0.2.0')).toEqual([]);
    });

    it('holds alt text to the same copy rules as the words beside it', () => {
      const withAlt = (text: string) =>
        validateReleases([headline({ sections: [pictured('0.2.0-create.webp', text)] })], '0.2.0');
      expect(withAlt('The panel, seamlessly open.')).toEqual([
        'release 0.2.0: hype copy; say what changed, not how amazing it is',
      ]);
      expect(withAlt('The panel open \u{1F680}')).toEqual(['release 0.2.0: emoji']);
      expect(withAlt('The panel — open.')).toEqual(['release 0.2.0: long dash']);
    });

    it('refuses one picture used twice', () => {
      // Twice in one record is two pictures in it as well; the two arrive together by construction.
      const twice = [pictured('0.2.0-create.webp'), section('Scenes', { file: '0.2.0-create.webp', alt })];
      expect(validateReleases([headline({ sections: twice })], '0.2.0')).toEqual([
        'release 0.2.0: one picture per release; 2 sections carry one',
        'release 0.2.0: picture "0.2.0-create.webp" is used twice',
      ]);
    });

    it('refuses a picture on a record the app no longer shows', () => {
      expect(validateReleases(outside(headline()), '0.7.0')).toEqual([
        'release 0.2.0: outside the in-app window, so it carries no pictures; delete their image fields and files',
      ]);
      // The same record without its picture is fine where it is.
      expect(validateReleases(outside(headline({ sections: [section('Create')] })), '0.7.0')).toEqual([]);
    });

    describe('inside the window, and only there', () => {
      /** Each case: the record, and the one problem it has in the app. */
      const cases: [string, ReleaseEntry, string][] = [
        [
          'four sections',
          ok({ sections: ['Create', 'Scenes', 'Presenters', 'Products'].map((h) => section(h)) }),
          "release 0.2.0: 4 sections; What's New shows three at most",
        ],
        [
          'a title past 64 characters',
          ok({ title: 'x'.repeat(65) }),
          'release 0.2.0: title is 65 characters; a title fits in 64',
        ],
        [
          'a body past 220 characters',
          ok({ sections: [{ heading: 'Create', body: 'x'.repeat(221) }] }),
          'release 0.2.0: section "Create" is 221 characters; two short sentences fit in 220',
        ],
        [
          'the word brief',
          ok({ sections: [{ heading: 'Create', body: 'The brief keeps its chips.' }] }),
          'release 0.2.0: on screen it is the prompt, never the brief',
        ],
        [
          'the word briefs',
          ok({ sections: [{ heading: 'Create', body: 'Briefs keep their chips.' }] }),
          'release 0.2.0: on screen it is the prompt, never the brief',
        ],
      ];

      for (const [name, record, problem] of cases) {
        it(`refuses ${name} in the app, and leaves it alone in the archive`, () => {
          expect(validateReleases([record], '0.2.0')).toEqual([problem]);
          expect(validateReleases(outside(record), '0.7.0')).toEqual([]);
        });
      }

      it('allows the limits themselves', () => {
        expect(validateReleases([ok({ title: 'x'.repeat(64) })], '0.2.0')).toEqual([]);
        expect(validateReleases([ok({ sections: [{ heading: 'Create', body: 'x'.repeat(220) }] })], '0.2.0')).toEqual(
          [],
        );
        expect(
          validateReleases([ok({ sections: ['Create', 'Scenes', 'Presenters'].map((h) => section(h)) })], '0.2.0'),
        ).toEqual([]);
      });
    });

    describe('every record the page lists, in the window or below it', () => {
      // the lowercase name is spelled in two halves so the pre-commit name check lets the fixture through
      const name = `${'scen'}ri`;
      const lowercase = `release 0.2.0: "${name}" in a sentence is Scenri`;
      const brief = 'release 0.2.0: on screen it is the prompt, never the brief';
      const versionsOf = (records: ReleaseEntry[]) => records.map((r) => r.version);

      /** Each case: what the record says, and the one problem it has wherever the page lists it. */
      const cases: [string, Partial<ReleaseEntry>, string][] = [
        [
          'an update with no title',
          { title: undefined },
          'release 0.2.0: every update the app shows has a title; write one',
        ],
        [
          'a headline ending with a full stop',
          { title: 'A calmer Create page.' },
          'release 0.2.0: a headline ends without a full stop',
        ],
        ['the word brief in a headline', { title: 'A steadier brief on phones' }, brief],
        ['the word briefs in a headline', { title: 'Briefs keep their chips' }, brief],
        [
          'a section that opens by repeating its heading',
          { sections: [{ heading: 'Codex', body: 'Codex keeps no copy of a picture.' }] },
          'release 0.2.0: section "Codex" opens by repeating its heading; the heading already says it',
        ],
        ['the name in lowercase in a headline', { title: `A calmer ${name} on phones` }, lowercase],
        [
          'the name in lowercase in a body',
          { sections: [{ heading: 'Create', body: `Open ${name} on a phone.` }] },
          lowercase,
        ],
      ];

      for (const [label, says, problem] of cases) {
        it(`refuses ${label} in the window and in the history below it, and leaves the internal era alone`, () => {
          const record = ok(says);
          // In the window. The window's own copy rules can name the same problem
          // again, so the distinct problems are what count here.
          expect([...new Set(validateReleases([record], '0.2.0'))]).toEqual([problem]);
          // Below the window: out of recent, still in the history the page lists.
          const below = whatsNewWindow(outside(record), '0.7.0');
          expect(versionsOf(below.recent)).not.toContain('0.2.0');
          expect(versionsOf(below.history)).toContain('0.2.0');
          expect(validateReleases(outside(record), '0.7.0')).toEqual([problem]);
          // The same words on a 0.1.x record: never listed, so never read on screen.
          const internal = ok({ ...says, version: '0.1.5' });
          expect(versionsOf(whatsNewWindow(outside(internal), '0.7.0').history)).not.toContain('0.1.5');
          expect(validateReleases(outside(internal), '0.7.0')).toEqual([]);
        });
      }

      it('lets the command keep its lowercase name in a record the page lists', () => {
        const command = ok({ sections: [{ heading: 'Updates', body: `Run npx ${name}@latest once in a terminal.` }] });
        expect(versionsOf(whatsNewWindow(outside(command), '0.7.0').history)).toContain('0.2.0');
        expect(validateReleases(outside(command), '0.7.0')).toEqual([]);
      });

      it('still refuses the name beside the command: the exception is the command, not the record', () => {
        const both = ok({
          sections: [{ heading: 'Updates', body: `Run npx ${name}@latest once, then open ${name} as usual.` }],
        });
        expect(validateReleases(outside(both), '0.7.0')).toEqual([lowercase]);
      });

      it('reads past an article both open with, and never counts one only the sentence opens with', () => {
        const studio = ok({ sections: [{ heading: 'The studio', body: 'The Scenri mark sits in the top bar.' }] });
        expect(validateReleases([studio], '0.2.0')).toEqual([]);
        const library = ok({ sections: [{ heading: 'Library', body: 'The library download is checked first.' }] });
        expect(validateReleases([library], '0.2.0')).toEqual([]);
        const twice = ok({ sections: [{ heading: 'The studio', body: 'The studio opens faster.' }] });
        expect(validateReleases([twice], '0.2.0')).toEqual([
          'release 0.2.0: section "The studio" opens by repeating its heading; the heading already says it',
        ]);
      });

      it('leaves a full stop inside a headline alone', () => {
        expect(validateReleases([ok({ title: 'Scenes 2.0 in Create' })], '0.2.0')).toEqual([]);
        expect(validateReleases(outside(ok({ title: 'Scenes 2.0 in Create' })), '0.7.0')).toEqual([]);
      });
    });
  });

  it('holds New to kebab-case ids, each marked once in the whole record', () => {
    expect(validateReleases([ok({ newFeatures: ['Local Access'] })], '0.2.0')).toContain(
      'release 0.2.0: "Local Access" is not a kebab-case id',
    );
    const twice = [
      ok({ version: '0.3.0', date: '2026-09-01', newFeatures: ['local-access'] }),
      ok({ newFeatures: ['local-access'] }),
    ];
    expect(validateReleases(twice, '0.3.0')).toContain('release 0.2.0: "local-access" is marked New twice');
  });

  it('never lets more than three features say New at once, for anyone', () => {
    // 0.2.0's window runs 2026-08-16 to 2026-09-15, so on 2026-08-20 all four would show.
    const four = [
      ok({ version: '0.3.0', date: '2026-08-20', newFeatures: ['c', 'd'] }),
      ok({ newFeatures: ['a', 'b'] }),
    ];
    expect(validateReleases(four, '0.3.0')).toContain(
      'release 0.3.0: 4 features would say New at once; 3 is the ceiling',
    );
    const three = [ok({ version: '0.3.0', date: '2026-08-20', newFeatures: ['c'] }), ok({ newFeatures: ['a', 'b'] })];
    expect(validateReleases(three, '0.3.0')).toEqual([]);
    // A window that closed before the next one opened is not counted with it.
    const apart = [
      ok({ version: '0.3.0', date: '2026-10-01', newFeatures: ['c', 'd'] }),
      ok({ newFeatures: ['a', 'b'] }),
    ];
    expect(validateReleases(apart, '0.3.0')).toEqual([]);
  });

  it('marks New only on a release that says what it brought', () => {
    expect(validateReleases([ok({ sections: [], newFeatures: ['local-access'] })], '0.2.0')).toContain(
      "release 0.2.0: marks something New but says nothing in What's New",
    );
  });
});

/**
 * New (DESIGN.md, "New"): the few features a release marks, for installs that
 * began before it, until used or until thirty days after the release.
 */
describe('what says New on an install', () => {
  const rel = (version: string, date: string, newFeatures: string[]): ReleaseEntry => ({
    version,
    date,
    sections: [{ heading: 'Create', body: 'x' }],
    newFeatures,
  });
  const at = (day: string) => Date.parse(`${day}T12:00:00Z`);
  const releases = [
    rel('0.4.0', '2026-03-01', ['framing']),
    rel('0.3.0', '2026-02-10', ['local-access']),
    rel('0.2.0', '2026-01-01', ['old-thing']),
  ];

  it('says nothing to an install that began on the release that brought it, or after', () => {
    expect(newFeaturesFor(releases, { firstVersion: '0.4.0', used: [], now: at('2026-03-02') })).toEqual([]);
  });

  it('marks what arrived after the install began, while its window is open', () => {
    expect(newFeaturesFor(releases, { firstVersion: '0.2.0', used: [], now: at('2026-03-02') })).toEqual([
      'framing',
      'local-access',
    ]);
  });

  it('lets a used feature go, and only that one', () => {
    expect(newFeaturesFor(releases, { firstVersion: '0.2.0', used: ['framing'], now: at('2026-03-02') })).toEqual([
      'local-access',
    ]);
  });

  it('lets a feature go by itself thirty days after its release', () => {
    // 0.3.0 is 2026-02-10: New through 2026-03-11, gone from 2026-03-12.
    expect(newUntil(releases[1])).toBe(Date.parse('2026-03-12T00:00:00Z'));
    expect(newFeaturesFor(releases, { firstVersion: '0.2.0', used: [], now: at('2026-03-11') })).toContain(
      'local-access',
    );
    expect(newFeaturesFor(releases, { firstVersion: '0.2.0', used: [], now: at('2026-03-12') })).not.toContain(
      'local-access',
    );
  });

  it('shows someone who skipped many releases only what is still new, never the whole year', () => {
    expect(newFeaturesFor(releases, { firstVersion: '0.1.0', used: [], now: at('2026-03-20') })).toEqual(['framing']);
  });

  it('says nothing without an install marker', () => {
    expect(newFeaturesFor(releases, { firstVersion: null, used: [], now: at('2026-03-02') })).toEqual([]);
  });
});

describe('New over the notes read', () => {
  // Whichever release marks something, so the positive case never hangs on
  // one feature: once none is left to say New, it is skipped rather than kept.
  const declared = RELEASES.find((r) => r.newFeatures?.length);

  afterEach(() => {
    vi.useRealTimers();
  });

  it('says nothing New to a fresh install', async () => {
    app = build();
    const res = await app.inject({ method: 'GET', url: '/api/release/notes' });
    expect(res.json().newFeatures).toEqual([]);
  });

  it('refuses to record an id no release marked, and stores nothing', async () => {
    app = build();
    const res = await app.inject({ method: 'POST', url: '/api/release/used', payload: { feature: 'not-a-feature' } });
    expect(res.statusCode).toBe(400);
    expect(core.store.getSetting('features.used')).toBeNull();
  });

  it.skipIf(!declared)('marks a feature for an install that predates it, until it is used', async () => {
    const release = declared as ReleaseEntry;
    const feature = (release.newFeatures as string[])[0];
    vi.setSystemTime(Date.parse(`${release.date}T12:00:00Z`));
    // Seeded before the first read: without it the read stamps the running version.
    core.store.setSetting('install.firstVersion', '0.2.0');
    app = build();
    const read = async () =>
      (await (app as FastifyInstance).inject({ method: 'GET', url: '/api/release/notes' })).json();

    expect((await read()).newFeatures).toContain(feature);
    const res = await app.inject({ method: 'POST', url: '/api/release/used', payload: { feature } });
    expect(res.statusCode).toBe(200);
    expect((await read()).newFeatures).not.toContain(feature);
    expect(JSON.parse(core.store.getSetting('features.used') ?? '[]')).toEqual([feature]);
  });
});

describe('New, wired where it lives', () => {
  it('gives every feature that can still say New a way in and a use in the studio', () => {
    // The record names a feature; the studio has to carry it. A typo on either
    // side would otherwise be a label that never shows or never goes. Only
    // features whose window is still open at the newest release are held to
    // it: any build from this tree ships on or after that date, so a closed
    // one can never show again, and its lines are inert until someone removes them.
    const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
    const studio = globSync('apps/studio/src/**/*.{ts,tsx}', { cwd: root })
      .map((f) => readFileSync(join(root, f), 'utf8'))
      .join('\n');
    const newest = Date.parse(`${RELEASES[0].date}T00:00:00Z`);
    const problems: string[] = [];
    for (const r of RELEASES) {
      if (newest >= newUntil(r)) continue;
      for (const f of r.newFeatures ?? []) {
        if (!new RegExp(`feature(=|:\\s*)['"]${f}['"]`).test(studio))
          problems.push(`${f}: nothing in apps/studio/src carries feature="${f}" (its way in)`);
        // The raw write is api.releaseUsed, named apart so it can never pass for
        // a use: on its own it would leave the label on screen.
        if (!new RegExp(`\\bmarkUsed\\(['"]${f}['"]\\)`).test(studio))
          problems.push(`${f}: nothing in apps/studio/src calls markUsed('${f}') (its use)`);
      }
    }
    expect(problems).toEqual([]);
  });
});
