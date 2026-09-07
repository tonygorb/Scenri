/**
 * The default browser, from a process that may have no console. Every helper
 * is judged by how it exits, never assumed to have worked because it started:
 * a click that ends in silence is the one outcome this file exists to prevent.
 *
 * macOS and Linux go through the `open` package like serve does. Windows does
 * not: the package runs an unhidden PowerShell, which flashes a window from a
 * hidden parent, so the same Start-Process call is made here with the window
 * hidden and the URL in the environment rather than in an encoded command.
 * PowerShell is the only helper whose exit code means anything; rundll32's
 * FileProtocolHandler and explorer.exe come after it because they are the two
 * launchers Windows itself cannot be without.
 */
import { spawn as nodeSpawn, type SpawnOptions } from 'node:child_process';
import { win32 } from 'node:path';
import type { Readable } from 'node:stream';
import { powershellPath } from './paths.js';
import { POWERSHELL_ARGS } from './windows.js';

export interface OpenerChild {
  stderr: Readable | null;
  kill(): boolean;
  ref?(): void;
  once(event: 'close', listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown;
  once(event: 'error', listener: (err: Error) => void): unknown;
}
export type OpenerSpawn = (cmd: string, args: string[], opts: SpawnOptions) => OpenerChild;

export interface OpenerImpl {
  spawn?: OpenerSpawn;
  /** The `open` package, or a stand-in: resolves to the opener child. */
  open?: (url: string) => Promise<OpenerChild>;
  timeoutMs?: number;
}

/** A helper that has not answered in this long is not going to. */
const HELPER_TIMEOUT_MS = 10_000;

interface Helper {
  cmd: string;
  args: string[];
  env?: NodeJS.ProcessEnv;
  /** Whether this exit means the job was done. */
  ok: (code: number | null) => boolean;
}

export async function openInBrowser(
  url: string,
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
  impl: OpenerImpl = {},
): Promise<void> {
  const timeoutMs = impl.timeoutMs ?? HELPER_TIMEOUT_MS;
  if (platform === 'win32') {
    const spawnImpl = impl.spawn ?? (nodeSpawn as unknown as OpenerSpawn);
    const root = env.SystemRoot || env.SYSTEMROOT || env.windir || 'C:\\Windows';
    const helpers: Helper[] = [
      {
        cmd: powershellPath(env),
        args: [...POWERSHELL_ARGS, 'Start-Process $env:SCENRI_URL'],
        env: { ...env, SCENRI_URL: url },
        ok: (code) => code === 0,
      },
      {
        cmd: win32.join(root, 'System32', 'rundll32.exe'),
        args: ['url.dll,FileProtocolHandler', url],
        ok: (c) => c === 0,
      },
      // explorer.exe answers 1 even when it did the job; only a failure to start counts.
      { cmd: win32.join(root, 'explorer.exe'), args: [url], ok: (code) => code !== null },
    ];
    const reasons: string[] = [];
    for (const helper of helpers) {
      const result = await runHelper(spawnImpl, helper, env, timeoutMs);
      if (result.ok) return;
      reasons.push(`${win32.basename(helper.cmd)}: ${result.reason}`);
    }
    throw new Error(`no helper could open the browser (${reasons.join('; ')})`);
  }
  const openImpl =
    impl.open ?? (async (u: string) => (await (await import('open')).default(u)) as unknown as OpenerChild);
  const child = await openImpl(url);
  // The open package unrefs its child; holding it keeps this process alive
  // for the few milliseconds open(1) or xdg-open takes to answer.
  child.ref?.();
  await new Promise<void>((resolve, reject) => {
    let done = false;
    const finish = (err?: Error) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      err ? reject(err) : resolve();
    };
    const timer = setTimeout(() => finish(), timeoutMs);
    child.once('error', (err) => finish(err));
    child.once('close', (code) =>
      finish(code === 0 || code === null ? undefined : new Error(`the opener exited with ${code}`)),
    );
  });
}

function runHelper(
  spawnImpl: OpenerSpawn,
  helper: Helper,
  env: NodeJS.ProcessEnv,
  timeoutMs: number,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  return new Promise((resolve) => {
    let done = false;
    let stderr = '';
    const finish = (result: { ok: true } | { ok: false; reason: string }) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(result);
    };
    let child: OpenerChild;
    try {
      child = spawnImpl(helper.cmd, helper.args, {
        stdio: ['ignore', 'ignore', 'pipe'],
        windowsHide: true,
        env: helper.env ?? env,
      });
    } catch (err) {
      return finish({ ok: false, reason: err instanceof Error ? err.message : String(err) });
    }
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        /* already gone */
      }
      finish({ ok: false, reason: `no answer within ${Math.round(timeoutMs / 1000)} s` });
    }, timeoutMs);
    child.stderr?.on('data', (d: Buffer | string) => {
      stderr += String(d);
    });
    child.once('error', (err) => finish({ ok: false, reason: err.message }));
    child.once('close', (code) => {
      if (helper.ok(code)) return finish({ ok: true });
      const detail = stderr.trim().split(/\r?\n/)[0];
      finish({ ok: false, reason: `exit ${code}${detail ? `: ${detail}` : ''}` });
    });
  });
}
