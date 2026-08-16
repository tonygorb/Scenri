import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCore, type Core } from '@scenri/core';
import { buildServer } from '../src/server.js';
import { RELEASES, isNewsworthy, releaseFor, validateReleases } from '../src/release/notes.data.js';
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
  await app?.close();
  core.close();
  rmSync(home, { recursive: true, force: true });
});

const build = () => buildServer({ core, engines: { all: () => [], get: () => null } });

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

  it('never links a tag that cannot exist', async () => {
    // Zero tags exist until the first release, so pointing "Full changelog" at
    // v0.0.0 is a guaranteed 404. The releases index is the honest target, and
    // every other version a user can run was published — which is what creates
    // the tag in the first place.
    app = build();
    const res = await app.inject({ method: 'GET', url: '/api/release/notes' });
    const { version, changelogUrl } = res.json();
    if (version === '0.0.0') {
      // Nothing has been released, so the releases index is an empty page and
      // the tag does not exist. Null is the only honest answer, and it is what
      // tells the dialog this is a development build.
      expect(changelogUrl).toBeNull();
    } else {
      expect(changelogUrl).toContain(`/releases/tag/v${version}`);
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
    app = buildServer({
      core,
      engines: { all: () => [], get: () => null },
      fetchImpl: (async () => {
        called = true;
        return new Response('{}', { status: 200 });
      }) as typeof fetch,
    });
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
    expect(problems).toContain('release 0.2.0: out of order — records run newest first');
  });

  it('refuses a changelog wearing a dialog: at most four sections', () => {
    const five = Array.from({ length: 5 }, (_, i) => ({ heading: `H${i}`, body: 'x' }));
    expect(validateReleases([ok({ sections: five })], '0.2.0')).toContain(
      'release 0.2.0: 5 sections — four is the ceiling',
    );
  });

  it('refuses hype, emoji and long dashes, wherever they hide', () => {
    expect(
      validateReleases([ok({ sections: [{ heading: 'Create', body: 'A revolutionary new way to work.' }] })], '0.2.0'),
    ).toContain('release 0.2.0: hype copy — say what changed, not how amazing it is');
    expect(validateReleases([ok({ title: 'Unlock the power of scenri' })], '0.2.0')).toHaveLength(1);
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
});
