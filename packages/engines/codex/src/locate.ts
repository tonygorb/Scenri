/**
 * Where is codex, really, and which spawn shape does it need?
 *
 * POSIX is easy: `codex` on PATH, argv spawn, done. Windows has two different
 * installs with two different natures. The standalone installer ships a real
 * codex.exe, which Node can spawn argv-style with no shell — quoting stays
 * exact, the pid is codex itself, and a kill lands on the right process. npm
 * ships codex.cmd, a shim only cmd.exe can run (Node refuses since
 * CVE-2024-27980), which forces the quoted shell line in run.ts. where.exe
 * tells us which machine we are on; when it cannot, the shell line is the
 * fallback that has worked since 0.3.5.
 */
import type { spawn as nodeSpawn } from 'node:child_process';

/** Oldest codex the adapter is tested against: exec --json, login status, -i. */
export const MIN_CODEX_VERSION = '0.146.0';

const WHERE_TIMEOUT_MS = 5_000;

export interface ResolvedCodex {
  command: string;
  /** true: spawn argv-style with no shell. false: needs the win32 shell line. */
  direct: boolean;
}

/** `codex --version` prints `codex-cli X.Y.Z`; anything else is not codex. */
export function parseCodexVersion(text: string): string | null {
  const m = /codex-cli\s+(\d+\.\d+\.\d+)/.exec(text);
  return m ? m[1] : null;
}

export function versionAtLeast(version: string, floor: string): boolean {
  const a = version.split('.').map(Number);
  const b = floor.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  }
  return true;
}

export function resolveCodex(
  platform: NodeJS.Platform,
  spawnImpl: typeof nodeSpawn,
  timeoutMs = WHERE_TIMEOUT_MS,
): Promise<ResolvedCodex> {
  if (platform !== 'win32') return Promise.resolve({ command: 'codex', direct: true });

  const fallback: ResolvedCodex = { command: 'codex', direct: false };
  return new Promise((resolve) => {
    let settled = false;
    const done = (r: ResolvedCodex) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(r);
    };
    let child: ReturnType<typeof nodeSpawn>;
    const timer = setTimeout(() => {
      done(fallback);
      child?.kill();
    }, timeoutMs);
    try {
      // where.exe is a real System32 executable: argv spawn, no shell needed.
      child = spawnImpl('where.exe', ['codex'], { stdio: ['ignore', 'pipe', 'ignore'] });
    } catch {
      done(fallback);
      return;
    }
    let stdout = '';
    child.stdout?.on('data', (d: Buffer | string) => {
      stdout += String(d);
    });
    child.on('error', () => done(fallback));
    child.on('exit', (code: number | null) => {
      if (code !== 0) {
        done(fallback);
        return;
      }
      const hits = stdout
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean);
      const exe = hits.find((h) => h.toLowerCase().endsWith('.exe'));
      done(exe ? { command: exe, direct: true } : fallback);
    });
  });
}
