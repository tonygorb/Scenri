#!/usr/bin/env node
/**
 * Browser benchmark: drive the built studio against a fixture tier with
 * Playwright Chromium and time what a person feels. Not a test; no assertions.
 *
 *   pnpm perf:ui -- --tier large --label before [--url http://127.0.0.1:4798] [--headed] [--no-motion] [--screens 20]
 *
 * Boots its own Scenri unless --url names a held one (pnpm perf:api -- --hold).
 * Every step runs under a 120 s budget and records a timeout instead of
 * aborting the run, so STRESS still produces a table.
 */
import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import { join } from 'node:path';
import { chromium, devices } from '@playwright/test';
import { environmentRecord } from '../../../packages/cli/test/perf/lib/env.mjs';
import { PERF_ROOT, parseArgs, writeResult } from '../../../packages/cli/test/perf/lib/results.mjs';
import { pickPort, sleep, startScenri } from '../../../packages/cli/test/perf/lib/server.mjs';
import { kb, ms, summarize } from '../../../packages/cli/test/perf/lib/stats.mjs';
import { INPAGE } from './inpage.mjs';

const args = parseArgs(process.argv.slice(2));
const tier = args.tier ?? 'small';
const label = args.label ?? 'run';
const SCREENS = Number(args.screens ?? 20);
const STEP_MS = 120_000;
const home = join(PERF_ROOT, tier);
const markerPath = join(home, 'perf-fixture.json');
if (!existsSync(markerPath)) throw new Error(`no fixture at ${home}; run pnpm perf:seed -- --tier ${tier}`);
const fixture = JSON.parse(readFileSync(markerPath, 'utf8'));

const SEL = {
  cell: '.sc-cell[data-fb-node]',
  cellLoaded: '.sc-cellimg[data-loaded]',
  open: 'a.sc-cell-open',
  more: '.sc-cell-more',
  star: '.sc-cell-star',
  overlay: '.sc-ovl',
  stageImg: '.sc-frame img',
  orgBtn: '.sc-org-btn',
  menuItem: '.sc-menu-item',
  home: '.sc-home',
  searchToggle: '.sc-libsearch-toggle',
  searchInput: 'input[type="search"]',
  lensButtons: '.sc-toolbar .sc-verticals button',
  sortBtn: 'button[aria-label="Sort shots"]',
  railToggle: '.sc-toolbar-assets',
  rail: 'aside.sc-assets',
  railImg: '.sc-acard img',
  canvas: '.sc-canvas',
};

// ---- server
let server = null;
let base = args.url;
if (base) {
  const v = await (await fetch(`${base}/api/version`)).json();
  if (!String(v.home ?? '').startsWith(PERF_ROOT)) throw new Error(`${base} serves ${v.home}, not a perf fixture`);
  if (new URL(base).port === '4747') throw new Error('never bench the owner server');
} else {
  server = await startScenri({ home, port: await pickPort(Number(args.port ?? 4798)) });
  base = server.base;
}
const api = async (path) => (await fetch(base + path)).json();
const brandsRaw = await api('/api/brands');
const brands = [];
for (const b of brandsRaw) {
  const ws = await api(`/api/brands/${b.id}/workspace`);
  let count = Array.isArray(ws.nodes) ? ws.nodes.length : null;
  if (count === null) {
    const feed = await fetch(`${base}/api/brands/${b.id}/feed?limit=1`);
    count = feed.status === 200 ? ((await feed.json()).counts?.all ?? 0) : 0;
  }
  brands.push({ id: b.id, slug: b.slug, name: b.json?.meta?.name ?? b.slug, count });
}
brands.sort((a, b) => b.count - a.count);
const big = brands[0];
const small = brands.find((b) => b.count >= 5 && b !== big) ?? brands[brands.length - 1];
console.log(`${base}: big ${big.slug} (${big.count}), small ${small.slug} (${small.count})`);

