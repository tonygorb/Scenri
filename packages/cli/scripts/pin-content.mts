/**
 * Pin a published library archive file by file:
 *   pnpm exec tsx packages/cli/scripts/pin-content.mts <scenri-content.zip>
 * or a fork's own archive, for SCENRI_CONTENT_PIN:
 *   pnpm exec tsx packages/cli/scripts/pin-content.mts <their.zip> --out <pin.json>
 *
 * Writes packages/cli/src/content/archive-v<version>.json: the archive's
 * size and sha256 (which must equal CONTENT_SHA256), and for every file its
 * name, where its bytes start, how many there are, how they are packed, how
 * big the file is, and the sha256 it must have once unpacked. The app reads
 * the library by byte range from these offsets and installs a file only when
 * its own hash matches, so the archive's integrity is kept file by file
 * without ever parsing a zip it downloaded.
 *
 * Run it whenever CONTENT_TAG and CONTENT_SHA256 change, on the same zip.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';
import { CONTENT_SHA256, CONTENT_VERSION } from '../src/content/fetch.js';
import { zipEntries } from './zip-entries.mjs';

const zip = process.argv[2];
const outAt = process.argv.indexOf('--out');
const custom = outAt > 0 ? process.argv[outAt + 1] : undefined;
if (!zip || (outAt > 0 && !custom)) {
  console.error('usage: pin-content.mts <scenri-content.zip> [--out <pin.json>]');
  process.exit(1);
}
const bytes = readFileSync(zip);
const sha = createHash('sha256').update(bytes).digest('hex');
if (!custom && sha !== CONTENT_SHA256) {
  console.error(
    `this archive's sha256 is ${sha}; CONTENT_SHA256 is ${CONTENT_SHA256}. Pin the archive the build expects.`,
  );
  process.exit(1);
}
const files = zipEntries(bytes)
  .sort((a, b) => a.dataOffset - b.dataOffset)
  .map((e) => {
    const packed = bytes.subarray(e.dataOffset, e.dataOffset + e.compressedSize);
    const data = e.method === 8 ? inflateRawSync(packed) : packed;
    if (data.length !== e.size) throw new Error(`${e.name}: unpacked ${data.length} bytes, expected ${e.size}`);
    return [e.name, e.dataOffset, e.compressedSize, e.method, e.size, createHash('sha256').update(data).digest('hex')];
  });
const out =
  custom ?? join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'content', `archive-v${CONTENT_VERSION}.json`);
// One file per line: a diff of a content bump reads as the files that changed.
const body = [
  '{',
  `  "version": ${CONTENT_VERSION},`,
  `  "sha256": "${sha}",`,
  `  "size": ${bytes.length},`,
  '  "files": [',
  files.map((f) => `    ${JSON.stringify(f)}`).join(',\n'),
  '  ]',
  '}',
  '',
].join('\n');
writeFileSync(out, body);
console.log(`pinned ${files.length} files of ${bytes.length} bytes -> ${out}`);
