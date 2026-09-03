import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../..');

/** Ports the rig must never take: the owner's 4747, the e2e band, the update-loop registries. */
const FORBIDDEN = new Set([4747, ...Array.from({ length: 13 }, (_, i) => 4757 + i), 4791, 4792, 4795, 4796]);

export function requireStudioBuild() {
  if (existsSync(join(ROOT, 'apps', 'studio', 'dist', 'index.html'))) return;
  throw new Error('apps/studio/dist is missing: run `pnpm build` first (the CLI serves the built studio).');
}

export async function pickPort(from = 4798) {
  for (let p = from; p < from + 200; p++) {
    if (FORBIDDEN.has(p)) continue;
    const free = await new Promise((res) => {
      const s = createServer();
      s.once('error', () => res(false));
      s.listen(p, '127.0.0.1', () => s.close(() => res(true)));
    });
    if (free) return p;
  }
  throw new Error('no free port');
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function version(base) {
  try {
    const res = await fetch(`${base}/api/version`);
    if (!res.ok) {
      await res.body?.cancel();
      return null;
    }
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * Boot one Scenri from source against a fixture home, the way e2e/harness.ts
 * does, and wait for it to answer with that exact home. Boot time is measured
 * from spawn to the first 200.
 */
export async function startScenri({ home, port, env = {}, onLine = () => {} }) {
  requireStudioBuild();
  if (FORBIDDEN.has(port)) throw new Error(`port ${port} is reserved`);
  const spawnAt = performance.now();
  const child = spawn(process.execPath, ['--import', 'tsx', 'packages/cli/src/index.ts', 'serve'], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      SCENRI_NO_OPEN: '1',
      SCENRI_HOST: '127.0.0.1',
      SCENRI_PORT: String(port),
      SCENRI_HOME: home,
      SCENRI_DEMO_ENGINE: '1',
      SCENRI_NO_UPDATE_CHECK: '1',
      SCENRI_NO_CONTENT_FETCH: '1',
      SCENRI_NO_CODEX: '1',
      OPENROUTER_API_KEY: '',
      REPLICATE_API_TOKEN: '',
      FAL_KEY: '',
      ...env,
    },
  });
  const log = [];
  const take = (chunk) => {
    for (const line of String(chunk).split('\n')) {
      if (!line.trim()) continue;
      log.push(line);
      onLine(line);
    }
  };
  child.stdout.on('data', take);
  child.stderr.on('data', take);
  const base = `http://127.0.0.1:${port}`;
  let serving;
  for (let i = 0; i < 2400 && serving === undefined; i++) {
    if (child.exitCode !== null) throw new Error(`Scenri exited with ${child.exitCode}\n${log.join('\n')}`);
    serving = (await version(base))?.home;
    if (serving === undefined) await sleep(25);
  }
  const bootMs = performance.now() - spawnAt;
  if (serving === undefined) throw new Error(`Scenri never answered on ${base}`);
  if (serving !== home) throw new Error(`${base} serves ${serving}, not ${home}`);
  return {
    child,
    port,
    base,
    bootMs,
    log,
    async stop() {
      if (child.exitCode === null) {
        child.kill('SIGTERM');
        await new Promise((res) => {
          child.once('exit', () => res());
          setTimeout(() => {
            child.kill('SIGKILL');
            res();
          }, 8000).unref();
        });
      }
      for (let i = 0; i < 50 && (await version(base)) !== null; i++) await sleep(100);
    },
  };
}
