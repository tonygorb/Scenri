/**
 * Shape probe: what codex's image tool actually delivers, measured.
 *
 * Not part of any automated suite - every run spends real draws on the
 * operator's own codex plan. Two arms:
 *
 *   ARMS=G  pnpm exec tsx test/manual-shape-probe.mts
 *     Generations across the four product formats, recording requested vs
 *     delivered vs the tool's own native output (recovered from
 *     ~/.codex/generated_images, where the imagegen tool writes before the
 *     agent copies the file out). Under the no-resize prompt contract,
 *     delivered should EQUAL native; under the old contract the model
 *     shell-resampled every draw (measured 8/8 on 2026-08-29).
 *
 *   ARMS=C  SCENRI_PROBE_BASE=http://127.0.0.1:4790 pnpm exec tsx ...
 *     A 5-hop refinement chain through a RUNNING server (boot one on a
 *     scratch SCENRI_HOME first), recording per-hop delivered size, the
 *     brief's croppedFrom/resizedFrom/resampledHops records, and a Laplacian
 *     sharpness score per hop - chain softness as a curve, not an eyeball.
 *
 * REPEATS=n and FORMATS=portrait,story override the defaults. Results land in
 * ./shape-probe-out/ as JSON plus the drawn PNGs.
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { createCodexEngine } from '@scenri/engine-codex';

const OUT = join(process.cwd(), 'shape-probe-out');
mkdirSync(OUT, { recursive: true });
const ARMS = (process.env.ARMS ?? 'G').split(',');
const REPEATS = Number(process.env.REPEATS ?? 4);
const FORMAT_DEFS: Record<string, [number, number]> = {
  square: [1024, 1024],
  portrait: [1024, 1280],
  story: [1080, 1920],
  landscape: [1600, 900],
};
const FORMATS = (process.env.FORMATS ?? 'square,portrait,story,landscape').split(',').filter((f) => FORMAT_DEFS[f]);

const GEN_DIR = join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'generated_images');
const results: object[] = [];
const record = (row: object) => {
  results.push(row);
  console.log(JSON.stringify(row));
  writeFileSync(join(OUT, 'shape-probe.json'), JSON.stringify(results, null, 2));
};

/** The generated_images entries are per-exec DIRECTORIES holding the tool's own PNGs. */
const snapDirs = () => {
  try {
    return new Set(readdirSync(GEN_DIR));
  } catch {
    return new Set<string>();
  }
};
async function nativeDims(freshDirs: string[]): Promise<[number, number][]> {
  const out: [number, number][] = [];
  for (const d of freshDirs) {
    try {
      for (const f of readdirSync(join(GEN_DIR, d)).filter((n) => n.endsWith('.png'))) {
        const m = await sharp(readFileSync(join(GEN_DIR, d, f))).metadata();
        if (m.width && m.height) out.push([m.width, m.height]);
      }
    } catch {
      /* a vanished dir is fine */
    }
  }
  return out;
}

/** Variance of the Laplacian - the standard cheap focus/sharpness proxy. */
async function sharpness(buf: Buffer): Promise<number> {
  const { data, info } = await sharp(buf)
    .greyscale()
    .resize(512, 512, { fit: 'inside' })
    .convolve({ width: 3, height: 3, kernel: [0, 1, 0, 1, -4, 1, 0, 1, 0] })
    .raw()
    .toBuffer({ resolveWithObject: true });
  let sum = 0;
  let sumSq = 0;
  const n = info.width * info.height;
  for (let i = 0; i < n; i++) {
    sum += data[i];
    sumSq += data[i] * data[i];
  }
  const mean = sum / n;
  return Math.round(sumSq / n - mean * mean);
}

