import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createCodexEngine } from '../src/index.js';
import { createRunner } from '../src/run.js';

/**
 * The adapter against a real child process, on the real host platform, with no
 * injected spawnImpl. On the Windows CI runner this is the machine the tester
 * has: a `codex.cmd` shim on PATH, resolution through where.exe, the cmd.exe
 * shell line, and taskkill doing the killing. On POSIX it is the plain argv
 * path. Every mode of the fixture is one honest end-to-end verdict.
 */

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'fake-codex');

const savedEnv: Record<string, string | undefined> = {};
const scratch: string[] = [];

function useFakeCodex(mode: string, extra: Record<string, string> = {}): void {
  for (const [k, v] of Object.entries({
    PATH: FIXTURE + delimiter + process.env.PATH,
    FAKE_CODEX_MODE: mode,
    ...extra,
  })) {
    if (!(k in savedEnv)) savedEnv[k] = process.env[k];
    process.env[k] = v;
  }
}

function scratchDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'scenri-fake-codex-'));
  scratch.push(dir);
  return dir;
}

async function waitFor(cond: () => boolean, ms: number): Promise<boolean> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (cond()) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return cond();
}

function processGone(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return false;
  } catch {
    return true;
  }
}

beforeAll(() => {
  if (process.platform !== 'win32') chmodSync(join(FIXTURE, 'codex'), 0o755);
});

