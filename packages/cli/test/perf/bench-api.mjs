#!/usr/bin/env node
/**
 * Server-side benchmark: boot one Scenri on a fixture tier and time its
 * endpoints. Writes JSON and a markdown table under ~/.scenri-perf/results.
 *
 *   pnpm perf:api -- --tier large --label before [--n 20] [--hold] [--port 4798]
 *
 * `--hold` keeps the server up after the run (for manual DevTools traces).
 * Any endpoint that answers 404 is recorded as missing rather than failing the
 * run, so the same script measures the tree before and after a route lands.
 */
import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { environmentRecord } from './lib/env.mjs';
import { PERF_ROOT, parseArgs, writeResult } from './lib/results.mjs';
import { pickPort, sleep, startScenri } from './lib/server.mjs';
import { kb, ms, summarize } from './lib/stats.mjs';

const args = parseArgs(process.argv.slice(2));
const tier = args.tier ?? 'small';
const label = args.label ?? 'run';
const N = Number(args.n ?? 20);
const home = join(PERF_ROOT, tier);
const markerPath = join(home, 'perf-fixture.json');
if (!existsSync(markerPath)) throw new Error(`no fixture at ${home}; run pnpm perf:seed -- --tier ${tier}`);
const fixture = JSON.parse(readFileSync(markerPath, 'utf8'));

const port = await pickPort(Number(args.port ?? 4798));
const server = await startScenri({ home, port });
const base = server.base;
console.log(`server up on ${base} in ${ms(server.bootMs)} ms`);

async function call(method, path, body) {
  const t0 = performance.now();
  const res = await fetch(base + path, {
    method,
    ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  });
  const buf = await res.arrayBuffer();
  return { ms: performance.now() - t0, status: res.status, bytes: buf.byteLength, buf, headers: res.headers };
}
const json = async (path) => JSON.parse(Buffer.from((await call('GET', path)).buf).toString('utf8'));

const series = [];
/** One timed series. Missing routes (404 on the probe) are recorded, not thrown. */
async function measure(name, paths, { n = N, warm = 3, method = 'GET', body } = {}) {
  const list = Array.isArray(paths) ? paths : [paths];
  const probe = await call(method, list[0], body?.(list[0]));
  if (probe.status === 404) {
    series.push({ name, method, path: list[0], missing: true });
    console.log(`  ${name}: missing (404)`);
    return;
  }
  const times = [];
  const bytes = [];
  for (let i = 0; i < warm + n; i++) {
    const path = list[i % list.length];
    const r = await call(method, path, body?.(path));
    if (i >= warm) {
      times.push(r.ms);
      bytes.push(r.bytes);
    }
  }
  const row = { name, method, path: list[0], n, status: probe.status, ms: summarize(times), bytes: summarize(bytes) };
  series.push(row);
  console.log(`  ${name}: p50 ${ms(row.ms.p50)} ms, p95 ${ms(row.ms.p95)} ms, ${kb(row.bytes.p50)}`);
}

// ---- discovery
const brands = await json('/api/brands');
const brandInfo = [];
for (const b of brands) {
  const ws = await json(`/api/brands/${b.id}/workspace`);
  let nodeCount = Array.isArray(ws.nodes) ? ws.nodes.length : null;
  let items = Array.isArray(ws.nodes) ? ws.nodes : null;
  if (nodeCount === null) {
    const feed = await call('GET', `/api/brands/${b.id}/feed?limit=200`);
    if (feed.status === 200) {
      const f = JSON.parse(Buffer.from(feed.buf).toString('utf8'));
      nodeCount = f.counts?.all ?? f.items.length;
      items = f.items;
    }
  }
  brandInfo.push({
    id: b.id,
    slug: b.slug,
    name: b.json?.meta?.name,
    nodeCount: nodeCount ?? 0,
    projectId: ws.project?.id,
    items: items ?? [],
  });
}
brandInfo.sort((a, b) => b.nodeCount - a.nodeCount);
const big = brandInfo[0];
const small = brandInfo[brandInfo.length - 1];
const doneNodes = big.items.filter((n) => n.status === 'done' && n.images?.length && n.kind !== 'root');
const step = Math.max(1, Math.floor(doneNodes.length / 20));
const sampleNodes = doneNodes.filter((_, i) => i % step === 0).slice(0, 20);
const hashes = [...new Set(sampleNodes.map((n) => n.images[0]))];
console.log(`big brand ${big.slug} (${big.nodeCount} nodes), small brand ${small.slug} (${small.nodeCount})`);