// ---- browser
const browser = await chromium.launch({ headless: !args.headed });
const context = await browser.newContext({
  ...devices['Desktop Chrome'],
  viewport: { width: 1512, height: 982 },
  deviceScaleFactor: 1,
  colorScheme: 'dark',
});
await context.addInitScript(INPAGE);
await context.addInitScript((noMotion) => {
  localStorage.setItem('sc-theme', 'dark');
  localStorage.setItem('scenri:assets-open', 'false');
  localStorage.setItem('scenri:tile-size', '320');
  localStorage.setItem('scenri:feed-sort', '"newest"');
  let s = 42;
  Math.random = () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
  if (noMotion) {
    const style = document.createElement('style');
    style.textContent =
      '*, *::before, *::after { animation: none !important; transition: none !important; scroll-behavior: auto !important; }';
    document.documentElement.append(style);
  }
}, !!args['no-motion']);

let page = await context.newPage();
page.setDefaultTimeout(15_000);
let cdp = await context.newCDPSession(page);
const net = { section: null, buckets: {} };
const requests = new Map();
async function wireCdp() {
  await cdp.send('Performance.enable');
  await cdp.send('Network.enable');
  cdp.on('Network.responseReceived', (e) => requests.set(e.requestId, e.response.url));
  cdp.on('Network.loadingFinished', (e) => {
    const url = requests.get(e.requestId) ?? '';
    const key0 = net.section ?? 'idle';
    if (!net.buckets[key0]) net.buckets[key0] = { image: 0, api: 0, static: 0, requests: 0, urls: {} };
    const b = net.buckets[key0];
    const kind = url.includes('/api/images/') ? 'image' : url.includes('/api/') ? 'api' : 'static';
    b[kind] += e.encodedDataLength;
    b.requests++;
    const key = url
      .replace(base, '')
      .replace(/[0-9a-f]{32}/g, ':hash')
      .replace(/[0-9a-f-]{36}/g, ':id')
      .split('?')[0];
    b.urls[key] = (b.urls[key] ?? 0) + e.encodedDataLength;
  });
}
await wireCdp();

const metrics = async () => {
  const m = await cdp.send('Performance.getMetrics');
  return Object.fromEntries(m.metrics.map((x) => [x.name, x.value]));
};
const delta = (a, b, keys) => Object.fromEntries(keys.map((k) => [k, (b[k] ?? 0) - (a[k] ?? 0)]));
const METRIC_KEYS = [
  'LayoutCount',
  'RecalcStyleCount',
  'LayoutDuration',
  'RecalcStyleDuration',
  'ScriptDuration',
  'TaskDuration',
];

async function section(name, fn) {
  net.section = name;
  net.buckets[name] = { image: 0, api: 0, static: 0, requests: 0, urls: {} };
  await page.evaluate((n) => window.__perf.begin(n), name);
  const m0 = await metrics();
  let out;
  let timedOut = false;
  try {
    out = await Promise.race([fn(), sleep(STEP_MS).then(() => Promise.reject(new Error('timeout')))]);
  } catch (err) {
    timedOut = true;
    out = { error: String(err.message ?? err) };
    console.log(`  ${name}: ${out.error}`);
  }
  const m1 = await metrics();
  await page.evaluate(() => window.__perf.end());
  const sample = await page.evaluate((n) => window.__perf.take(n), name);
  const frames = sample.frames;
  const over33 = frames.filter((d) => d > 33).length;
  net.section = null;
  const result = {
    ...(out ?? {}),
    timeout: timedOut || undefined,
    longTasks: {
      count: sample.longtasks.length,
      totalMs: Math.round(sample.longtasks.reduce((s, x) => s + x.d, 0)),
      max: Math.round(Math.max(0, ...sample.longtasks.map((x) => x.d))),
    },
    frames: {
      n: frames.length,
      over33,
      share: frames.length ? Math.round((over33 / frames.length) * 1000) / 10 : 0,
      worst: Math.round(Math.max(0, ...frames)),
    },
    inputEvents: summarize(sample.events.map((e) => e.d)),
    metrics: delta(m0, m1, METRIC_KEYS),
    bytes: net.buckets[name],
  };
  return result;
}

