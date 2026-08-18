/**
 * Hydrate the local content cache (~/.scenri/content) from the content
 * archive, without booting the app. Two uses:
 *
 *   pnpm exec tsx packages/cli/scripts/pull-content.mts
 *     downloads the archive from the repo's content-latest release (or
 *     SCENRI_CONTENT_URL) — what a contributor runs once so the full test
 *     suite has the imagery the repo deliberately does not carry.
 *
 *   pnpm exec tsx packages/cli/scripts/pull-content.mts <archive.zip>
 *     unpacks an already-downloaded archive — what CI does, because a private
 *     repo's release assets need an authenticated download (gh release
 *     download) first.
 *
 * The unpack mirrors src/content/fetch.ts: staging dir, zip-slip guard,
 * atomic rename, meta.json as the completeness marker.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { dirname, join, normalize } from 'node:path';
import JSZip from 'jszip';
import { contentCacheReady, contentCacheRoot } from '../src/content/overlay.js';
import { resolveContentUrl } from '../src/content/fetch.js';

const arg = process.argv[2];
const root = contentCacheRoot();

if (contentCacheReady()) {
  console.log(`content cache already present at ${root}`);
  process.exit(0);
}

let zipBytes: Buffer;
if (arg) {
  zipBytes = readFileSync(arg);
  console.log(`unpacking ${arg}`);
} else {
  const url = resolveContentUrl();
  console.log(`downloading ${url}`);
  const res = await fetch(url);
  if (!res.ok) {
    console.error(
      `archive answered ${res.status}. On a private repo, download first: gh release download content-latest -p scenri-content.zip, then pass the file.`,
    );
    process.exit(1);
  }
  zipBytes = Buffer.from(await res.arrayBuffer());
}

const staging = `${root}.staging`;
rmSync(staging, { recursive: true, force: true });
mkdirSync(staging, { recursive: true });
const zip = await JSZip.loadAsync(zipBytes);
for (const [name, entry] of Object.entries(zip.files)) {
  if (entry.dir) continue;
  const rel = normalize(name);
  if (rel.startsWith('..') || rel.startsWith('/') || /^[a-zA-Z]:/.test(rel)) continue;
  const dest = join(staging, rel);
  mkdirSync(dirname(dest), { recursive: true });
  await writeFile(dest, await entry.async('nodebuffer'));
}
if (!existsSync(join(staging, 'meta.json'))) {
  rmSync(staging, { recursive: true, force: true });
  console.error('archive carries no meta.json');
  process.exit(1);
}
rmSync(root, { recursive: true, force: true });
renameSync(staging, root);
console.log(`content cache ready at ${root}`);