afterEach(() => {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
    delete savedEnv[k];
  }
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('real spawn: probe verdicts', () => {
  it('reports ready on a healthy fake codex', async () => {
    useFakeCodex('ok');
    const runner = createRunner({ probeTtlMs: 0 });
    await expect(runner.probe()).resolves.toEqual({ ok: true });
  });

  it('reports not-authenticated when login status exits 1', async () => {
    useFakeCodex('logged-out');
    const runner = createRunner({ probeTtlMs: 0 });
    await expect(runner.probe()).resolves.toMatchObject({ ok: false, code: 'not-authenticated' });
  });

  it('reports update-needed on an old version', async () => {
    useFakeCodex('old-version');
    const runner = createRunner({ probeTtlMs: 0 });
    const avail = await runner.probe();
    expect(avail).toMatchObject({ ok: false, code: 'update-needed' });
    expect(avail.reason).toContain('0.140.0');
  });

  it('reports unverified on a hung codex and leaves no process behind', async () => {
    const pidFile = join(scratchDir(), 'pid');
    useFakeCodex('hang', { FAKE_CODEX_PID_FILE: pidFile });
    const runner = createRunner({ probeTtlMs: 0, probeTimeoutMs: 1_000 });
    const avail = await runner.probe();
    expect(avail).toMatchObject({ ok: false, code: 'unverified' });
    expect(existsSync(pidFile)).toBe(true);
    const pid = Number(readFileSync(pidFile, 'utf8'));
    expect(await waitFor(() => processGone(pid), 8_000)).toBe(true);
  }, 20_000);
});

describe('real spawn: generation lifecycle', () => {
  const brand = { brand: {}, assetPaths: {} };

  it('generates through a real child and ingests the image it wrote', async () => {
    useFakeCodex('ok');
    const saved: Buffer[] = [];
    const engine = createCodexEngine({
      probeTtlMs: 0,
      saveImage: (buf) => {
        saved.push(buf);
        return `hash-${saved.length}`;
      },
    });
    const res = await engine.generate({ prompt: 'a red apple', brand, width: 640, height: 480, count: 1 });
    expect(res.images).toEqual(['hash-1']);
    expect(saved[0].toString()).toContain('a red apple');
  }, 20_000);

  it('a failing run reports the error, not the banner in front of it', async () => {
    // The tester's exact failure, through a real child: codex writes its
    // session banner to stderr, then the line that says why, then exits 1.
    // The old head-of-stderr snippet stopped inside the banner, so the shot
    // was reported as "workdir: ... model: gpt-5.6-sol" and nothing else.
    useFakeCodex('exec-banner-then-error');
    const engine = createCodexEngine({ probeTtlMs: 0, saveImage: () => 'unused' });
    await expect(engine.generate({ prompt: 'a red apple', brand, width: 640, height: 480, count: 1 })).rejects.toThrow(
      /code-mode host exited during handshake/,
    );
    await expect(
      engine.generate({ prompt: 'a red apple', brand, width: 640, height: 480, count: 1 }),
    ).rejects.not.toThrow(/workdir:/);
  }, 20_000);

  it('a healthy run that goes quiet after announcing still finishes', async () => {
    // The user-hitting shape, scaled down: one line at launch, then a silent
    // image_gen round-trip three times the first-output window, then the file.
    // The old rolling silence watchdog killed exactly this run.
    useFakeCodex('exec-announce-then-silent', { FAKE_CODEX_SILENT_MS: '1200' });
    const saved: Buffer[] = [];
    const engine = createCodexEngine({
      probeTtlMs: 0,
      firstOutputMs: 400,
      saveImage: (buf) => {
        saved.push(buf);
        return `hash-${saved.length}`;
      },
    });
    const res = await engine.generate({ prompt: 'quiet but healthy', brand, width: 640, height: 480, count: 1 });
    expect(res.images).toEqual(['hash-1']);
  }, 20_000);

  it('a run that wedges after its banner hits the hard cap, and dies for real', async () => {
    const pidFile = join(scratchDir(), 'pid');
    useFakeCodex('exec-banner-then-hang', { FAKE_CODEX_PID_FILE: pidFile });
    const engine = createCodexEngine({
      probeTtlMs: 0,
      firstOutputMs: 60_000,
      timeoutMs: 1_500,
      saveImage: () => 'unused',
    });
    await expect(engine.generate({ prompt: 'wedged', brand, width: 640, height: 480, count: 1 })).rejects.toThrow(
      /timed out after 1500ms/,
    );
    const pid = Number(readFileSync(pidFile, 'utf8'));
    expect(await waitFor(() => processGone(pid), 8_000)).toBe(true);
  }, 30_000);

  it.skipIf(process.platform === 'win32')(
    'a timeout kill takes codex descendants down too',
    async () => {
      // POSIX group kill: the detached exec is a process-group leader, so its
      // own children die with it. taskkill /T owns this on Windows.
      const pidFile = join(scratchDir(), 'pid');
      const childPidFile = join(scratchDir(), 'child-pid');
      useFakeCodex('spawn-grandchild', { FAKE_CODEX_PID_FILE: pidFile, FAKE_CODEX_CHILD_PID_FILE: childPidFile });
      const engine = createCodexEngine({ probeTtlMs: 0, timeoutMs: 1_500, saveImage: () => 'unused' });
      await expect(engine.generate({ prompt: 'tree', brand, width: 640, height: 480, count: 1 })).rejects.toThrow(
        /timed out/,
      );
      const pid = Number(readFileSync(pidFile, 'utf8'));
      const kid = Number(readFileSync(childPidFile, 'utf8'));
      expect(await waitFor(() => processGone(pid) && processGone(kid), 8_000)).toBe(true);
    },
    30_000,
  );

  it('cancelling a running generation really kills the codex process', async () => {
    const pidFile = join(scratchDir(), 'pid');
    useFakeCodex('exec-hang', { FAKE_CODEX_PID_FILE: pidFile });
    const engine = createCodexEngine({ probeTtlMs: 0, saveImage: () => 'unused' });
    const ctrl = new AbortController();
    const p = engine.generate({ prompt: 'never finishes', brand, width: 640, height: 480, count: 1 }, ctrl.signal);
    expect(await waitFor(() => existsSync(pidFile), 10_000)).toBe(true);
    const pid = Number(readFileSync(pidFile, 'utf8'));
    ctrl.abort();
    await expect(p).rejects.toThrow(/aborted/);
    expect(await waitFor(() => processGone(pid), 8_000)).toBe(true);
  }, 30_000);
});