const now = () => page.evaluate(() => performance.now());
const until = (fnSource, arg, timeout = 120000) =>
  page.evaluate(
    ([src, a, t]) => window.__perf.until(new Function('arg', `return (${src})(arg)`).bind(null, a), t),
    [fnSource, arg, timeout],
  );
const count = (sel) => page.locator(sel).count();
const domNodes = () => page.evaluate(() => document.getElementsByTagName('*').length);
const firstCellId = () =>
  page.evaluate((s) => document.querySelector(s)?.getAttribute('data-fb-node') ?? null, SEL.cell);

/** Every section starts on the big brand's feed; a failed step must not poison the next. */
async function ensureFeed() {
  const path = await page.evaluate(() => location.pathname).catch(() => '');
  if (path !== `/${big.slug}/create` || (await count(SEL.cell)) === 0) {
    await page.goto(`${base}/${big.slug}/create`, { waitUntil: 'commit' });
    await until("() => document.querySelector('.sc-cellimg[data-loaded]')");
    await sleep(500);
  }
  await page.keyboard.press('Escape').catch(() => {});
}

async function scrollScreens(n, settleMs = 250) {
  const canvas = page.locator(SEL.canvas);
  const box = await canvas.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  const screen = await page.evaluate((s) => document.querySelector(s).clientHeight, SEL.canvas);
  for (let i = 0; i < n; i++) {
    for (let y = 0; y < screen; y += 120) {
      await page.mouse.wheel(0, 120);
      await sleep(16);
    }
    await sleep(settleMs);
  }
}
const scrollTop = () =>
  page.evaluate((s) => document.querySelector(s).scrollTo({ top: 0, behavior: 'instant' }), SEL.canvas);

const results = { boot: [], sections: {} };
const only = args.only ? new Set(String(args.only).split(',')) : null;
const want = (name) => !only || only.has(name);
const BOOT_RUNS = args.boots ? Number(args.boots) : only && !only.has('boot') ? 1 : 3;
const SKIPPED = {
  skipped: true,
  longTasks: { count: 0, totalMs: 0, max: 0 },
  frames: { n: 0, over33: 0, share: 0, worst: 0 },
  metrics: {},
  bytes: { image: 0, api: 0, static: 0, requests: 0, urls: {} },
};

// ---- boot to first feed paint (3 fresh pages)
for (let i = 0; i < BOOT_RUNS; i++) {
  if (i > 0) {
    await page.close();
    page = await context.newPage();
    page.setDefaultTimeout(15_000);
    cdp = await context.newCDPSession(page);
    await wireCdp();
  }
  const r = await section('boot', async () => {
    await page.goto(`${base}/${big.slug}/create`, { waitUntil: 'commit' });
    const firstFeedPaint = await until("() => document.querySelector('.sc-cellimg[data-loaded]')");
    const timing = await page.evaluate(() => {
      const nav = performance.getEntriesByType('navigation')[0];
      const paint = Object.fromEntries(performance.getEntriesByType('paint').map((p) => [p.name, p.startTime]));
      const res = performance
        .getEntriesByType('resource')
        .filter((r) => /\/api\/brands\/[^/]+\/(workspace|feed)/.test(r.name));
      return {
        responseEnd: nav?.responseEnd,
        domContentLoaded: nav?.domContentLoadedEventEnd,
        fcp: paint['first-contentful-paint'],
        lcp: window.__perf.lcp,
        list: res.map((r) => ({
          name: r.name.replace(/^.*\/api/, '/api').split('?')[0],
          ms: r.duration,
          bytes: r.encodedBodySize,
        })),
      };
    });
    await sleep(500);
    const imgs = await page.evaluate(() => {
      const list = Array.from(document.querySelectorAll('.sc-cellimg img'));
      const vh = window.innerHeight;
      return {
        images: list.length,
        imagesComplete: list.filter((i) => i.complete && i.naturalWidth > 0).length,
        visibleCells: Array.from(document.querySelectorAll('.sc-cell[data-fb-node]')).filter((c) => {
          const b = c.getBoundingClientRect();
          return b.bottom > 0 && b.top < vh;
        }).length,
      };
    });
    return { firstFeedPaint, ...timing, domNodes: await domNodes(), cells: await count(SEL.cell), ...imgs };
  });
  results.boot.push(r);
  console.log(
    `boot ${i + 1}: first feed paint ${ms(r.firstFeedPaint)} ms, ${r.cells} cells, ${r.domNodes} DOM nodes, ${kb(r.bytes.image)} images`,
  );
}

