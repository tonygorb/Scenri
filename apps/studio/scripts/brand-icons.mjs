/**
 * Every icon Scenri ships, rendered from the two files in brand/.
 *
 * Run with `pnpm --filter @scenri/studio brand:icons`. The outputs are checked
 * in, because a favicon that only exists after someone remembers to run a
 * script is a favicon that goes missing. Rerun this when the artwork changes,
 * and commit what it writes.
 *
 * The tile is the app's own dark background with the mark in white. That reads
 * on a light browser chrome and a dark one, and iOS composites black under any
 * transparency it is handed, so the home screen clip has to be opaque anyway.
 * Only favicon.svg escapes the tile: it carries both inks and lets the browser
 * choose, which is the one place a pair is cheaper than a compromise.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const here = dirname(fileURLToPath(import.meta.url));
const studio = join(here, '..');
const repo = join(studio, '..', '..');
const brand = join(studio, 'brand');
const out = join(studio, 'public');

const INK = '#ffffff';
const TILE = '#0d0d0d';
const LIGHT_INK = '#0a0a0a'; // --sc-fg, light theme
const DARK_INK = '#f5f5f5'; // --sc-fg, dark theme

const art = (name, ink) => readFileSync(join(brand, name), 'utf8').replaceAll('currentColor', ink);
const symbol = (ink = INK) => art('scenri-symbol.svg', ink);
const lockup = (ink = INK) => art('scenri-lockup.svg', ink);

/** Render an SVG at a fixed box, then sit it on a tile with room around it. */
async function tile({ svg, size, inset = 0, background = TILE, width = size }) {
  const boxH = Math.round(size * (1 - inset * 2));
  const mark = await sharp(Buffer.from(svg), { density: 600 }).resize({ height: boxH, fit: 'inside' }).png().toBuffer();
  const { width: mw, height: mh } = await sharp(mark).metadata();
  return sharp({
    create: { width, height: size, channels: 4, background },
  })
    .composite([{ input: mark, left: Math.round((width - mw) / 2), top: Math.round((size - mh) / 2) }])
    .png()
    .toBuffer();
}

/**
 * An .ico is a six byte directory, a sixteen byte entry per size, then the
 * payloads. PNG payloads have been legal since Vista and are what every
 * browser in support reads, so there is no bitmap encoder here.
 */
function ico(pngs) {
  const dir = Buffer.alloc(6);
  dir.writeUInt16LE(0, 0);
  dir.writeUInt16LE(1, 2);
  dir.writeUInt16LE(pngs.length, 4);
  let offset = 6 + pngs.length * 16;
  const entries = pngs.map(({ size, data }) => {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0);
    e.writeUInt8(size >= 256 ? 0 : size, 1);
    e.writeUInt8(0, 2);
    e.writeUInt8(0, 3);
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(data.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += data.length;
    return e;
  });
  return Buffer.concat([dir, ...entries, ...pngs.map((p) => p.data)]);
}

const write = (path, data) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, data);
  console.log(`  ${path.replace(`${repo}/`, '')}  ${(data.length / 1024).toFixed(1)}kB`);
};

console.log('\n  Scenri brand icons\n');

// The one asset that keeps both inks. A tab strip is chrome, not page, so it
// follows the OS rather than the theme the app is set to. The <title> stays the
// first child of the <svg>, which is both the a11y convention and what biome's
// noSvgWithoutTitle checks for.
const css = `path{fill:${LIGHT_INK}}@media(prefers-color-scheme:dark){path{fill:${DARK_INK}}}`;
write(
  join(out, 'favicon.svg'),
  readFileSync(join(brand, 'scenri-symbol.svg'), 'utf8')
    .replace(' fill="currentColor"', '')
    .replace(/(<\/title>)/, `$1\n  <style>${css}</style>`),
);

// 16px is where a frame mark goes to die: the notches close up and the ring
// blurs. It takes the tightest inset the tile can carry, checked by eye at 12x.
const icoSizes = [16, 32, 48];
const icoPngs = await Promise.all(
  icoSizes.map(async (size) => ({ size, data: await tile({ svg: symbol(), size, inset: 0.08 }) })),
);
write(join(out, 'favicon.ico'), ico(icoPngs));

// iOS rounds the corners itself and refuses transparency, so this is a plain
// opaque square with the mark held off the edge.
write(join(out, 'apple-touch-icon.png'), await tile({ svg: symbol(), size: 180, inset: 0.18 }));

write(join(out, 'icon-192.png'), await tile({ svg: symbol(), size: 192, inset: 0.12 }));
write(join(out, 'icon-512.png'), await tile({ svg: symbol(), size: 512, inset: 0.12 }));
// Android crops a maskable icon to whatever shape the launcher likes. Anything
// outside the middle 60% is not guaranteed to survive.
write(join(out, 'icon-maskable-512.png'), await tile({ svg: symbol(), size: 512, inset: 0.28 }));

