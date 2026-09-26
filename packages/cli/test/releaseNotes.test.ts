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
} from '../src/release/notes.data.js';
import type { ReleaseEntry } from '../src/release/notes.data.js';
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