// ---- scroll
results.sections.scroll = !want('scroll')
  ? SKIPPED
  : await section('scroll', async () => {
      await scrollScreens(SCREENS);
      const out = {
        screens: SCREENS,
        cellsAtEnd: await count(SEL.cell),
        domNodesAtEnd: await domNodes(),
        scrollTop: await page.evaluate((s) => document.querySelector(s).scrollTop, SEL.canvas),
      };
      await scrollTop();
      await sleep(300);
      return out;
    });
console.log(
  `scroll: ${results.sections.scroll.longTasks.count} long tasks, ${results.sections.scroll.frames.over33} frames over 33 ms of ${results.sections.scroll.frames.n}, ${kb(results.sections.scroll.bytes.image)} images`,
);

// ---- hover
results.sections.hover = !want('hover')
  ? SKIPPED
  : await section('hover', async () => {
      await ensureFeed();
      const cells = page.locator(SEL.cell);
      const n = Math.min(20, await cells.count());
      for (let pass = 0; pass < 3; pass++) {
        for (let i = 0; i < n; i++) {
          await cells.nth(i).hover();
          await sleep(120);
        }
      }
      return { tiles: n, passes: 3 };
    });
console.log(
  `hover: ${results.sections.hover.frames.over33} frames over 33 ms, style ${ms(results.sections.hover.metrics.RecalcStyleDuration * 1000)} ms`,
);

// ---- keeper toggle
const toggled = [];
results.sections.keeper = !want('keeper')
  ? SKIPPED
  : await section('keeper', async () => {
      await ensureFeed();
      const times = [];
      const listBytes = [];
      for (let i = 0; i < 6; i++) {
        // the id first, then the tile by its id: the feed is windowed, so a
        // hover that scrolls can change which tiles are mounted and what
        // "the i-th tile" resolves to between two actions
        const id = await page.locator(`${SEL.cell}:not(:has(${SEL.star}))`).nth(i).getAttribute('data-fb-node');
        const target = page.locator(`${SEL.cell}[data-fb-node="${id}"]`);
        await target.hover();
        await sleep(150);
        await target.locator(SEL.more).click();
        const item = page.getByRole('menuitem', { name: 'Keep', exact: true });
        await item.waitFor();
        const before = net.buckets.keeper.api;
        const t0 = await now();
        await item.click();
        const t1 = await until(
          "(id) => document.querySelector('.sc-cell[data-fb-node=\"' + id + '\"] .sc-cell-star')",
          id,
        );
        toggled.push(id);
        if (i > 0) {
          times.push(t1 - t0);
          listBytes.push(net.buckets.keeper.api - before);
        }
        await sleep(300);
      }
      return { ms: summarize(times), apiBytesPerToggle: summarize(listBytes) };
    });
console.log(
  `keeper: p50 ${ms(results.sections.keeper.ms?.p50)} ms, api bytes per toggle ${kb(results.sections.keeper.apiBytesPerToggle?.p50)}`,
);

