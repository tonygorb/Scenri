import { createHash } from 'node:crypto';
import { constants, copyFileSync, existsSync, linkSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { POOL_VERSION } from './tiers.mjs';
import { rng } from './prng.mjs';

/**
 * One pool of unique PNGs shared by every tier, hard-linked into each tier's
 * `images/` under the hash the store would assign (imageStore.ts:21 rule).
 *
 * Sizes follow the real library's mix. Files are calibrated to about 1.2 MB
 * (the real median is 1.4 MB, p90 2.7 MB): a gradient with soft shapes plus
 * per-pixel noise of a tuned amplitude, since it is the noise that decides
 * how much a PNG compresses.
 */
export const SIZES = [
  { w: 1024, h: 1280, weight: 45 },
  { w: 1122, h: 1402, weight: 20 },
  { w: 1024, h: 1024, weight: 20 },
  { w: 1536, h: 1024, weight: 10 },
  { w: 1080, h: 1920, weight: 5 },
];
const TARGET_BYTES = 1_200_000;
const AMPLITUDES = [1, 2, 3, 4, 5, 6, 8, 10, 13];

function hexToRgb(hex) {
  return [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
}

const SWATCHES = [
  '#D96C3B',
  '#1F2933',
  '#C9A96E',
  '#EFE7DC',
  '#2F4858',
  '#F6F1EB',
  '#3B3A36',
  '#9C6644',
  '#7F9172',
  '#0B3D2E',
];

/** Raw RGB pixels: two-stop gradient, a few soft ellipses, then uniform noise. */
function paint(seed, w, h, amplitude) {
  const r = rng(`paint:${seed}`);
  const c0 = hexToRgb(r.pick(SWATCHES));
  const c1 = hexToRgb(r.pick(SWATCHES));
  const angle = r.float(0, Math.PI * 2);
  const ax = Math.cos(angle);
  const ay = Math.sin(angle);
  const shapes = Array.from({ length: r.int(6, 12) }, () => ({
    cx: r.float(0, w),
    cy: r.float(0, h),
    rx: r.float(w * 0.05, w * 0.3),
    ry: r.float(h * 0.05, h * 0.3),
    tint: hexToRgb(r.pick(SWATCHES)),
    alpha: r.float(0.15, 0.5),
  }));
  const buf = Buffer.alloc(w * h * 3);
  // xorshift32 inline: a closure per pixel is what makes this slow
  let s = cyrbSeed(seed) || 1;
  const span = w * ax + h * ay;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const t = Math.max(0, Math.min(1, (x * ax + y * ay) / span));
      let rr = c0[0] + (c1[0] - c0[0]) * t;
      let gg = c0[1] + (c1[1] - c0[1]) * t;
      let bb = c0[2] + (c1[2] - c0[2]) * t;
      for (const sh of shapes) {
        const dx = (x - sh.cx) / sh.rx;
        const dy = (y - sh.cy) / sh.ry;
        const d = dx * dx + dy * dy;
        if (d < 1) {
          const a = sh.alpha * (1 - d);
          rr += (sh.tint[0] - rr) * a;
          gg += (sh.tint[1] - gg) * a;
          bb += (sh.tint[2] - bb) * a;
        }
      }
      const o = (y * w + x) * 3;
      s ^= s << 13;
      s ^= s >>> 17;
      s ^= s << 5;
      const n0 = ((s & 0xff) / 255 - 0.5) * 2 * amplitude;
      const n1 = (((s >>> 8) & 0xff) / 255 - 0.5) * 2 * amplitude;
      const n2 = (((s >>> 16) & 0xff) / 255 - 0.5) * 2 * amplitude;
      buf[o] = clamp(rr + n0);
      buf[o + 1] = clamp(gg + n1);
      buf[o + 2] = clamp(bb + n2);
    }
  }
  return buf;
}

function cyrbSeed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return h >>> 0;
}
const clamp = (v) => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));

async function encode(raw, w, h) {
  return sharp(raw, { raw: { width: w, height: h, channels: 3 } })
    .png({ compressionLevel: 6, adaptiveFiltering: false })
    .toBuffer();
}

/** The noise amplitude whose PNG lands closest to the target, per size. */
async function calibrate(size) {
  let best = { amplitude: AMPLITUDES[0], bytes: 0 };
  for (const amplitude of AMPLITUDES) {
    const png = await encode(paint(`calibrate:${size.w}x${size.h}`, size.w, size.h, amplitude), size.w, size.h);
    if (best.bytes === 0 || Math.abs(png.length - TARGET_BYTES) < Math.abs(best.bytes - TARGET_BYTES)) {
      best = { amplitude, bytes: png.length };
    }
    if (png.length > TARGET_BYTES) break;
  }
  return best;
}

export const hashOf = (png) => createHash('sha256').update(png).digest('hex').slice(0, 32);

/**
 * Make (or reuse) the pool. Returns the manifest: `files[i] = { i, hash, w, h, bytes }`
 * with `path(hash)`.
 */
export async function ensurePool(dir, count, seed, { force = false, log = () => {} } = {}) {
  const manifestPath = join(dir, 'pool.json');
  if (force && existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  let manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : null;
  if (manifest && manifest.poolVersion === POOL_VERSION && manifest.seed === seed && manifest.count >= count) {
    return withPath(manifest, dir);
  }
  const started = Date.now();
  const calibration = {};
  for (const size of SIZES) {
    calibration[`${size.w}x${size.h}`] = await calibrate(size);
    log(`pool: ${size.w}x${size.h} amplitude ${calibration[`${size.w}x${size.h}`].amplitude}`);
  }
  const r = rng(`${seed}:sizes`);
  const jobs = Array.from({ length: count }, (_, i) => ({ i, size: r.weighted(SIZES.map((s) => [s, s.weight])) }));
  const files = new Array(count);
  let cursor = 0;
  const worker = async () => {
    while (cursor < jobs.length) {
      const job = jobs[cursor++];
      const key = `${job.size.w}x${job.size.h}`;
      const png = await encode(
        paint(`${seed}:${job.i}`, job.size.w, job.size.h, calibration[key].amplitude),
        job.size.w,
        job.size.h,
      );
      const hash = hashOf(png);
      writeFileSync(join(dir, `${hash}.png`), png);
      files[job.i] = { i: job.i, hash, w: job.size.w, h: job.size.h, bytes: png.length };
      if (job.i % 100 === 0) log(`pool: ${job.i}/${count}`);
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
  manifest = {
    poolVersion: POOL_VERSION,
    seed,
    count,
    target: TARGET_BYTES,
    calibration,
    files,
    durationMs: Date.now() - started,
  };
  writeFileSync(manifestPath, JSON.stringify(manifest));
  log(`pool: ${count} files in ${Math.round(manifest.durationMs / 1000)}s`);
  return withPath(manifest, dir);
}

function withPath(manifest, dir) {
  return { ...manifest, path: (hash) => join(dir, `${hash}.png`) };
}

/** Hard link when the volume allows it, clone or copy otherwise. Never rewrites an existing file. */
export function linkImage(src, dest) {
  if (existsSync(dest)) return;
  try {
    linkSync(src, dest);
  } catch {
    try {
      copyFileSync(src, dest, constants.COPYFILE_FICLONE);
    } catch {
      copyFileSync(src, dest);
    }
  }
}
