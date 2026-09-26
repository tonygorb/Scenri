import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { PICTURE_DIR, RELEASES, whatsNewWindow } from '../src/release/notes.data.js';

/**
 * The pictures What's New shows, held to the records that name them.
 *
 * The folder ships inside the studio bundle, so every byte in it is a byte
 * every install downloads. A picture no record names is dead weight, a record
 * naming a missing picture is a broken dialog, and a picture that carries
 * camera or profile metadata carries whatever was on the machine that shot it.
 */

const cli = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(cli, 'package.json'), 'utf8'));
const dir = join(cli, '..', '..', PICTURE_DIR);

/** What is in the folder, dotfiles aside. A folder that does not exist yet holds nothing. */
const onDisk: string[] = existsSync(dir) ? readdirSync(dir).filter((f) => !f.startsWith('.')) : [];
const files = onDisk.filter((f) => statSync(join(dir, f)).isFile());

/** Every picture a record names, with the release that names it. */
const referenced = RELEASES.flatMap((r) =>
  r.sections.flatMap((s) => (s.image ? [{ version: r.version, file: s.image.file }] : [])),
);

const KIB = 1024;

describe(`the pictures in ${PICTURE_DIR}`, () => {
  it('are named as file names, never as paths', () => {
    const bad = referenced
      .filter(({ file }) => file.includes('/') || file.includes('\\') || file === '.' || file === '..' || file === '')
      .map(({ file, version }) => `picture ${file} (release ${version}) is a path; name the file alone`);
    expect(bad).toEqual([]);
  });

  it('are all there', () => {
    const missing = referenced
      .filter(({ file }) => !files.includes(file))
      .map(
        ({ file, version }) =>
          `picture ${file} (release ${version}) is not in ${PICTURE_DIR}; shoot it or remove the image field`,
      );
    expect(missing).toEqual([]);
  });

  it('are each named by a release', () => {
    const names = new Set(referenced.map((p) => p.file));
    const orphans = onDisk
      .filter((f) => !names.has(f))
      .map((f) => `${PICTURE_DIR}/${f} is named by no release; delete it`);
    expect(orphans).toEqual([]);
  });

  it('belong only to records the app still shows', () => {
    const inApp = new Set(whatsNewWindow(RELEASES, pkg.version).recent.map((r) => r.version));
    const stale = referenced
      .filter(({ version }) => !inApp.has(version))
      .map(({ file, version }) => `picture ${file}: release ${version} is outside What's New; delete the picture`);
    expect(stale).toEqual([]);
  });

  it('stay small: 150 KiB each, 1 MiB together', () => {
    const sizes = files.map((f) => ({ f, bytes: statSync(join(dir, f)).size }));
    const heavy = sizes
      .filter(({ bytes }) => bytes > 150 * KIB)
      .map(({ f, bytes }) => `${f} is ${Math.ceil(bytes / KIB)} KiB; 150 is the ceiling`);
    expect(heavy).toEqual([]);
    expect(sizes.reduce((sum, { bytes }) => sum + bytes, 0)).toBeLessThanOrEqual(1024 * KIB);
  });

  it('are still 16:10 WebP frames, 1024 to 1600 wide, with no metadata', async () => {
    const problems: string[] = [];
    for (const f of files) {
      const m = await sharp(join(dir, f)).metadata();
      if (m.format !== 'webp') problems.push(`${f}: ${m.format}, not webp`);
      const { width = 0, height = 0 } = m;
      if (width * 10 !== height * 16) problems.push(`${f}: ${width}x${height} is not exactly 16:10`);
      if (width < 1024 || width > 1600) problems.push(`${f}: ${width} wide; 1024 to 1600`);
      if ((m.pages ?? 1) !== 1) problems.push(`${f}: ${m.pages} frames; one still`);
      for (const key of ['exif', 'xmp', 'iptc', 'icc'] as const) {
        if (m[key] !== undefined) problems.push(`${f}: carries ${key} metadata; strip it`);
      }
    }
    expect(problems).toEqual([]);
  });
});
