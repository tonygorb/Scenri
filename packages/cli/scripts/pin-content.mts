/**
 * Pin a published library archive file by file; a content release is this one command:
 *   pnpm exec tsx packages/cli/scripts/pin-content.mts <scenri-content.zip>
 * or a fork's own archive, for SCENRI_CONTENT_PIN:
 *   pnpm exec tsx packages/cli/scripts/pin-content.mts <their.zip> --out <pin.json>
 *
 * Writes packages/cli/src/content/pin.json: the archive's version (read from
 * its own meta.json), size and sha256, and for every file its name, where its
 * bytes start, how many there are, how they are packed, how big the file is,
 * and the sha256 it must have once unpacked. The build takes CONTENT_VERSION,
 * CONTENT_TAG (content-v<version>) and CONTENT_SHA256 from it, reads the
 * library by byte range from these offsets, and keeps a file only when its own
 * hash matches, so the archive's integrity is kept file by file without ever
 * parsing a zip it downloaded. Then move the tag in the CI and publish
 * workflows (contentVersion.test.ts names each place).
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';
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
const unpacked = new Map<string, Buffer>();
const files = zipEntries(bytes)
  .sort((a, b) => a.dataOffset - b.dataOffset)
  .map((e) => {
    const packed = bytes.subarray(e.dataOffset, e.dataOffset + e.compressedSize);
    const data = e.method === 8 ? inflateRawSync(packed) : packed;
    if (data.length !== e.size) throw new Error(`${e.name}: unpacked ${data.length} bytes, expected ${e.size}`);
    unpacked.set(e.name, data);
    return [e.name, e.dataOffset, e.compressedSize, e.method, e.size, createHash('sha256').update(data).digest('hex')];
  });
const meta = unpacked.get('meta.json');
const version = meta ? Number((JSON.parse(meta.toString('utf8')) as { version?: unknown }).version) : Number.NaN;
if (!Number.isInteger(version) || version < 1) {
  console.error(
    'the archive carries no meta.json with a whole-number version; it is the completeness marker, and the version',
  );
  process.exit(1);
}
const out = custom ?? join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'content', 'pin.json');
// One file per line: a diff of a content bump reads as the files that changed.
const body = [
  '{',
  `  "version": ${version},`,
  `  "sha256": "${sha}",`,
  `  "size": ${bytes.length},`,
  '  "files": [',
  files.map((f) => `    ${JSON.stringify(f)}`).join(',\n'),
  '  ]',
  '}',
  '',
].join('\n');
writeFileSync(out, body);
console.log(`pinned version ${version}, ${files.length} files of ${bytes.length} bytes -> ${out}`);
