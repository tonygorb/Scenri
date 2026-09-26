import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HEADLINES_KEPT, RELEASES, isNewsworthy, whatsNewWindow } from '../src/release/notes.data.js';
import type { ReleaseEntry } from '../src/release/notes.data.js';
import { compareSemver } from '../src/update/versionsDir.js';

const pkg = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json'), 'utf8'));

/** A small update: sections, no title. */
const small = (version: string): ReleaseEntry => ({
  version,
  date: '2026-01-01',
  sections: [{ heading: 'Fixes', body: `Fixed in ${version}.` }],
});
/** A headline update: the same, with a title. */
const headline = (version: string): ReleaseEntry => ({ ...small(version), title: `Headline ${version}.` });
/** A maintenance release: nothing to tell. */
const quiet = (version: string): ReleaseEntry => ({ version, date: '2026-01-01', sections: [] });

const versions = (records: ReleaseEntry[]) => records.map((r) => r.version);

describe('whatsNewWindow: what the app shows', () => {
  it('stops right after the last kept headline, keeping the small updates between them', () => {
    const releases = [
      headline('1.10.0'),
      small('1.9.0'),
      headline('1.8.0'),
      headline('1.7.0'),
      small('1.6.0'),
      headline('1.5.0'),
      small('1.4.0'),
      headline('1.3.0'),
      small('1.2.0'),
      headline('1.1.0'),
      small('1.0.0'),
    ];
    const { recent } = whatsNewWindow(releases, '1.10.0');
    // The fixture holds five headlines above the cut; it is written for the
    // shipped constant.
    expect(HEADLINES_KEPT).toBe(5);
    expect(versions(recent)).toEqual(['1.10.0', '1.9.0', '1.8.0', '1.7.0', '1.6.0', '1.5.0', '1.4.0', '1.3.0']);
    expect(recent.filter((r) => r.title)).toHaveLength(HEADLINES_KEPT);
  });

  it('skips a maintenance release: it is not news and takes no place', () => {
    const releases = [headline('1.3.0'), quiet('1.2.0'), small('1.1.0'), quiet('1.0.0')];
    expect(versions(whatsNewWindow(releases, '1.3.0').recent)).toEqual(['1.3.0', '1.1.0']);
  });

  it('keeps every newsworthy record at or below the running one when there are fewer headlines than kept', () => {
    const releases = [small('1.4.0'), headline('1.3.0'), small('1.2.0'), headline('1.1.0'), small('1.0.0')];
    expect(versions(whatsNewWindow(releases, '1.4.0').recent)).toEqual(['1.4.0', '1.3.0', '1.2.0', '1.1.0', '1.0.0']);
  });

  it('ignores records newer than the running build, and they spend none of the headline budget', () => {
    expect(versions(whatsNewWindow([headline('2.0.0'), small('1.1.0'), headline('1.0.0')], '1.1.0').recent)).toEqual([
      '1.1.0',
      '1.0.0',
    ]);
    const above = ['3.4.0', '3.3.0', '3.2.0', '3.1.0', '3.0.0'].map(headline);
    expect(versions(whatsNewWindow([...above, headline('2.1.0'), small('2.0.0')], '2.1.0').recent)).toEqual([
      '2.1.0',
      '2.0.0',
    ]);
  });

  it('lets a 0.0.0 build see the newest records and nothing unseen', () => {
    const releases = [headline('2.0.0'), small('1.0.0')];
    for (const seen of [null, '0.0.0', '1.0.0', '99.0.0', 'garbage']) {
      const w = whatsNewWindow(releases, '0.0.0', seen);
      expect(versions(w.recent)).toEqual(['2.0.0', '1.0.0']);
      expect(w.unseen).toEqual([]);
      expect(w.lead).toBeNull();
    }
  });
});