// ---- open shot
results.sections.open = !want('open')
  ? SKIPPED
  : await section('open', async () => {
      await ensureFeed();
      // from the top: an earlier section may have left the feed scrolled, and
      // closing the overlay lands back at the top, where a tile snapshotted
      // lower down is no longer mounted
      await scrollTop();
      await sleep(300);
      const overlay = [];
      const stage = [];
      const close = [];
      const stageBytes = [];
      // ids first, tiles by id: the feed is windowed, so what is mounted (and
      // what the i-th tile is) changes as the page scrolls a tile into view
      // only tiles with a picture: a failed shot's stage is a note, not an image
      const ids = await page.evaluate(
        (sel) =>
          [...document.querySelectorAll(sel)]
            .filter((el) => el.querySelector('.sc-cellimg'))
            .map((el) => el.getAttribute('data-fb-node')),
        SEL.cell,
      );
      for (let i = 0; i < 6; i++) {
        const id = ids[Math.min(ids.length - 1, i * 3)];
        const cell = page.locator(`${SEL.cell}[data-fb-node="${id}"]`);
        await cell.scrollIntoViewIfNeeded();
        await sleep(200);
        const before = net.buckets.open.image;
        const t0 = await now();
        await cell.locator(SEL.open).click();
        const t1 = await until("() => document.querySelector('.sc-ovl')");
        const t2 = await until(
          "() => { const i = document.querySelector('.sc-frame img'); return i && i.complete && i.naturalWidth > 0; }",
        );
        await sleep(300);
        const t3 = await now();
        await page.keyboard.press('Escape');
        const t4 = await until("() => !document.querySelector('.sc-ovl')");
        if (i > 0) {
          overlay.push(t1 - t0);
          stage.push(t2 - t0);
          close.push(t4 - t3);
          stageBytes.push(net.buckets.open.image - before);
        }
        await sleep(300);
      }
      await scrollTop();
      return {
        overlay: summarize(overlay),
        stage: summarize(stage),
        close: summarize(close),
        imageBytesPerOpen: summarize(stageBytes),
      };
    });
console.log(
  `open: overlay p50 ${ms(results.sections.open.overlay?.p50)} ms, stage p50 ${ms(results.sections.open.stage?.p50)} ms, ${kb(results.sections.open.imageBytesPerOpen?.p50)} per open`,
);

// ---- brand switch
results.sections.brandSwitch = !want('brandSwitch')
  ? SKIPPED
  : await section('brandSwitch', async () => {
      await ensureFeed();
      const homeMs = [];
      const feedMs = [];
      const apiBytes = [];
      let target = small;
      for (let i = 0; i < 6; i++) {
        const before = net.buckets.brandSwitch.api;
        await page.locator(SEL.orgBtn).click();
        // the exact name: with fifty brands "Norrland Home" also appears inside
        // "Norrland Home 2", and hasText would take the first of them
        const item = page
          .locator(`${SEL.menuItem}:not([data-current])`, {
            has: page.locator(`span[dir="auto"]:text-is("${target.name.replace(/"/g, '\\"')}")`),
          })
          .first();
        await item.waitFor();
        const t0 = await now();
        await item.click();
        const t1 = await until(
          "(slug) => location.pathname === '/' + slug && document.querySelector('.sc-home')",
          target.slug,
        );
        await page.locator(`nav.sc-nav a[href^="/${target.slug}/create"]`).first().click();
        const t2 = await until("() => document.querySelector('.sc-cellimg[data-loaded]')");
        if (i > 0) {
          homeMs.push(t1 - t0);
          feedMs.push(t2 - t0);
          apiBytes.push(net.buckets.brandSwitch.api - before);
        }
        await sleep(400);
        target = target === small ? big : small;
      }
      if ((await page.evaluate(() => location.pathname)) !== `/${big.slug}/create`) {
        await page.goto(`${base}/${big.slug}/create`);
        await until("() => document.querySelector('.sc-cellimg[data-loaded]')");
      }
      return { home: summarize(homeMs), feed: summarize(feedMs), apiBytesPerSwitch: summarize(apiBytes) };
    });
console.log(
  `brand switch: home p50 ${ms(results.sections.brandSwitch.home?.p50)} ms, feed p50 ${ms(results.sections.brandSwitch.feed?.p50)} ms`,
);

// ---- search per keystroke
const state = () =>
  page.evaluate(() => ({
    counts: Array.from(document.querySelectorAll('.sc-vcount'))
      .map((e) => e.textContent)
      .join('|'),
    cells: document.querySelectorAll('.sc-cell[data-fb-node]').length,
    first: document.querySelector('.sc-cell[data-fb-node]')?.getAttribute('data-fb-node') ?? null,
  }));
