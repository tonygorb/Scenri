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
/** Every picture is the capture's one window size, 16:9 (apps/studio/capture/shoot.ts). */
const SIZE = { width: 1920, height: 1080 };
/**
 * The ceilings, KiB, the capture writes under (MAX_KIB in apps/studio/capture/shoot.ts), measured on
 * the pictures shipped: the heaviest window, a wall of photographs, is 289; the heaviest isolated
 * picture, a row of scene cards, is 149, and the rest of them are 17 to 64. Nine together are 689,
 * so one more picture of either kind still fits the whole in 1 MiB.
 */
const MAX_KIB = { window: 320, isolated: 160 } as const;
const TOTAL_KIB = 1024;

type Kind = keyof typeof MAX_KIB;

/**
 * What a picture is, read from its alpha: a **window** is opaque to its edges but for its four
 * rounded corners, which are see-through; an **isolated** picture is a component set on a clear
 * canvas, so every pixel of its border is see-through. Anything else is a rectangle cut out of the
 * interface, or a component cut by the edge of its canvas.
 */
async function kindOf(path: string): Promise<Kind | string> {
  const { data, info } = await sharp(path).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = info.width;
  const H = info.height;
  const alphaAt = (x: number, y: number) => data[(y * W + x) * info.channels + 3];
  let border = 0;
  for (let x = 0; x < W; x++) border += Number(alphaAt(x, 0) > 0) + Number(alphaAt(x, H - 1) > 0);
  for (let y = 1; y < H - 1; y++) border += Number(alphaAt(0, y) > 0) + Number(alphaAt(W - 1, y) > 0);
  if (border === 0) return 'isolated';
  const corners = [alphaAt(0, 0), alphaAt(W - 1, 0), alphaAt(0, H - 1), alphaAt(W - 1, H - 1)];
  const middles = [alphaAt(W >> 1, 0), alphaAt(W >> 1, H - 1), alphaAt(0, H >> 1), alphaAt(W - 1, H >> 1)];
  if (corners.every((a) => a <= 8) && middles.every((a) => a === 255)) return 'window';
  if (corners.some((a) => a > 8)) return 'a corner is opaque: the capture cut a rectangle out of the interface';
  return `${border} px of its border are painted but it is not a whole window: a component is cut by the canvas edge`;
}

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

  it('belong only to records the app still shows, one picture to an update', () => {
    const inApp = new Set(whatsNewWindow(RELEASES, pkg.version).recent.map((r) => r.version));
    const stale = referenced
      .filter(({ version }) => !inApp.has(version))
      .map(({ file, version }) => `picture ${file}: release ${version} is outside What's New; delete the picture`);
    expect(stale).toEqual([]);
    const twice = [...new Set(referenced.map((p) => p.version))].filter(
      (v) => referenced.filter((p) => p.version === v).length > 1,
    );
    expect(twice, 'updates with more than one picture').toEqual([]);
  });

  it(`are 1920x1080 WebP stills with alpha and no metadata, each a whole window or an isolated component`, async () => {
    const problems: string[] = [];
    for (const f of files) {
      const path = join(dir, f);
      const m = await sharp(path).metadata();
      if (m.format !== 'webp') problems.push(`${f}: ${m.format}, not webp`);
      if (m.width !== SIZE.width || m.height !== SIZE.height)
        problems.push(`${f}: ${m.width}x${m.height}; every picture is ${SIZE.width}x${SIZE.height}`);
      if ((m.pages ?? 1) !== 1) problems.push(`${f}: ${m.pages} frames; one still`);
      for (const key of ['exif', 'xmp', 'iptc', 'icc'] as const) {
        if (m[key] !== undefined) problems.push(`${f}: carries ${key} metadata; strip it`);
      }
      if (!m.hasAlpha) {
        problems.push(`${f}: no alpha; a window's corners and an isolated picture's canvas are see-through`);
        continue;
      }
      const kind = await kindOf(path);
      if (kind !== 'window' && kind !== 'isolated') problems.push(`${f}: ${kind}`);
    }
    expect(problems).toEqual([]);
  });

  it(`stay small: ${MAX_KIB.window} KiB a window, ${MAX_KIB.isolated} KiB an isolated picture, ${TOTAL_KIB / KIB} MiB together`, async () => {
    const heavy: string[] = [];
    let total = 0;
    for (const f of files) {
      const bytes = statSync(join(dir, f)).size;
      total += bytes;
      const kind = await kindOf(join(dir, f));
      if (kind !== 'window' && kind !== 'isolated') continue; // the shape test says why
      if (bytes > MAX_KIB[kind] * KIB)
        heavy.push(
          `${f} is ${Math.ceil(bytes / KIB)} KiB; ${MAX_KIB[kind]} is the ceiling for ${kind === 'window' ? 'a window' : 'an isolated picture'}`,
        );
    }
    expect(heavy).toEqual([]);
    expect(total, 'every picture together, bytes').toBeLessThanOrEqual(TOTAL_KIB * KIB);
  });
});