if (ARMS.includes('G')) {
  let saved = 0;
  const engine = createCodexEngine({
    saveImage: (buf: Buffer) => {
      const p = join(OUT, `armG-${++saved}.png`);
      writeFileSync(p, buf);
      return p;
    },
  });
  for (const format of FORMATS) {
    const [w, h] = FORMAT_DEFS[format];
    for (let rep = 0; rep < REPEATS; rep++) {
      const before = snapDirs();
      const t0 = Date.now();
      try {
        const r = await engine.generate({
          prompt: 'a ceramic cup on a wooden table in soft daylight',
          brand: { brand: {}, assetPaths: {} },
          width: w,
          height: h,
          count: 1,
        });
        const meta = await sharp(readFileSync(r.images[0])).metadata();
        const fresh = [...snapDirs()].filter((d) => !before.has(d));
        const native = await nativeDims(fresh);
        const delivered: [number, number] = [meta.width ?? 0, meta.height ?? 0];
        const ratioDrift = Math.abs(delivered[0] / delivered[1] - w / h) / (w / h);
        record({
          arm: 'G',
          format,
          requested: [w, h],
          delivered,
          native,
          deliveredIsNative: native.some(([nw, nh]) => nw === delivered[0] && nh === delivered[1]),
          ratioDriftPct: Math.round(ratioDrift * 1000) / 10,
          secs: Math.round((Date.now() - t0) / 1000),
        });
      } catch (e) {
        record({ arm: 'G', format, requested: [w, h], error: String(e).slice(0, 200) });
      }
    }
  }
}

if (ARMS.includes('C')) {
  const BASE = process.env.SCENRI_PROBE_BASE ?? 'http://127.0.0.1:4790';
  // any on purpose: this drives a live server's JSON, and the probe is
  // operator tooling, not typed product surface
  const post = async (path: string, body: object): Promise<any> => {
    const r = await fetch(BASE + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const j: any = await r.json();
    if (r.status >= 300) throw new Error(`${path} ${r.status}: ${JSON.stringify(j)}`);
    return j;
  };
  const waitDone = async (id: string): Promise<any> => {
    for (;;) {
      const n: any = await (await fetch(`${BASE}/api/nodes/${id}`)).json();
      if (n.status !== 'running') return n;
      await new Promise((r) => setTimeout(r, 5000));
    }
  };
  const made = await post('/api/brands', {
    brand: { specVersion: '0.1', meta: { name: 'Shape Probe' }, palette: { primary: { hex: '#1F3D2B' } } },
  });
  const ws: any = await (await fetch(`${BASE}/api/brands/${made.id}/workspace`)).json();
  const projectId = ws.project.id;
  const FORMAT = { t: 'format', id: 'portrait', w: 1024, h: 1280 };
  const HOPS = [
    'make the light a touch warmer',
    'soften the background slightly',
    'make the textures more natural',
    'a touch more contrast',
    'make the mood calmer',
  ];
  let cur = await waitDone(
    (
      await post('/api/nodes', {
        projectId,
        kind: 'generation',
        engineId: 'codex-cli',
        count: 1,
        brief: { tokens: [FORMAT, { t: 'text', v: 'a ceramic cup on a warm stone ledge, soft morning light' }] },
      })
    ).id,
  );
  for (let hop = 0; cur.status === 'done'; hop++) {
    const buf = Buffer.from(await (await fetch(`${BASE}/api/images/${cur.images[0]}`)).arrayBuffer());
    writeFileSync(join(OUT, `armC-hop${hop}.png`), buf);
    record({
      arm: 'C',
      hop,
      sizes: cur.brief?.rendered?.sizes ?? null,
      requestedSize: cur.brief?.rendered?.requestedSize ?? null,
      croppedFrom: cur.brief?.croppedFrom ?? null,
      resizedFrom: cur.brief?.resizedFrom ?? null,
      resampledHops: cur.brief?.resampledHops ?? 0,
      sharpness: await sharpness(buf),
    });
    if (hop >= HOPS.length) break;
    cur = await waitDone(
      (
        await post('/api/nodes', {
          projectId,
          parentId: cur.id,
          kind: 'edit',
          engineId: 'codex-cli',
          count: 1,
          sourceImage: cur.images[0],
          brief: { tokens: [FORMAT, { t: 'text', v: HOPS[hop] }] },
        })
      ).id,
    );
  }
  if (cur.status !== 'done') record({ arm: 'C', failedAt: cur.id, error: cur.error });
}

console.log('PROBE COMPLETE');