// Two baked cuts for markdown. An <img> does not inherit page colour, so
// currentColor would resolve to black and the mark would vanish on GitHub's
// dark theme; a <picture> with prefers-color-scheme picks between these.
// Named for the background they sit on, never for their ink. That is the one
// naming mistake the Figma file makes, and it is not worth repeating here.
write(join(repo, 'docs/media/logo-on-light.svg'), lockup(LIGHT_INK));
write(join(repo, 'docs/media/logo-on-dark.svg'), lockup(DARK_INK));

// docs/media/og.png is deliberately NOT written here any more: it is designed
// by hand in the Figma brand file (node 5211:969) and exported at 1200x630.
// GitHub's social preview is a repository setting, uploaded by hand, and that
// hand-made file is the one to upload.

// ---- the desktop launcher's icons, shipped inside the npm package ----------
// Both land in packages/cli/launcher/ and are committed like everything above.
// The launcher is the .app on a Mac Desktop and the .lnk on a Windows one, so
// these are the first Scenri icons an OS draws rather than a browser.

const cliLauncher = join(repo, 'packages', 'cli', 'launcher');

/**
 * The inner artwork of the symbol, ready to nest inside another <svg>. The
 * <title> stays out: it belongs to the outer document, once.
 */
function symbolInner(ink = INK) {
  const inner = symbol(ink).match(/<svg[^>]*>([\s\S]*)<\/svg>/)?.[1] ?? '';
  return inner.replace(/<title>[\s\S]*?<\/title>/, '');
}

/**
 * A macOS app icon is a rounded square drawn by the app, not masked by the OS,
 * on a transparent canvas with air around it: Apple's 1024 grid puts the body
 * at 824 with a 100 px margin and a corner radius near 22.5 % of the body.
 * Rendering the whole thing as one SVG at each target size keeps the corners
 * and the mark crisp instead of resampling a big bitmap down.
 */
async function macTile(size) {
  const body = 824;
  const margin = (1024 - body) / 2;
  const box = Math.round(body * (1 - 0.19 * 2));
  const at = margin + (body - box) / 2;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 1024 1024">
  <rect x="${margin}" y="${margin}" width="${body}" height="${body}" rx="185" fill="${TILE}"/>
  <svg x="${at}" y="${at}" width="${box}" height="${box}" viewBox="0 0 64 64" preserveAspectRatio="xMidYMid meet"><g fill="${INK}">${symbolInner()}</g></svg>
</svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

/**
 * An .icns is an eight byte header ('icns' + total length) and then entries of
 * four byte type, four byte big-endian length (header included) and payload.
 * Since 10.7 the ic* payloads are whole PNG files, which is what iconutil
 * writes for every retina slot; the two 1x slots below 128 px want raw ARGB,
 * so they are left out and macOS downsamples the @2x neighbour instead.
 */
function icns(entries) {
  const chunks = entries.map(({ type, data }) => {
    const head = Buffer.alloc(8);
    head.write(type, 0, 4, 'latin1');
    head.writeUInt32BE(8 + data.length, 4);
    return Buffer.concat([head, data]);
  });
  const total = 8 + chunks.reduce((n, c) => n + c.length, 0);
  const head = Buffer.alloc(8);
  head.write('icns', 0, 4, 'latin1');
  head.writeUInt32BE(total, 4);
  return Buffer.concat([head, ...chunks]);
}

const ICNS_TYPES = [
  ['ic11', 32], // 16@2x
  ['ic12', 64], // 32@2x
  ['ic07', 128],
  ['ic13', 256], // 128@2x
  ['ic08', 256],
  ['ic14', 512], // 256@2x
  ['ic09', 512],
  ['ic10', 1024], // 512@2x
];
const macPngs = new Map();
for (const [, px] of ICNS_TYPES) if (!macPngs.has(px)) macPngs.set(px, await macTile(px));
write(join(cliLauncher, 'Scenri.icns'), icns(ICNS_TYPES.map(([type, px]) => ({ type, data: macPngs.get(px) }))));

// Windows fills the box and rounds nothing, so the square tile serves again.
// 16 to 48 are the list and Desktop sizes; 256 is the large-icon slot Vista
// introduced, PNG-compressed, and the only one Explorer scales the rest from
// when a size is missing.
const winSizes = [16, 24, 32, 48, 64, 256];
const winPngs = await Promise.all(
  winSizes.map(async (size) => ({ size, data: await tile({ svg: symbol(), size, inset: size <= 32 ? 0.08 : 0.12 }) })),
);
write(join(cliLauncher, 'scenri.ico'), ico(winPngs));

console.log('');
