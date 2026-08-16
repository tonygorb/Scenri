/**
 * What changed, in product language, for the version this build *is*.
 *
 * Authored by hand and shipped inside the bundle, which is the whole point:
 * it answers offline, it always describes the version actually running, and it
 * never depends on GitHub being reachable. The generated CHANGELOG.md stays
 * where it belongs — the commit-level history a developer reads — and the
 * dialog links out to the release page for that full list.
 *
 * One entry per published version, newest first. `releaseNotes.test.ts` holds
 * the top entry to the version in package.json, so a release PR goes red until
 * a human has written this. That failure is the feature.
 */

export interface ReleaseSection {
  /** A product area, not a commit scope: "Create", "Scenes", "Fixes". */
  heading: string;
  /** One or two sentences. What it means for the work, not what the diff did. */
  body: string;
}

export interface ReleaseEntry {
  /** Exact semver, matching the published tag. */
  version: string;
  /** ISO yyyy-mm-dd. Rendered in the reader's locale. */
  date: string;
  /** Optional one-line headline above the sections. */
  title?: string;
  /**
   * Two to four. More than that is a changelog, and there is one of those
   * already.
   *
   * **Empty is legal and meaningful**: it says "this version changed nothing a
   * user would notice" — a maintenance release, a build fix, a dependency
   * bump. Every published version still gets a record, so a missing entry
   * always means someone forgot; an empty one always means there was nothing
   * to say. What's New stays shut for these: no dialog, no unread dot, and
   * opening it by hand names the version and links to the full changelog.
   */
  sections: ReleaseSection[];
  /**
   * Reserved. A release with a genuinely visual change may carry one supporting
   * image; nothing renders it yet, and it is never a carousel.
   */
  image?: string;
}

export const RELEASES: ReleaseEntry[] = [
  {
    version: '0.1.1',
    date: '2026-08-16',
    sections: [
      {
        heading: 'Fixes',
        body: 'Opening a shot from a notification could say it was no longer available, and renaming a set could drop you back to the feed. Both now check with the server before deciding something has gone.',
      },
    ],
  },
  {
    version: '0.1.0',
    date: '2026-08-16',
    title: 'The first public release of scenri.',
    sections: [
      {
        heading: 'Create',
        body: 'Compose a shot from your products, presenters and scenes, then branch any result to art-direct it further. Every shot keeps the recipe that made it.',
      },
      {
        heading: 'Library',
        body: 'Products, Presenters and Scenes share one tool: the same filtering, the same grid, the same keyboard.',
      },
      {
        heading: 'Brand',
        body: 'Define a client once in Settings, then apply it to any shot with a chip. Nothing about a brand is ever applied behind your back.',
      },
      {
        heading: 'Updates',
        body: 'scenri updates itself in place. It downloads the new version beside the running one, proves it loads, then restarts into it. Your library is never part of that.',
      },
    ],
  },
];

/** The entry describing an exact version, or null when none was authored. */
export function releaseFor(version: string): ReleaseEntry | null {
  return RELEASES.find((r) => r.version === version) ?? null;
}

/**
 * Whether a release has anything to tell a user about. The one question that
 * decides if What's New may interrupt: a record with no sections is a release
 * that happened, not news.
 */
export function isNewsworthy(entry: ReleaseEntry | null): boolean {
  return (entry?.sections.length ?? 0) > 0;
}

/** Words that mean someone started selling rather than telling. */
const HYPE = /\b(revolutionary|game.?chang|supercharg|unlock the power|thrilled|seamlessly|effortlessly|delight)/i;
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;

/**
 * Everything obviously broken about a set of release records, as plain
 * sentences. Empty means publishable.
 *
 * Deliberately not a validation framework: it exists to stop a version
 * shipping with no record, with someone else's record, or with copy that
 * breaks the house style. `releaseNotes.test.ts` runs it against the real
 * data, which is what makes the release PR go red until the notes are written.
 */
export function validateReleases(releases: ReleaseEntry[], currentVersion: string): string[] {
  const problems: string[] = [];
  const semver = /^\d+\.\d+\.\d+$/;

  if (releases.length === 0) return ['there are no release records at all'];

  // 0.0.0 is the pre-release placeholder release-please has not touched yet.
  if (currentVersion !== '0.0.0' && releases[0].version !== currentVersion) {
    problems.push(
      `the newest record is ${releases[0].version} but this build is ${currentVersion} — write the record for ${currentVersion}`,
    );
  }

  const seen = new Set<string>();
  let previous: number[] | null = null;
  for (const r of releases) {
    const where = `release ${r.version}`;
    if (!semver.test(r.version)) problems.push(`${where}: not a plain semver version`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(r.date)) problems.push(`${where}: date is not yyyy-mm-dd`);
    if (seen.has(r.version)) problems.push(`${where}: described twice`);
    seen.add(r.version);

    const triplet = r.version.split('.').map(Number);
    if (previous && semver.test(r.version)) {
      const descending =
        previous[0] > triplet[0] ||
        (previous[0] === triplet[0] && previous[1] > triplet[1]) ||
        (previous[0] === triplet[0] && previous[1] === triplet[1] && previous[2] > triplet[2]);
      if (!descending) problems.push(`${where}: out of order — records run newest first`);
    }
    previous = triplet;

    if (r.title !== undefined && r.title.trim() === '') problems.push(`${where}: empty title`);
    // An empty sections array is legal: it is how a maintenance release says
    // "no news". A section that exists and says nothing is not.
    if (r.sections.length > 4) problems.push(`${where}: ${r.sections.length} sections — four is the ceiling`);
    for (const s of r.sections) {
      if (s.heading.trim() === '') problems.push(`${where}: a section with no heading`);
      if (s.body.trim() === '') problems.push(`${where}: section "${s.heading}" says nothing`);
    }

    const prose = [r.title ?? '', ...r.sections.flatMap((s) => [s.heading, s.body])].join(' ');
    if (HYPE.test(prose)) problems.push(`${where}: hype copy — say what changed, not how amazing it is`);
    if (EMOJI.test(prose)) problems.push(`${where}: emoji`);
    if (prose.includes('\u2014') || prose.includes('\u2013')) problems.push(`${where}: long dash`);
  }

  return problems;
}
