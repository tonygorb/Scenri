import { test, expect } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * One scenri, one library, one spec file.
 *
 * The suite used to share a single home for all 172 tests, and nothing ever
 * reset it: `create-product.spec.ts` left three products behind per run,
 * `routing.spec.ts` eight sets, `brand.spec.ts` overwrote the seeded palette,
 * and `notifications.spec.ts` five shots. Specs passed alone and failed in the
 * serial run, because `.first()`, node ordering and the workspace fetch all
 * drift as that library grows. Locally it was worse: the home was a stable
 * `tmpdir()/scenri-e2e`, so the drift carried across runs, forever.
 *
 * So each spec file gets an empty home and a server of its own, seeded from
 * scratch — the same shape every unit suite already uses (`mkdtempSync` +
 * `createCore(home)` + `rmSync`), and the one `updates.spec.ts` already runs
 * here. The server is a real scenri from source, because the behaviour under
 * test is a real browser's.
 *
 * Costs a process start per file. Buys a fixture that is the same on the first
 * spec and the last, on your machine and on CI.
 */

const ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const PORT = Number(process.env.SCENRI_E2E_PORT ?? 4757);
const BASE = `http://127.0.0.1:${PORT}`;

const BRAND_NAME = 'E2E Fixture';

const FIXTURE = {
  specVersion: '0.1',
  meta: { name: BRAND_NAME },
  // Two specs assert on the chip's own label, which is the product name
  // verbatim, and anchor on it ending in "can" — composer.spec.ts:223 and
  // :264. Renaming this product breaks them.
  products: [{ id: 'cold-brew-can', name: 'Cold brew can' }],
  characters: [{ id: 'marco', name: 'Marco' }],
  palette: {
    primary: { hex: '#D96C3B', name: 'Terracotta' },
    secondary: { hex: '#1F2933', name: 'Ink' },
  },
};

/**
 * A scene the brand owns.
 *
 * Ownership decides whether the Scenes library leads with its first-run offer:
 * `customScenesOf(brand).length > 0`. It no longer decides whether the tab rail
 * renders — that is gated on the catalog the rail filters, so a cold brand has
 * one too (see e2e/library-cold.spec.ts, which asks for the cold half).
 *
 * No picture: `previewUrl` is allowed to be null, and a card with nothing to
 * show is a state the app already handles.
 */
const OWNED_SCENE = {
  id: 'us-e2efixture',
  name: 'Fixture studio',
  promptName: 'Fixture Studio',
  lighting: 'Even soft north light',
  description: 'A plain seamless studio the fixture owns.',
  subject: 'either',
  collections: ['Studio'],
  verticals: ['Beverage'],
  prompt: 'A plain seamless studio sweep under even soft north light.',
  width: 1024,
  height: 1280,
};

type SeedOptions = {
  /** Seed a scene the brand owns, so the Scenes library renders warm (no first-run offer). */
  scene?: boolean;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * One request, one read of the body.
 *
 * `node:fetch` bodies are single-use, unlike playwright's request context, so
 * a failure has to carry the text it already read rather than reach for it a
 * second time.
 */
async function call<T>(method: string, path: string, expected: number, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  });
  const text = await res.text();
  expect(res.status, `${method} ${path} → ${res.status}: ${text}`).toBe(expected);
  return JSON.parse(text) as T;
}

/**
 * Whoever is answering on the port, and which library they are serving.
 * `null` when nobody is. `/api/version` carries the home, so readiness and
 * identity are the same one request.
 */
async function version(): Promise<{ home?: string } | null> {
  try {
    const res = await fetch(`${BASE}/api/version`);
    if (!res.ok) {
      await res.body?.cancel();
      return null;
    }
    return (await res.json()) as { home?: string };
  } catch {
    return null;
  }
}

/** The CLI serves prebuilt output and never builds. Say so once, not 172 times. */
function requireStudioBuild(): void {
  if (existsSync(join(ROOT, 'apps', 'studio', 'dist', 'index.html'))) return;
  throw new Error('apps/studio/dist is missing — run `pnpm build` before the e2e suite.');
}

class ScenriFixture {
  private child: ChildProcess | null = null;
  home: string | null = null;

