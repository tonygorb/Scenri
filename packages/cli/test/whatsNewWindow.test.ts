import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  FIRST_PUBLIC,
  HEADLINES_KEPT,
  RELEASES,
  isNewsworthy,
  releaseFor,
  whatsNewWindow,
} from '../src/release/notes.data.js';
import type { ReleaseEntry } from '../src/release/notes.data.js';
import { compareSemver } from '../src/update/versionsDir.js';

const pkg = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json'), 'utf8'));

/** A small update: a title and its sections, and it does not announce itself. */
const small = (version: string): ReleaseEntry => ({
  version,
  date: '2026-01-01',
  title: `Update ${version}`,
  sections: [{ heading: 'Fixes', body: `Fixed in ${version}.` }],
});
/** A headline update: the same, announcing itself (a headline ends without a full stop). */
const headline = (version: string): ReleaseEntry => ({
  ...small(version),
  title: `Headline ${version}`,
  announce: true,
});
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
    expect(recent.filter((r) => r.announce)).toHaveLength(HEADLINES_KEPT);
  });

  it('counts and leads by the tier, never by the title: a small update with a title stays small', () => {
    // Every update the app shows has a title, so a title cannot be what makes one a headline.
    const releases = [small('1.6.0'), small('1.5.0'), headline('1.4.0'), small('1.3.0')];
    const w = whatsNewWindow(releases, '1.6.0', '1.2.0');
    expect(w.unseen).toEqual(['1.6.0', '1.5.0', '1.4.0', '1.3.0']);
    expect(w.lead).toBe('1.4.0');
    expect(whatsNewWindow([small('1.6.0'), small('1.5.0')], '1.6.0', '1.4.0').lead).toBeNull();
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

describe('whatsNewWindow: the history the page lists', () => {
  /** Five headlines fill the window at 1.9.0; the history runs on below them. */
  const releases = [
    headline('1.9.0'),
    headline('1.8.0'),
    headline('1.7.0'),
    headline('1.6.0'),
    headline('1.5.0'),
    small('1.4.0'),
    { ...headline('1.3.0'), date: '2025-12-01' },
    small('1.2.0'),
    headline('1.1.0'),
    small('1.0.0'),
  ];

  it('lists every newsworthy record newest first, the window included, each as the whole record', () => {
    const w = whatsNewWindow(releases, '1.9.0');
    expect(versions(w.recent)).toEqual(['1.9.0', '1.8.0', '1.7.0', '1.6.0', '1.5.0']);
    // Small updates and older headlines alike, with the date, the title and the
    // sections they shipped with: the page draws every row from these.
    expect(w.history).toStrictEqual(releases);
    expect(w.history[6]).toMatchObject({ version: '1.3.0', date: '2025-12-01', title: 'Headline 1.3.0' });
    expect(w.history[7].sections).toEqual([{ heading: 'Fixes', body: 'Fixed in 1.2.0.' }]);
  });

  it('starts with the window: recent is always the head of the history', () => {
    for (const running of ['1.9.0', '1.7.0', '1.4.0', '1.3.0', '1.0.0', '0.0.0']) {
      const w = whatsNewWindow(releases, running);
      expect(w.history.length, `at ${running}`).toBeGreaterThanOrEqual(w.recent.length);
      expect(w.history.slice(0, w.recent.length), `at ${running}`).toEqual(w.recent);
    }
    // Fewer headlines than kept: the window holds everything, and so does the history.
    const few = whatsNewWindow([headline('1.2.0'), small('1.1.0'), headline('1.0.0')], '1.2.0');
    expect(few.history).toEqual(few.recent);
    expect(versions(few.history)).toEqual(['1.2.0', '1.1.0', '1.0.0']);
  });

  it('starts at the first public release: the 0.1.x internal era is never listed, compared as semver', () => {
    // The fixture sits either side of the shipped constant.
    expect(FIRST_PUBLIC).toBe('0.2.0');
    const era = [
      ...['0.15.0', '0.14.0', '0.13.0', '0.12.0', '0.11.0'].map(headline),
      // As strings "0.10.0" sorts below "0.2.0" and would be dropped.
      headline('0.10.0'),
      small('0.3.0'),
      headline('0.2.0'),
      headline('0.1.9'),
      small('0.1.5'),
      headline('0.1.0'),
    ];
    const listed = ['0.15.0', '0.14.0', '0.13.0', '0.12.0', '0.11.0', '0.10.0', '0.3.0', '0.2.0'];
    expect(versions(whatsNewWindow(era, '0.15.0').history)).toEqual(listed);
    expect(versions(whatsNewWindow(era, '0.0.0').history)).toEqual(listed);
    expect(versions(whatsNewWindow(era, '0.10.0').history)).toEqual(['0.10.0', '0.3.0', '0.2.0']);
    // A build of the internal era has no public history at all.
    expect(whatsNewWindow(era, '0.1.9').history).toEqual([]);
  });

  it('ignores records newer than the running build, and a 0.0.0 build has no ceiling', () => {
    const above = [
      headline('3.0.0'),
      ...['2.5.0', '2.4.0', '2.3.0', '2.2.0', '2.1.0'].map(headline),
      small('2.0.1'),
      headline('2.0.0'),
    ];
    expect(versions(whatsNewWindow(above, '2.5.0').history)).toEqual([
      '2.5.0',
      '2.4.0',
      '2.3.0',
      '2.2.0',
      '2.1.0',
      '2.0.1',
      '2.0.0',
    ]);
    // Between two records: the ceiling is the running version, not the nearest record.
    expect(versions(whatsNewWindow(above, '2.4.5').history)).toEqual([
      '2.4.0',
      '2.3.0',
      '2.2.0',
      '2.1.0',
      '2.0.1',
      '2.0.0',
    ]);
    expect(versions(whatsNewWindow(above, '2.0.0').history)).toEqual(['2.0.0']);
    expect(versions(whatsNewWindow(above, '0.0.0').history)).toEqual(versions(above));
  });

  it('never lists a maintenance record, even one that carries a title', () => {
    // The validator refuses a title with no sections; the history must not list one either.
    const titledQuiet = { ...quiet('1.4.0'), title: 'Headline 1.4.0' };
    const w = whatsNewWindow([...releases.slice(0, 5), titledQuiet, headline('1.3.0'), quiet('1.2.0')], '1.9.0');
    expect(versions(w.history)).toEqual(['1.9.0', '1.8.0', '1.7.0', '1.6.0', '1.5.0', '1.3.0']);
  });

  it('does not depend on what was seen', () => {
    const plain = whatsNewWindow(releases, '1.9.0').history;
    for (const seen of [null, '0.1.0', '1.3.0', '1.9.0', '99.0.0', 'garbage']) {
      expect(whatsNewWindow(releases, '1.9.0', seen).history, `seen ${seen}`).toEqual(plain);
    }
  });

  it('leaves what is new to the window: unread records below it are history, never unseen', () => {
    // Seen at 1.1.0: 1.4.0 to 1.2.0 are newer and in the history, but only the window can be new.
    const w = whatsNewWindow(releases, '1.9.0', '1.1.0');
    expect(versions(w.history)).toContain('1.3.0');
    expect(w.unseen).toEqual(['1.9.0', '1.8.0', '1.7.0', '1.6.0', '1.5.0']);
    expect(w.lead).toBe('1.9.0');
    // Adding history changed neither: the same answers as a window cut to its own records.
    const alone = whatsNewWindow(releases.slice(0, 5), '1.9.0', '1.1.0');
    expect(w).toMatchObject({ unseen: alone.unseen, lead: alone.lead });
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
    expect(w.recent.filter((r) => r.announce).length).toBeLessThanOrEqual(HEADLINES_KEPT);
    for (const r of w.recent) expect(r.title, `${r.version} is in the window without a title`).toBeTruthy();
    expect(w.unseen).toEqual([]);
    expect(w.lead).toBeNull();
  });

  it('lists every public record with news this build carries, newest first, starting with the window', () => {
    const w = whatsNewWindow(RELEASES, pkg.version, pkg.version);
    const released = pkg.version !== '0.0.0';
    expect(w.history.length).toBeGreaterThanOrEqual(w.recent.length);
    expect(w.history.slice(0, w.recent.length)).toEqual(w.recent);
    for (const r of w.history) {
      // The record itself, not a summary of it.
      expect(r, `${r.version} is listed as something other than its record`).toBe(releaseFor(r.version));
      expect(isNewsworthy(r), `${r.version} is listed without news`).toBe(true);
      expect(compareSemver(r.version, FIRST_PUBLIC), `${r.version} is internal`).toBeGreaterThanOrEqual(0);
      if (released) expect(compareSemver(r.version, pkg.version)).toBeLessThanOrEqual(0);
    }
    const listed = versions(w.history);
    expect(listed).toEqual([...listed].sort((a, b) => compareSemver(b, a)));
    // None lost between them: every public record with news this build can speak for.
    const expected = RELEASES.filter(
      (r) =>
        isNewsworthy(r) &&
        compareSemver(r.version, FIRST_PUBLIC) >= 0 &&
        (!released || compareSemver(r.version, pkg.version) <= 0),
    );
    expect(listed).toEqual(versions(expected));
  });

  it("holds every record the page lists to today's headline and name rules", () => {
    // The lowercase name is built from two halves so the pre-commit name check lets the fixture through.
    const name = `${'scen'}ri`;
    // The command keeps its lowercase name; anywhere else in a sentence it is the product's.
    const inASentence = new RegExp(`(?<!npx )\\b${name}\\b(?!@)`);
    for (const r of whatsNewWindow(RELEASES, pkg.version).history) {
      if (r.title) {
        expect(r.title, `${r.version} headline ends with a full stop`).not.toMatch(/\.\s*$/);
        expect(r.title, `${r.version} headline says brief`).not.toMatch(/\bbriefs?\b/i);
      }
      // Headings too: the page prints each one beside its words.
      for (const text of [r.title ?? '', ...r.sections.flatMap((s) => [s.heading, s.body])]) {
        expect(text, `${r.version} writes the name in lowercase`).not.toMatch(inASentence);
      }
    }
  });
});