results.sections.search = !want('search')
  ? SKIPPED
  : await section('search', async () => {
      await ensureFeed();
      await page.locator(SEL.searchToggle).click();
      const input = page.locator(SEL.searchInput);
      await input.waitFor();
      await input.focus();
      const perKey = [];
      let unchanged = 0;
      for (const ch of 'terracotta') {
        const before = await state();
        const t0 = await now();
        await input.press(ch);
        const t1 = await until(
          "(b) => { const counts = Array.from(document.querySelectorAll('.sc-vcount')).map((e) => e.textContent).join('|'); const cells = document.querySelectorAll('.sc-cell[data-fb-node]').length; return counts !== b.counts || cells !== b.cells; }",
          before,
          2000,
        ).catch(() => null);
        if (t1 === null) unchanged++;
        else perKey.push(t1 - t0);
        await sleep(60);
      }
      const after = await state();
      await page.keyboard.press('Escape');
      await page.keyboard.press('Escape');
      await sleep(300);
      return {
        perKey: summarize(perKey),
        keys: perKey.map((v) => Math.round(v)),
        unchangedKeys: unchanged,
        countsAfter: after.counts,
        cellsAfter: after.cells,
      };
    });
console.log(
  `search: per key p50 ${ms(results.sections.search.perKey?.p50)} ms, ${results.sections.search.unchangedKeys ?? '-'} keys without visible change, counts ${results.sections.search.countsAfter}`,
);

// ---- lens and sort
results.sections.lens = !want('lens')
  ? SKIPPED
  : await section('lens', async () => {
      await ensureFeed();
      const times = [];
      const buttons = page.locator(SEL.lensButtons);
      for (let round = 0; round < 5; round++) {
        for (const idx of [1, 0, 2, 0]) {
          const before = await state();
          const t0 = await now();
          await buttons.nth(idx).click();
          const t1 = await until(
            "(b) => { const cells = document.querySelectorAll('.sc-cell[data-fb-node]').length; const first = document.querySelector('.sc-cell[data-fb-node]')?.getAttribute('data-fb-node') ?? null; return cells !== b.cells || first !== b.first; }",
            before,
          ).catch(() => null);
          times.push(t1 === null ? 400 : t1 - t0);
          await sleep(150);
        }
      }
      return { ms: summarize(times) };
    });
console.log(`lens: p50 ${ms(results.sections.lens.ms?.p50)} ms`);

results.sections.sort = !want('sort')
  ? SKIPPED
  : await section('sort', async () => {
      await ensureFeed();
      const times = [];
      for (let round = 0; round < 5; round++) {
        for (const name of ['Oldest first', 'Newest first']) {
          const before = await firstCellId();
          await page.locator(SEL.sortBtn).click();
          const item = page.getByRole('menuitemradio', { name });
          await item.waitFor();
          const t0 = await now();
          await item.click();
          const t1 = await until(
            "(b) => (document.querySelector('.sc-cell[data-fb-node]')?.getAttribute('data-fb-node') ?? null) !== b",
            before,
          ).catch(() => null);
          times.push(t1 === null ? 400 : t1 - t0);
          await sleep(200);
        }
      }
      return { ms: summarize(times) };
    });
console.log(`sort: p50 ${ms(results.sections.sort.ms?.p50)} ms`);

// ---- assets rail
results.sections.rail = !want('rail')
  ? SKIPPED
  : await section('rail', async () => {
      await ensureFeed();
      const times = [];
      for (let i = 0; i < 3; i++) {
        const t0 = await now();
        await page.locator(SEL.railToggle).click();
        const t1 = await until(
          "() => { const a = document.querySelector('aside.sc-assets'); if (!a || a.offsetParent === null) return false; const imgs = Array.from(a.querySelectorAll('.sc-acard img')); return imgs.every((i) => i.complete); }",
        );
        times.push(t1 - t0);
        await sleep(300);
        await page.locator(SEL.railToggle).click();
        await sleep(400);
      }
      return { ms: summarize(times) };
    });