// ---- boot set
console.log('boot set');
await measure('version', '/api/version');
await measure('brands', '/api/brands');
await measure('engines', '/api/engines');
await measure('scenes', '/api/scenes');
await measure('presenters', '/api/presenters');
await measure('demo-products', '/api/demo-products');
await measure('showcase', '/api/showcase');
await measure('index.html', '/');
const html = Buffer.from((await call('GET', '/')).buf).toString('utf8');
const assets = [...html.matchAll(/\/assets\/[^"']+\.(?:js|css)/g)].map((m) => m[0]);
for (const a of assets) await measure(`asset ${a.split('/').pop()}`, a, { n: 5, warm: 1 });

// ---- brand reads
console.log('brand reads');
await measure('workspace (big)', `/api/brands/${big.id}/workspace`, { n: tier === 'stress' ? 5 : N });
await measure('workspace (small)', `/api/brands/${small.id}/workspace`);
await measure('feed page (big)', `/api/brands/${big.id}/feed?limit=60`);
await measure('feed page keepers (big)', `/api/brands/${big.id}/feed?limit=60&lens=keepers`);
await measure('feed search (big)', `/api/brands/${big.id}/feed?limit=60&q=terracotta`);
await measure('feed page (small)', `/api/brands/${small.id}/feed?limit=60`);
await measure('activity (big)', `/api/brands/${big.id}/activity`);
await measure('sets (big)', `/api/brands/${big.id}/sets`);
await measure('products-library (big)', `/api/brands/${big.id}/products-library`);
await measure('usage (big)', `/api/brands/${big.id}/usage`);
await measure('home', '/api/home');

// ---- detail, lineage, images
console.log('details and images');
await measure(
  'node detail',
  sampleNodes.map((n) => `/api/nodes/${n.id}`),
  { warm: 0 },
);
await measure(
  'node lineage',
  sampleNodes.map((n) => `/api/nodes/${n.id}/lineage`),
  { warm: 0 },
);
await measure(
  'image cold',
  hashes.map((h) => `/api/images/${h}`),
  { n: hashes.length, warm: 0 },
);
await measure(
  'image warm',
  hashes.map((h) => `/api/images/${h}`),
  { n: hashes.length, warm: 0 },
);
await measure(
  'thumb 640 cold',
  hashes.map((h) => `/api/images/${h}/thumb?w=640`),
  { n: hashes.length, warm: 0 },
);
await measure(
  'thumb 640 warm',
  hashes.map((h) => `/api/images/${h}/thumb?w=640`),
  { n: hashes.length, warm: 0 },
);
await measure(
  'thumb 160 warm',
  hashes.map((h) => `/api/images/${h}/thumb?w=160`),
  { n: hashes.length, warm: 0 },
);

// ---- writes: keep on then off, net state unchanged
console.log('writes');
const keepPaths = sampleNodes.map((n) => `/api/nodes/${n.id}/keep`);
let flip = false;
await measure('keep toggle', keepPaths, {
  method: 'POST',
  warm: 0,
  n: keepPaths.length * 2,
  body: () => {
    flip = !flip;
    return { kept: flip };
  },
});
for (const n of sampleNodes) await call('POST', `/api/nodes/${n.id}/keep`, { kept: !!n.kept });

// ---- generation through the demo engine, then restore the fixture
console.log('generation (demo engine)');
const accept = [];
const toDone = [];
const made = [];
for (let i = 0; i < 5; i++) {
  const t0 = performance.now();
  const res = await call('POST', '/api/nodes', {
    projectId: big.projectId,
    kind: 'generation',
    engineId: 'demo',
    count: 1,
    prompt: 'perf probe',
    width: 1024,
    height: 1280,
  });
  accept.push(performance.now() - t0);
  const node = JSON.parse(Buffer.from(res.buf).toString('utf8'));
  let cur = node;
  for (let j = 0; j < 400 && cur.status === 'running'; j++) {
    await sleep(25);
    cur = await json(`/api/nodes/${node.id}`);
  }
  toDone.push(performance.now() - t0);
  made.push(cur);
}
const generation = { accept: summarize(accept), done: summarize(toDone) };
console.log(`  accept p50 ${ms(generation.accept.p50)} ms, to done p50 ${ms(generation.done.p50)} ms`);
for (const n of made) {
  await call('POST', `/api/nodes/${n.id}/archive`, { archived: true });
  await call('DELETE', `/api/nodes/${n.id}`);
  for (const h of n.images ?? []) {
    for (const f of [
      join(home, 'images', `${h}.png`),
      join(home, 'thumbs', `${h}-w640.webp`),
      join(home, 'thumbs', `${h}-w160.webp`),
    ]) {
      if (existsSync(f)) unlinkSync(f);
    }
  }
}

const result = {
  kind: 'api',
  tier,
  label,
  env: environmentRecord({ loadAtEnd: (await import('node:os')).loadavg()[0] }),
  fixture,
  brands: brandInfo.map(({ items, ...b }) => b),
  server: { bootMs: server.bootMs, port, log: server.log },
  series,
  generation,
};
const md = [
  `# perf:api ${tier} ${label} (${result.env.sha}${result.env.dirty ? ' dirty' : ''})`,
  '',
  `boot to /api/version: ${ms(server.bootMs)} ms`,
  '',
  '| series | n | p50 ms | p95 ms | max ms | bytes p50 |',
  '|---|---|---|---|---|---|',
  ...series.map((s) =>
    s.missing
      ? `| ${s.name} | - | missing | | | |`
      : `| ${s.name} | ${s.n} | ${ms(s.ms.p50)} | ${ms(s.ms.p95)} | ${ms(s.ms.max)} | ${kb(s.bytes.p50)} |`,
  ),
  `| generation accept | 5 | ${ms(generation.accept.p50)} | ${ms(generation.accept.p95)} | ${ms(generation.accept.max)} | |`,
  `| generation to done | 5 | ${ms(generation.done.p50)} | ${ms(generation.done.p95)} | ${ms(generation.done.max)} | |`,
  '',
].join('\n');
const paths = writeResult(result, md);
console.log(md);
console.log(`written ${paths.jsonPath}`);
if (server.log.some((l) => l.includes('Repaired presenter thumbnails')))
  console.log('WARNING: boot repaired presenter crops; the fixture was mutated');

if (args.hold) {
  console.log(`holding ${base} (home ${home}); Ctrl-C to stop`);
  await new Promise((res) => process.once('SIGINT', res));
}
await server.stop();
