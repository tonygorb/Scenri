/**
 * Hydrate the local content cache (~/.scenri/content) from the content
 * archive, without booting the app. Two uses:
 *
 *   pnpm exec tsx packages/cli/scripts/pull-content.mts
 *     downloads the archive from the repo's CONTENT_TAG release (or
 *     SCENRI_CONTENT_URL), what a contributor runs once so the full test
 *     suite has the imagery the repo deliberately does not carry.
 *
 *   pnpm exec tsx packages/cli/scripts/pull-content.mts <archive.zip>
 *     installs an already-downloaded archive, what CI does, because a private
 *     repo's release assets need an authenticated download (gh release
 *     download) first.
 *
 * Same rule and same install as src/content/fetch.ts: a cache older than
 * CONTENT_VERSION is replaced, and the archive is installed file by file
 * against the pin (installArchive), then moved into place.
 */
import { readFileSync } from 'node:fs';
import { contentCacheRoot } from '../src/content/overlay.js';
import type { ArchivePin } from '../src/content/ranged.js';
import {
  CONTENT_PIN,
  CONTENT_TAG,
  contentCacheStale,
  installArchive,
  resolveContentUrl,
} from '../src/content/fetch.js';

const arg = process.argv[2];
const root = contentCacheRoot();

if (!contentCacheStale()) {
  console.log(`content cache already present at ${root}`);
  process.exit(0);
}

let zipBytes: Buffer;
if (arg) {
  zipBytes = readFileSync(arg);
  console.log(`installing ${arg}`);
} else {
  const url = resolveContentUrl();
  console.log(`downloading ${url}`);
  const res = await fetch(url);
  if (!res.ok) {
    console.error(
      `archive answered ${res.status}. On a private repo, download first: gh release download ${CONTENT_TAG} -p scenri-content.zip, then pass the file.`,
    );
    process.exit(1);
  }
  zipBytes = Buffer.from(await res.arrayBuffer());
}

// The same pin the app checks, file by file: CI and the publish job hydrate
// exactly the archive this build was released against. An archive of one's own
// at SCENRI_CONTENT_URL brings its own pin (SCENRI_CONTENT_PIN).
const own = process.env.SCENRI_CONTENT_PIN;
const pin = own ? (JSON.parse(readFileSync(own, 'utf8')) as ArchivePin) : CONTENT_PIN;
const refused = await installArchive(zipBytes, process.env, pin);
if (refused) {
  console.error(`${refused} (${CONTENT_TAG} expected)`);
  process.exit(1);
}
console.log(`content cache ready at ${root}`);