console.log(`rail: p50 ${ms(results.sections.rail.ms?.p50)} ms, ${kb(results.sections.rail.bytes.image)} images`);

// ---- heap after a browsing loop
results.sections.heap = !want('heap')
  ? SKIPPED
  : await section('heap', async () => {
      await ensureFeed();
      await cdp.send('HeapProfiler.collectGarbage');
      const before = await metrics();
      const domBefore = await domNodes();
      await scrollScreens(10, 150);
      const cells = page.locator(SEL.cell);
      const n = await cells.count();
      for (let i = 0; i < 10; i++) {
        const cell = cells.nth(Math.min(n - 1, i * 3));
        await cell.scrollIntoViewIfNeeded();
        await cell.locator(SEL.open).click();
        await until("() => { const i = document.querySelector('.sc-frame img'); return i && i.complete; }");
        await page.keyboard.press('Escape');
        await until("() => !document.querySelector('.sc-ovl')");
      }
      let target = small;
      for (let i = 0; i < 5; i++) {
        await page.locator(SEL.orgBtn).click();
        const item = page
          .locator(`${SEL.menuItem}:not([data-current])`, {
            has: page.locator(`span[dir="auto"]:text-is("${target.name.replace(/"/g, '\\"')}")`),
          })
          .first();
        await item.click();
        await until("(slug) => location.pathname === '/' + slug && document.querySelector('.sc-home')", target.slug);
        await page.locator(`nav.sc-nav a[href^="/${target.slug}/create"]`).first().click();
        await until("() => document.querySelector('.sc-cellimg[data-loaded]')");
        target = target === small ? big : small;
      }
      if ((await page.evaluate(() => location.pathname)) !== `/${big.slug}/create`) {
        await page.locator(SEL.orgBtn).click();
        await page
          .locator(`${SEL.menuItem}:not([data-current])`, {
            has: page.locator(`span[dir="auto"]:text-is("${big.name.replace(/"/g, '\\"')}")`),
          })
          .first()
          .click();
        await until("(slug) => location.pathname === '/' + slug", big.slug);
        await page.locator(`nav.sc-nav a[href^="/${big.slug}/create"]`).first().click();
        await until("() => document.querySelector('.sc-cellimg[data-loaded]')");
      }
      await scrollTop();
      await sleep(1000);
      await cdp.send('HeapProfiler.collectGarbage');
      await sleep(500);
      const after = await metrics();
      const domAfter = await domNodes();
      return {
        heapBeforeMb: Math.round(before.JSHeapUsedSize / 1048576),
        heapAfterMb: Math.round(after.JSHeapUsedSize / 1048576),
        heapDeltaMb: Math.round((after.JSHeapUsedSize - before.JSHeapUsedSize) / 1048576),
        nodesDelta: after.Nodes - before.Nodes,
        listenersDelta: after.JSEventListeners - before.JSEventListeners,
        domBefore,
        domAfter,
        detachedApprox: Math.max(0, after.Nodes - domAfter - 1),
      };
    });
console.log(
  `heap: ${results.sections.heap.heapBeforeMb} MB -> ${results.sections.heap.heapAfterMb} MB, detached approx ${results.sections.heap.detachedApprox}`,
);

// ---- restore what the run toggled
for (const id of toggled)
  await fetch(`${base}/api/nodes/${id}/keep`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ kept: false }),
  });

