/**
 * Shared plumbing for driving the user's local `codex` binary.
 *
 * Both things this package does — generating images and analysing references
 * into structured data — are the same three moves: make a temp workspace, run
 * one `codex exec` inside it, read the file codex left behind. The transcript
 * on stdout is never the answer; the file is.
 */
import { spawn as nodeSpawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const NOT_AVAILABLE_REASON = 'Codex CLI not found or not signed in (run: codex login)';
export const DEFAULT_TIMEOUT_MS = 300_000;

/** How hard codex thinks before it acts. Imagegen wants speed; reading a face wants care. */
export type ReasoningEffort = 'low' | 'high';

export interface RunnerOptions {
  spawnImpl?: typeof nodeSpawn;
  timeoutMs?: number;
}

export interface CodexRunner {
  run(args: string[], signal?: AbortSignal): Promise<void>;
  withWorkDir<T>(fn: (dir: string) => Promise<T>): Promise<T>;
  probe(): Promise<{ ok: boolean; reason?: string }>;
}

/** Shared exec args. The prompt is always the positional tail. */
export function execArgs(dir: string, promptText: string, effort: ReasoningEffort = 'low'): string[] {
  return [
    'exec',
    '--skip-git-repo-check',
    '--sandbox',
    'workspace-write',
    '-c',
    `model_reasoning_effort="${effort}"`,
    '-C',
    dir,
    promptText,
  ];
}

export function createRunner(opts: RunnerOptions = {}): CodexRunner {
  const spawnImpl = opts.spawnImpl ?? nodeSpawn;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  /** Run `codex <args>`, resolving on exit 0; kill + reject after timeoutMs. */
  function run(args: string[], signal?: AbortSignal): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let child: ReturnType<typeof nodeSpawn>;
      try {
        child = spawnImpl('codex', args, { stdio: ['ignore', 'pipe', 'pipe'] });
      } catch (err) {
        reject(new Error(`Failed to spawn codex: ${(err as Error).message}`));
        return;
      }

      let settled = false;
      let stderr = '';
      // codex streams its full transcript to stdout; it MUST be drained or the
      // 64KB pipe buffer fills and codex blocks forever (real hang, 2026-08-01).
      child.stdout?.on('data', () => {});
      child.stderr?.on('data', (d: Buffer | string) => {
        stderr += String(d);
      });

      const timer = setTimeout(() => {
        child.kill();
        finish(() => reject(new Error(`Codex CLI timed out after ${timeoutMs}ms`)));
      }, timeoutMs);

      const onAbort = () => {
        child.kill();
        finish(() => reject(new Error('Codex CLI run aborted')));
      };

      function finish(fn: () => void): void {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        fn();
      }

      if (signal) {
        if (signal.aborted) {
          onAbort();
          return;
        }
        signal.addEventListener('abort', onAbort, { once: true });
      }

      child.on('error', (err: Error) => {
        finish(() => reject(new Error(`Failed to spawn codex: ${err.message}`)));
      });
      child.on('exit', (code: number | null) => {
        if (code === 0) {
          finish(resolve);
        } else {
          const snippet = stderr.trim().slice(0, 200);
          finish(() =>
            reject(new Error(`codex exited with code ${code ?? 'unknown'}${snippet ? `: ${snippet}` : ''}`)),
          );
        }
      });
    });
  }

  async function withWorkDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
    const dir = await mkdtemp(join(tmpdir(), 'scenri-codex-'));
    try {
      return await fn(dir);
    } finally {
      // Best-effort cleanup.
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  }

  /** `codex --version`. Never rejects: an absent binary is an answer, not a fault. */
  function probe(): Promise<{ ok: boolean; reason?: string }> {
    return new Promise((resolve) => {
      let settled = false;
      const done = (r: { ok: boolean; reason?: string }) => {
        if (!settled) {
          settled = true;
          resolve(r);
        }
      };
      let child: ReturnType<typeof nodeSpawn>;
      try {
        child = spawnImpl('codex', ['--version']);
      } catch {
        done({ ok: false, reason: NOT_AVAILABLE_REASON });
        return;
      }
      child.on('error', () => done({ ok: false, reason: NOT_AVAILABLE_REASON }));
      child.on('exit', (code: number | null) => {
        done(code === 0 ? { ok: true } : { ok: false, reason: NOT_AVAILABLE_REASON });
      });
    });
  }

  return { run, withWorkDir, probe };
}
