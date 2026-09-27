/**
 * `pnpm cold-start --measure <label>`: a first run timed from the outside.
 *
 * One headless page at 1440x900 in a fresh browser context (no HTTP cache)
 * reads what a person sees; the helper reads what the machine has (the
 * showcase answer, the files on disk, the activity row); a probe of
 * /api/version every 100 ms stands in for the server's event loop. Times are
 * seconds from the moment Scenri was spawned (T0).
 */
import { execFileSync, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import type { createRequire } from 'node:module';
import { join } from 'node:path';
import { zipEntries } from './zip-entries.mjs';

interface Ctx {
  label: string;
  url: string;
  port: number;
  home: string;
  brandId: string | null;
  bytes: Buffer | null;
  t0: number;
  t1: number;
  child: ChildProcess;
  archive: { stats: { requests: number; ranges: number; whole: number; bytesSent: number; peak: number } } | null;
  killAt: number;
  packageRoot: string;
  results: string;
  studioRequire: ReturnType<typeof createRequire>;
  mode: Record<string, unknown>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const pct = (xs: number[], p: number) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};

export async function measure(ctx: Ctx): Promise<number> {
  const at = (t: number | null) => (t ? Number(((t - ctx.t0) / 1000).toFixed(2)) : null);
  const api = (path: string) => fetch(`http://127.0.0.1:${ctx.port}${path}`);
  mkdirSync(ctx.results, { recursive: true });
  const shots = join(ctx.results, `${ctx.label}-shots`);
  mkdirSync(shots, { recursive: true });

  // What Home needs from the archive, from the installed package's own wall.
  const wallDir = join(ctx.packageRoot, 'templates', 'showcase');
  const bundledDir = join(ctx.packageRoot, 'templates', 'previews', 'showcase');
  const wall = readdirSync(wallDir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(join(wallDir, f), 'utf8')))
    .sort((a, b) => (a.order ?? 1e9) - (b.order ?? 1e9));
  const bundled = new Set(existsSync(bundledDir) ? readdirSync(bundledDir).map((f) => f.replace(/\.jpg$/, '')) : []);
  const names = ctx.bytes ? zipEntries(ctx.bytes).map((e) => e.name) : [];
  const has = new Set(names);
  const homeSet = new Set<string>();
  for (const w of wall) {
    if (!bundled.has(w.id)) homeSet.add(`previews/showcase/${w.id}.jpg`);
    for (const t of w.brief?.tokens ?? []) {
      if (t.t === 'product') {
        const chip = ['three-quarter', 'front']
          .map((a) => `previews/demo-products/${t.id}/${a}.jpg`)
          .find((n) => has.has(n));
        if (chip) homeSet.add(chip);
      }
      if (t.t === 'character' && has.has(`previews/presenters/${t.id}/avatar.jpg`)) {
        homeSet.add(`previews/presenters/${t.id}/avatar.jpg`);
      }
    }
  }
  // where a file can be: the installed cache, the old whole-archive unpack, or a download in progress
  const content = join(ctx.home, 'content');
  const staging = join(ctx.home, 'content.staging');
  const partial = join(ctx.home, 'content.partial');
  const onDisk = (rel: string) =>
    existsSync(join(content, rel)) || existsSync(join(staging, rel)) || existsSync(join(partial, rel));
  const whole = (dir: string) => existsSync(join(dir, 'meta.json')) && names.every((n) => existsSync(join(dir, n)));
  const complete = () => existsSync(join(content, 'meta.json')) || whole(staging) || whole(partial);

  const T: Record<string, number | null> = {
    T1_server: ctx.t1,
    T2_home_visible: null,
    T3_home_metadata: null,
    T4a_first_picture: null,
    T4b_first_archive_picture_listed: null,
    T5_first_viewport_complete: null,
    T6_home_set_on_disk: null,
    T6_wall_listed_complete: null,
    T7_first_file_on_disk: null,
    T8_library_complete: null,
    killed: null,
    welcome_dismissed: null,
    attempt_ended: null,
  };
  const latency: { t: number; ms: number }[] = [];
  const procs: { t: number; rss: number; cpu: number }[] = [];
  const activity: { t: number; content: unknown }[] = [];
  let glyphMax = 0;
  let waitingMax = 0;
  let stop = false;
  let sawArriving = false;

  // the server's responsiveness, all along
  const probe = (async () => {
    while (!stop) {
      const s = Date.now();
      try {
        await (await api('/api/version')).arrayBuffer();
        latency.push({ t: s, ms: Date.now() - s });
      } catch {
        /* down, e.g. killed */
      }
      await sleep(100);
    }
  })();

  // what the machine has
  const machine = (async () => {
    let n = 0;
    while (!stop) {
      n += 1;
      const now = Date.now();
      if (!T.T7_first_file_on_disk && [staging, content, partial].some(existsSync) && names.some(onDisk)) {
        T.T7_first_file_on_disk = now;
      }
      if (!T.T6_home_set_on_disk && homeSet.size && [...homeSet].every(onDisk)) T.T6_home_set_on_disk = now;
      if (!T.T8_library_complete && complete()) T.T8_library_complete = now;
      if (n % 3 === 0) {
        try {
          const list = (await (await api('/api/showcase')).json()).showcase as {
            id: string;
            previewUrl: string | null;
          }[];
          if (!T.T4b_first_archive_picture_listed && list.some((s) => s.previewUrl && !bundled.has(s.id))) {
            T.T4b_first_archive_picture_listed = now;
          }
          if (!T.T6_wall_listed_complete && list.every((s) => s.previewUrl)) T.T6_wall_listed_complete = now;
          if (ctx.brandId) {
            const act = await (await api(`/api/brands/${ctx.brandId}/activity`)).json();
            activity.push({ t: now, content: act.content });
            // an attempt that ends without completing (the old whole-archive path gives up quietly)
            if (act.content?.arriving) sawArriving = true;
            else if (sawArriving && !T.attempt_ended) T.attempt_ended = now;
          }
        } catch {
          /* down */
        }
      }
      if (n % 5 === 0 && process.platform !== 'win32' && ctx.child.pid) {
        try {
          const kids = execFileSync('pgrep', ['-P', String(ctx.child.pid)])
            .toString()
            .trim()
            .split(/\s+/)
            .filter(Boolean);
          const out = execFileSync('ps', ['-o', 'rss=,%cpu=', '-p', [ctx.child.pid, ...kids].join(',')]).toString();
          let rss = 0;
          let cpu = 0;
          for (const line of out.trim().split('\n')) {
            const [r, c] = line.trim().split(/\s+/).map(Number);
            rss += r;
            cpu += c;
          }
          procs.push({ t: now, rss: rss / 1024, cpu });
        } catch {
          /* gone */
        }
      }
      if (ctx.killAt && ctx.archive && ctx.bytes && !T.killed) {
        if (ctx.archive.stats.bytesSent >= (ctx.killAt / 100) * ctx.bytes.length) {
          T.killed = now;
          if (ctx.child.pid) {
            try {
              process.kill(process.platform === 'win32' ? ctx.child.pid : -ctx.child.pid, 'SIGKILL');
            } catch {
              /* gone */
            }
          }
        }
      }
      await sleep(100);
    }
  })();

  // what a person sees
  const { chromium } = ctx.studioRequire('@playwright/test');
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await page.addInitScript(() => {
    const w = window as unknown as { __lt: number[] };
    w.__lt = [];
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) w.__lt.push(e.duration);
    }).observe({ type: 'longtask', buffered: true });
  });
  page.on('response', (r: { url: () => string }) => {
    if (!T.T3_home_metadata && r.url().endsWith('/api/showcase')) T.T3_home_metadata = Date.now();
  });
  await page.goto(ctx.url);
  // A new brand opens on the first-use welcome once engines are known; a
  // person says Not now and looks at Home, so the loop does the same whenever
  // it shows up.
  const notNow = page.getByRole('dialog').getByRole('button', { name: 'Not now', exact: true }).first();
  const shown = Date.now();
  const deadline = Date.now() + 15 * 60 * 1000;
  const shotAt = [0, 2, 5, 10, 20, 40];
  const taken = new Set<number>();
  let doneAt = 0;
  while (Date.now() < deadline) {
    const now = Date.now();
    if (!T.welcome_dismissed && (await notNow.isVisible().catch(() => false))) {
      await notNow.click().catch(() => {});
      T.welcome_dismissed = Date.now();
    }
    const s = await page
      .evaluate(() => {
        const tiles = [...document.querySelectorAll('.sc-showcase-tile')];
        const inView = tiles.filter((el) => {
          const r = el.getBoundingClientRect();
          return r.bottom > 0 && r.top < innerHeight && r.width > 0;
        });
        return {
          tiles: tiles.length,
          inView: inView.length,
          readyInView: inView.filter((el) => el.querySelector('img[data-ready]')).length,
          anyReady: tiles.some((el) => el.querySelector('img[data-ready]')),
          waiting: document.querySelectorAll('.sc-lookcard-blank[data-waiting]').length,
          glyph: document.querySelectorAll('.sc-lookcard-blank:not([data-waiting])').length,
        };
      })
      .catch(() => null);
    if (s) {
      if (!T.T2_home_visible && s.tiles > 0) T.T2_home_visible = now;
      if (!T.T4a_first_picture && s.anyReady) T.T4a_first_picture = now;
      if (!T.T5_first_viewport_complete && s.inView > 0 && s.readyInView === s.inView)
        T.T5_first_viewport_complete = now;
      glyphMax = Math.max(glyphMax, s.glyph);
      waitingMax = Math.max(waitingMax, s.waiting);
    }
    for (const sec of shotAt) {
      if (taken.has(sec) || now - shown < sec * 1000) continue;
      taken.add(sec);
      await page.screenshot({ path: join(shots, `wall-${String(sec).padStart(2, '0')}s.png`) });
      await page.mouse.wheel(0, 900);
      await sleep(300);
      await page.screenshot({ path: join(shots, `wall-below-${String(sec).padStart(2, '0')}s.png`) });
      await page.mouse.wheel(0, -900);
      if (sec === 5) {
        const bell = page.getByRole('button', { name: /^Activity/ });
        if (await bell.count()) {
          await page.screenshot({
            path: join(shots, 'bell-05s.png'),
            clip: { x: 900, y: 0, width: 540, height: 64 },
          });
          await bell.click().catch(() => {});
          await sleep(500);
          await page.screenshot({ path: join(shots, 'activity-05s.png') });
          await page.keyboard.press('Escape');
        }
      }
    }
    if (T.killed) break;
    if (!doneAt && T.T8_library_complete && T.T6_wall_listed_complete) doneAt = now;
    if (!doneAt && T.attempt_ended && !T.T8_library_complete) doneAt = now;
    if (doneAt && now - doneAt > 2000) break;
    await sleep(100);
  }

  // the whole wall, scrolled through once it is all there: any glyph is a picture that never came
  let scrollGlyphs = 0;
  let scrollWaiting = 0;
  let wallDecodedAt: number | null = null;
  if (!T.killed && doneAt) {
    // a screen at a time, each waited on until its tiles have decoded (10 s at most)
    const start = Date.now();
    // Home scrolls inside .sc-home, not the window
    const height = await page.evaluate(
      () => (document.querySelector('.sc-home') ?? document.documentElement).scrollHeight,
    );
    for (let y = 0; y <= height; y += 800) {
      await page.evaluate(
        (top: number) => (document.querySelector('.sc-home') ?? document.documentElement).scrollTo(0, top),
        y,
      );
      for (let i = 0; i < 100; i++) {
        const left = await page.evaluate(
          () =>
            [...document.querySelectorAll('.sc-showcase-tile')].filter((el) => {
              const r = el.getBoundingClientRect();
              return r.bottom > 0 && r.top < innerHeight && !el.querySelector('img[data-ready]');
            }).length,
        );
        if (!left) break;
        await sleep(100);
      }
    }
    wallDecodedAt = Date.now();
    scrollGlyphs = await page.evaluate(
      () => document.querySelectorAll('.sc-lookcard-blank:not([data-waiting])').length,
    );
    scrollWaiting = await page.evaluate(() => document.querySelectorAll('.sc-lookcard-blank[data-waiting]').length);
    await page.screenshot({ path: join(shots, 'wall-bottom-final.png') });
    T.wall_scroll_pass_seconds = (wallDecodedAt - start) / 1000;
  }
  const longTasks = (await page
    .evaluate(() => (window as unknown as { __lt: number[] }).__lt)
    .catch(() => [])) as number[];
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const phonePage = await phone.newPage();
  await phonePage.goto(ctx.url).catch(() => {});
  await sleep(1500);
  await phonePage.screenshot({ path: join(shots, 'phone-final.png') }).catch(() => {});
  await browser.close();
  stop = true;
  await Promise.all([probe, machine]);

  const window_ = latency.filter(
    (l) => l.t >= ctx.t1 && (!T.T8_library_complete || l.t <= (T.T8_library_complete as number)),
  );
  const sha = (() => {
    try {
      const head = execFileSync('git', ['rev-parse', '--short', 'HEAD']).toString().trim();
      const dirty = execFileSync('git', ['status', '--porcelain']).toString().trim() ? '-dirty' : '';
      return head + dirty;
    } catch {
      return 'unknown';
    }
  })();
  const result = {
    label: ctx.label,
    sha,
    at: new Date(ctx.t0).toISOString(),
    mode: ctx.mode,
    seconds: Object.fromEntries(Object.entries(T).map(([k, v]) => [k, k === 'wall_scroll_pass_seconds' ? v : at(v)])),
    homeSet: { files: homeSet.size },
    archive: ctx.archive ? { ...ctx.archive.stats, log: undefined } : null,
    apiLatencyMs: {
      p50: pct(
        window_.map((l) => l.ms),
        50,
      ),
      p95: pct(
        window_.map((l) => l.ms),
        95,
      ),
      max: pct(
        window_.map((l) => l.ms),
        100,
      ),
    },
    serverPeakRssMb: procs.length ? Math.round(Math.max(...procs.map((p) => p.rss))) : null,
    serverMeanCpu: procs.length ? Math.round(procs.reduce((s, p) => s + p.cpu, 0) / procs.length) : null,
    browserLongTasks: { count: longTasks.length, totalMs: Math.round(longTasks.reduce((s, d) => s + d, 0)) },
    glyphMaxDuringRun: glyphMax,
    waitingMaxDuringRun: waitingMax,
    afterScroll: { glyphs: scrollGlyphs, waiting: scrollWaiting },
    activity,
  };
  const file = join(ctx.results, `${ctx.label}.json`);
  writeFileSync(file, `${JSON.stringify(result, null, 2)}\n`);
  console.log(`\ncold-start: measured "${ctx.label}" -> ${file}`);
  for (const [k, v] of Object.entries(result.seconds)) console.log(`  ${k.padEnd(34)} ${v ?? '-'}`);
  console.log(
    `  api latency p50/p95/max ms          ${result.apiLatencyMs.p50}/${result.apiLatencyMs.p95}/${result.apiLatencyMs.max}`,
  );
  console.log(`  server peak RSS MB / mean CPU %     ${result.serverPeakRssMb} / ${result.serverMeanCpu}`);
  console.log(
    `  browser long tasks                  ${result.browserLongTasks.count} (${result.browserLongTasks.totalMs} ms)`,
  );
  console.log(`  glyphs seen / after scroll          ${glyphMax} / ${scrollGlyphs}`);
  if (result.archive) {
    const a = result.archive;
    console.log(`  archive requests/ranges/bytes/peak  ${a.requests}/${a.ranges}/${a.bytesSent}/${a.peak}`);
  }
  return 0;
}
