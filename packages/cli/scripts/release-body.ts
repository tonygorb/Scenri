/**
 * The authored release record, rendered as markdown for a GitHub release.
 *
 * One record, two audiences: What's New reads it in the app, this prints it
 * for the release page. Nobody writes the same sentence twice.
 *
 * It prints nothing and exits 0 when there is no record for the version. That
 * is deliberate — the release workflow only edits the release body when this
 * produced something, so a missing record leaves release-please's own
 * commit-derived notes exactly as they are today. A release-note problem must
 * never be able to fail a release that has already published.
 *
 *   pnpm exec tsx packages/cli/scripts/release-body.ts 0.2.0
 */
import { releaseFor } from '../src/release/notes.data.js';

const version = process.argv[2]?.replace(/^v/, '');
if (!version) process.exit(0);

const entry = releaseFor(version);
if (!entry) process.exit(0);

const lines: string[] = [];
if (entry.title) lines.push(entry.title, '');
if (entry.sections.length === 0) {
  lines.push('Maintenance release. Nothing here changes how Scenri works for you.', '');
}
for (const s of entry.sections) {
  lines.push(`### ${s.heading}`, '', s.body, '');
}
process.stdout.write(lines.join('\n').trimEnd());
