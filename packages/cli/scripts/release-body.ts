/**
 * The authored release record, rendered as markdown for a GitHub release.
 * The rendering is `releaseBody` (src/release/body.ts); this only finds the
 * record, the repository and the pictures.
 *
 * It prints nothing and exits 0 when there is no record for the version. That
 * is deliberate: the release workflow only edits the release body when this
 * produced something, so a missing record leaves release-please's own
 * commit-derived notes exactly as they are today. A release-note problem must
 * never be able to fail a release that has already published.
 *
 *   pnpm exec tsx packages/cli/scripts/release-body.ts 0.2.0
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { releaseBody } from '../src/release/body.js';
import { PICTURE_DIR, releaseFor } from '../src/release/notes.data.js';
import { readMeta, repoSlug } from '../src/meta.js';

const version = process.argv[2]?.replace(/^v/, '');
if (!version) process.exit(0);

const entry = releaseFor(version);
if (!entry) process.exit(0);

/** The repository root: this file sits in packages/cli/scripts. */
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/**
 * Whether the tag itself holds a file: the picture link points into the tag,
 * so a picture only in the working tree would be a broken image on the page.
 * Null when git cannot say (no repo, no such tag), and then the checkout is
 * asked instead, which is what publish.yml has anyway: it checks out the tag.
 */
function atTag(tag: string, path: string): boolean | null {
  try {
    execFileSync('git', ['rev-parse', '--verify', '--quiet', `${tag}^{commit}`], { cwd: root, stdio: 'ignore' });
  } catch {
    return null;
  }
  try {
    execFileSync('git', ['cat-file', '-e', `${tag}:${path}`], { cwd: root, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/** Actions names the repository it runs in; elsewhere package.json does. Neither is worth failing a release over. */
const slug = (() => {
  try {
    return process.env.GITHUB_REPOSITORY || repoSlug(readMeta().repository);
  } catch {
    return null;
  }
})();

process.stdout.write(
  releaseBody(entry, {
    slug,
    tag: `v${version}`,
    has: (file) => atTag(`v${version}`, `${PICTURE_DIR}/${file}`) ?? existsSync(join(root, PICTURE_DIR, file)),
  }),
);