  async start(): Promise<void> {
    requireStudioBuild();
    this.home = mkdtempSync(join(tmpdir(), 'sc-e2e-'));
    // node directly, not `pnpm exec tsx`. Through pnpm the server is a
    // grandchild, and a SIGTERM to pnpm does not always reach it: the server
    // outlives its own teardown, keeps the port, and the next file's start()
    // is handed the *previous* file's library. One process, one signal.
    this.child = spawn(process.execPath, ['--import', 'tsx', 'packages/cli/src/index.ts', 'serve'], {
      cwd: ROOT,
      stdio: 'ignore',
      env: {
        ...process.env,
        SCENRI_NO_OPEN: '1',
        // keep e2e on loopback so health checks do not need a LAN access token
        SCENRI_HOST: '127.0.0.1',
        SCENRI_PORT: String(PORT),
        SCENRI_HOME: this.home,
        // The seed needs one finished shot. The demo engine draws a placeholder
        // and costs nothing, and it is registered only because this says so.
        SCENRI_DEMO_ENGINE: '1',
        // These servers must never reach the real npm registry.
        // updates.spec.ts spawns its own against a fixture registry.
        SCENRI_NO_UPDATE_CHECK: '1',
      },
    });

    let serving: string | undefined;
    for (let i = 0; i < 150 && serving === undefined; i++) {
      if (this.child.exitCode !== null) throw new Error(`scenri exited with ${this.child.exitCode} before answering`);
      serving = (await version())?.home;
      if (serving === undefined) await sleep(200);
    }
    if (serving === undefined) throw new Error(`scenri never answered on ${BASE}`);

    // Prove it is *our* scenri. A port already held by another scenri is not an
    // error to `serve` — it hands you the running one and exits 0 (serve.ts) —
    // so without this a leftover process would quietly serve the previous
    // file's library and the isolation would be a comment rather than a fact.
    if (serving !== this.home) {
      throw new Error(`${BASE} is serving ${serving}, not ${this.home} — a stale scenri still holds the port`);
    }
  }

  async seed(opts: SeedOptions): Promise<void> {
    const brand = opts.scene ? { ...FIXTURE, scenes: [OWNED_SCENE] } : FIXTURE;

    const made = await call<{ id: string }>('POST', '/api/brands', 200, { brand });

    // the brand's one workspace, made by asking for it rather than by inventing
    // a project — nothing in the app creates containers any more
    const ws = await call<{ project: { id: string } }>('GET', `/api/brands/${made.id}/workspace`, 200);

    // One finished shot, so the feed has a cell and the plus menu has a "recent
    // shot" to attach.
    const started = await call<{ id: string }>('POST', '/api/nodes', 202, {
      projectId: ws.project.id,
      kind: 'generation',
      engineId: 'demo',
      count: 1,
      prompt: 'a reference shot',
      width: 512,
      height: 512,
    });

    // the API answers 202 and works in the background: poll to a terminal status
    let node = { status: 'running', images: [] as string[] };
    for (let i = 0; i < 60 && node.status === 'running'; i++) {
      node = await call<typeof node>('GET', `/api/nodes/${started.id}`, 200);
      if (node.status === 'running') await sleep(250);
    }
    expect(node.status, 'the seeded demo shot never finished').toBe('done');
    expect(node.images.length).toBeGreaterThan(0);
  }

  /**
   * Every spec file's server takes the same port, so leaving before this one
   * has actually let go of it hands the next file a race it cannot win. Wait
   * for the exit, then wait for the port to stop answering, and only then take
   * the library away from underneath it.
   */
  async stop(): Promise<void> {
    const child = this.child;
    this.child = null;
    if (child && child.exitCode === null) {
      child.kill('SIGTERM');
      await new Promise<void>((resolve) => {
        child.once('exit', () => resolve());
        setTimeout(() => {
          child.kill('SIGKILL');
          resolve();
        }, 8000).unref();
      });
    }
    for (let i = 0; i < 50 && (await version()) !== null; i++) await sleep(100);
    if (this.home) rmSync(this.home, { recursive: true, force: true });
    this.home = null;
  }
}

/**
 * Give this spec file a scenri of its own. One call, at the top of the file.
 *
 * Boot and seed together are well past the 20s a test gets, so the hook asks
 * for its own budget.
 */
export function isolate(opts: SeedOptions = {}): void {
  const fx = new ScenriFixture();

  test.beforeAll(async () => {
    test.setTimeout(120_000);
    await fx.start();
    await fx.seed(opts);
  });

  test.afterAll(async () => {
    test.setTimeout(30_000);
    await fx.stop();
  });
}