describe('whatsNewWindow: what is new here', () => {
  const releases = [
    small('1.5.0'),
    headline('1.4.0'),
    small('1.3.0'),
    headline('1.2.0'),
    small('1.1.0'),
    headline('1.0.0'),
  ];

  it('knows nothing is unseen without a seen version', () => {
    expect(whatsNewWindow(releases, '1.5.0')).toMatchObject({ unseen: [], lead: null });
    expect(whatsNewWindow(releases, '1.5.0', null)).toMatchObject({ unseen: [], lead: null });
  });

  it('has nothing new once the running version is seen', () => {
    expect(whatsNewWindow(releases, '1.5.0', '1.5.0')).toMatchObject({ unseen: [], lead: null });
  });

  it('one version behind to a headline: that headline is new and leads', () => {
    const w = whatsNewWindow(releases, '1.4.0', '1.3.0');
    expect(w.unseen).toEqual(['1.4.0']);
    expect(w.lead).toBe('1.4.0');
  });

  it('one version behind to a small update: it is new, and nothing leads', () => {
    const w = whatsNewWindow(releases, '1.5.0', '1.4.0');
    expect(w.unseen).toEqual(['1.5.0']);
    expect(w.lead).toBeNull();
  });

  it('several skipped: all of them, newest first, led by the newest headline even under a small update', () => {
    const w = whatsNewWindow(releases, '1.5.0', '1.1.0');
    expect(w.unseen).toEqual(['1.5.0', '1.4.0', '1.3.0', '1.2.0']);
    expect(w.lead).toBe('1.4.0');
  });

  it('a rolled-back build shows nothing new', () => {
    expect(whatsNewWindow(releases, '1.3.0', '1.5.0')).toMatchObject({ unseen: [], lead: null });
  });

  it('seen older than the whole window: everything in it is new, and nothing past it', () => {
    const w = whatsNewWindow(releases, '1.5.0', '0.1.0');
    expect(w.unseen).toEqual(versions(w.recent));
    expect(w.lead).toBe('1.4.0');

    const long = ['2.6.0', '2.5.0', '2.4.0', '2.3.0', '2.2.0', '2.1.0'].map(headline);
    const cut = whatsNewWindow(long, '2.6.0', '0.1.0');
    expect(cut.unseen).toEqual(['2.6.0', '2.5.0', '2.4.0', '2.3.0', '2.2.0']);
    expect(cut.lead).toBe('2.6.0');
  });

  it('compares versions as semver, never as strings, in both directions', () => {
    const tens = [headline('0.10.0'), small('0.9.0')];
    // As strings "0.9.0" sorts after "0.10.0" and the update would read as seen.
    expect(whatsNewWindow(tens, '0.10.0', '0.9.0')).toMatchObject({ unseen: ['0.10.0'], lead: '0.10.0' });
    // As strings "0.10.0" sorts before "0.9.0": a rolled-back 0.9.0 would read
    // 0.10.0 as below it and 0.9.0 as unseen.
    const back = whatsNewWindow(tens, '0.9.0', '0.10.0');
    expect(versions(back.recent)).toEqual(['0.9.0']);
    expect(back).toMatchObject({ unseen: [], lead: null });
  });

  it('counts a seen value that is not a version as older than everything', () => {
    for (const seen of ['garbage', 'v1.0.0', '1.0', '']) {
      const w = whatsNewWindow(releases, '1.5.0', seen);
      expect(w.unseen).toEqual(versions(w.recent));
      expect(w.lead).toBe('1.4.0');
    }
  });

  it('never counts a maintenance release as unseen, even the running one', () => {
    const w = whatsNewWindow([quiet('1.2.0'), headline('1.1.0'), small('1.0.0')], '1.2.0', '1.0.0');
    expect(versions(w.recent)).toEqual(['1.1.0', '1.0.0']);
    expect(w).toMatchObject({ unseen: ['1.1.0'], lead: '1.1.0' });
  });
});

describe('whatsNewWindow on the real records', () => {
  it('shows only news this build carries, down to the kept headlines, and nothing unseen once read', () => {
    const w = whatsNewWindow(RELEASES, pkg.version, pkg.version);
    expect(w.recent.length).toBeGreaterThan(0);
    for (const r of w.recent) {
      expect(isNewsworthy(r), `${r.version} is in the window without news`).toBe(true);
      expect(compareSemver(r.version, pkg.version), `${r.version} is newer than ${pkg.version}`).toBeLessThanOrEqual(0);
    }
    expect(w.recent.filter((r) => r.title).length).toBeLessThanOrEqual(HEADLINES_KEPT);
    expect(w.unseen).toEqual([]);
    expect(w.lead).toBeNull();
  });
});
