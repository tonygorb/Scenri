import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCore, type Core } from '@scenri/core';
import { buildServer } from '../src/server.js';
import { drainTracked, track } from './servers.js';
import { RELEASES, isNewsworthy, releaseFor, validateReleases, whatsNewWindow } from '../src/release/notes.data.js';
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
    expect(validateReleases([ok({ sections: [] })], '0.2.0')).toEqual([]);
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
      body: `${heading} is steadier on mobile.`,
      ...(image ? { image } : {}),
    });
    const pictured = (file: string, altText = alt) => section('Create', { file, alt: altText });
    const headline = (over: Partial<ReleaseEntry> = {}): ReleaseEntry => ({
      version: '0.2.0',
      date: '2026-08-16',
      title: 'A calmer Create page.',
      sections: [pictured('0.2.0-create.webp')],
      ...over,
    });
    /** Five newer headlines above a record, which pushes it out of the window. */
    const outside = (r: ReleaseEntry): ReleaseEntry[] => [
      ...['0.7.0', '0.6.0', '0.5.0', '0.4.0', '0.3.0'].map((version) => ({
        version,
        date: '2026-08-20',
        title: `Headline ${version}.`,
        sections: [section('Create')],
      })),
      r,
    ];

    it('passes a headline with three pictures', () => {
      const three = [
        pictured('0.2.0-create.webp'),
        section('Scenes', { file: '0.2.0-scene-page.webp', alt }),
        section('Presenters', { file: '0.2.0-p2.webp', alt }),
      ];
      expect(validateReleases([headline({ sections: three })], '0.2.0')).toEqual([]);
    });

    it('refuses a picture on a small update', () => {
      expect(validateReleases([headline({ title: undefined })], '0.2.0')).toEqual([
        'release 0.2.0: a picture on a small update; only a headline update (one with a title) carries pictures',
      ]);
    });

    it('refuses a fourth picture', () => {
      // Four pictures need four sections, and inside the window four sections
      // are their own problem; the two arrive together by construction.
      const four = ['Create', 'Scenes', 'Presenters', 'Products'].map((h) =>
        section(h, { file: `0.2.0-${h.toLowerCase()}.webp`, alt }),
      );
      expect(validateReleases([headline({ sections: four })], '0.2.0')).toEqual([
        'release 0.2.0: 4 pictures; three is the ceiling',
        "release 0.2.0: 4 sections; What's New shows three at most",
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
      const twice = [pictured('0.2.0-create.webp'), section('Scenes', { file: '0.2.0-create.webp', alt })];
      expect(validateReleases([headline({ sections: twice })], '0.2.0')).toEqual([
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
          'release 0.2.0: title is 65 characters; a headline fits in 64',
        ],
        [
          'a body past 220 characters',
          ok({ sections: [{ heading: 'Create', body: 'x'.repeat(221) }] }),
          'release 0.2.0: section "Create" is 221 characters; two short sentences fit in 220',
        ],
        [
          'the name in lowercase',
          // the lowercase name is spelled in two halves so the pre-commit name check lets the fixture through
          ok({ sections: [{ heading: 'Create', body: `Open ${'scen'}ri on a phone.` }] }),
          'release 0.2.0: "scenri" in a sentence is Scenri',
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
  });
});