const bootP50 = (key) => summarize(results.boot.map((b) => b[key])).p50;
const result = {
  kind: 'ui',
  tier,
  label,
  motion: args['no-motion'] ? 'off' : 'on',
  env: environmentRecord({ chromium: browser.version(), loadAtEnd: os.loadavg()[0] }),
  fixture,
  brands: { big, small },
  server: server ? { bootMs: server.bootMs, port: server.port } : { url: base },
  ...results,
};
const b0 = results.boot;
const s = results.sections;
const row = (name, p50, p95, extra = '') => `| ${name} | ${ms(p50)} | ${ms(p95)} | ${extra} |`;
const md = [
  `# perf:ui ${tier} ${label} (${result.env.sha}${result.env.dirty ? ' dirty' : ''}, motion ${result.motion})`,
  '',
  `big brand ${big.slug} (${big.count} shots), small brand ${small.slug} (${small.count})`,
  '',
  '| metric | p50 ms | p95 ms | notes |',
  '|---|---|---|---|',
  row(
    'boot to first feed paint',
    bootP50('firstFeedPaint'),
    summarize(b0.map((b) => b.firstFeedPaint)).p95,
    `fcp ${ms(bootP50('fcp'))}, lcp ${ms(bootP50('lcp'))}, ${bootP50('cells')} cells mounted (${bootP50('visibleCells')} visible), ${bootP50('domNodes')} DOM nodes, ${bootP50('imagesComplete')}/${bootP50('images')} images loaded (${kb(summarize(b0.map((b) => b.bytes.image)).p50)}), list ${b0[0]?.list?.map((l) => `${l.name} ${ms(l.ms)} ms ${kb(l.bytes)}`).join('; ')}`,
  ),
  `| scroll ${SCREENS} screens | | | ${s.scroll.longTasks.count} long tasks (${s.scroll.longTasks.totalMs} ms, max ${s.scroll.longTasks.max}), ${s.scroll.frames.over33}/${s.scroll.frames.n} frames over 33 ms (${s.scroll.frames.share}%), worst ${s.scroll.frames.worst} ms, images ${kb(s.scroll.bytes.image)} (${kb(s.scroll.bytes.image / SCREENS)} per screen), ${s.scroll.cellsAtEnd} cells at end, layouts ${s.scroll.metrics.LayoutCount}, style ${ms(s.scroll.metrics.RecalcStyleDuration * 1000)} ms |`,
  `| hover 20 tiles x3 | | | ${s.hover.frames.over33}/${s.hover.frames.n} frames over 33 ms, ${s.hover.longTasks.count} long tasks, style ${ms(s.hover.metrics.RecalcStyleDuration * 1000)} ms, layout ${ms(s.hover.metrics.LayoutDuration * 1000)} ms |`,
  row(
    'keeper click to star',
    s.keeper.ms?.p50,
    s.keeper.ms?.p95,
    `api ${kb(s.keeper.apiBytesPerToggle?.p50)} per toggle${s.keeper.timeout ? ', TIMEOUT' : ''}`,
  ),
  row('open shot: overlay', s.open.overlay?.p50, s.open.overlay?.p95, ''),
  row('open shot: stage image', s.open.stage?.p50, s.open.stage?.p95, `${kb(s.open.imageBytesPerOpen?.p50)} per open`),
  row('close shot', s.open.close?.p50, s.open.close?.p95, ''),
  row('brand switch: home', s.brandSwitch.home?.p50, s.brandSwitch.home?.p95, ''),
  row(
    'brand switch: feed',
    s.brandSwitch.feed?.p50,
    s.brandSwitch.feed?.p95,
    `api ${kb(s.brandSwitch.apiBytesPerSwitch?.p50)} per switch`,
  ),
  row('search keystroke', s.search.perKey?.p50, s.search.perKey?.p95, `counts ${s.search.countsAfter}`),
  row('lens switch', s.lens.ms?.p50, s.lens.ms?.p95, ''),
  row('sort switch', s.sort.ms?.p50, s.sort.ms?.p95, ''),
  row('assets rail open', s.rail.ms?.p50, s.rail.ms?.p95, `images ${kb(s.rail.bytes.image)}`),
  `| heap after browsing loop | | | ${s.heap.heapBeforeMb} MB to ${s.heap.heapAfterMb} MB (${s.heap.heapDeltaMb >= 0 ? '+' : ''}${s.heap.heapDeltaMb} MB), DOM ${s.heap.domBefore} to ${s.heap.domAfter}, detached approx ${s.heap.detachedApprox}, listeners ${s.heap.listenersDelta >= 0 ? '+' : ''}${s.heap.listenersDelta} |`,
  '',
].join('\n');
const paths = writeResult(result, md);
console.log(md);
console.log(`written ${paths.jsonPath}`);
await browser.close();
if (server) await server.stop();
