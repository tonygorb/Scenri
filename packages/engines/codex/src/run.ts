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
import type { EngineAvailability } from '@scenri/core';

export const NOT_INSTALLED_REASON = 'Codex CLI is not installed on this computer';
export const NOT_AUTHENTICATED_REASON = 'Codex CLI is installed but not signed in';
/** @deprecated kept so older callers still compile; prefer the two specific reasons. */
export const NOT_AVAILABLE_REASON = 'Codex CLI not found or not signed in (run: codex login)';
export const DEFAULT_TIMEOUT_MS = 300_000;

/** How hard codex thinks before it acts. Imagegen wants speed; reading a face wants care. */
export type ReasoningEffort = 'low' | 'high';

export interface RunnerOptions {
  spawnImpl?: typeof nodeSpawn;
  timeoutMs?: number;
  /** Tests pin this so the spawn contract does not fork with the CI host OS. */
  platform?: NodeJS.Platform;
}

export interface CodexRunner {
  run(args: string[], signal?: AbortSignal): Promise<void>;
  withWorkDir<T>(fn: (dir: string) => Promise<T>): Promise<T>;
  probe(): Promise<EngineAvailability>;
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
  const platform = opts.platform ?? process.platform;

  // codex is codex.cmd on Windows, and a .cmd only runs through a shell
  // (CVE-2024-27980 made Node refuse it otherwise). The prompt rides in these
  // arguments and can quote imported library text, so the line has to be
  // injection-safe: cmd.exe cannot be defused for an embedded quote (any
  // backslash game still toggles cmd's own quoting) or for % (expands even
  // inside quotes), and newlines split the line. All three are prose-safe
  // substitutions in an image prompt, so they are substituted, then every
  // argument is quoted, which makes & | < > ^ literal to cmd.
  const winArg = (a: string) => `"${a.replace(/[\r\n]+/g, ' ').replace(/"/g, "'").replace(/%/g, ' percent ')}"`;
  const spawnCodex = (args: string[]) =>
    platform === 'win32'
      ? spawnImpl(['codex', ...args].map(winArg).join(' '), [], {
          stdio: ['ignore', 'pipe', 'pipe'],
          shell: true,
        })
      : spawnImpl('codex', args, { stdio: ['ignore', 'pipe', 'pipe'] });

  /** Run `codex <args>`, resolving on exit 0; kill + reject after timeoutMs. */
  function run(args: string[], signal?: AbortSignal): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let child: ReturnType<typeof nodeSpawn>;
      try {
        child = spawnCodex(args);
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

  /**
   * Run one short `codex` subcommand and report only whether it exited 0.
   * Never rejects: an absent binary is an answer, not a fault. stdout/stderr
   * are drained for the same reason `run` drains them — a full pipe hangs.
   */
  function exitedZero(args: string[]): Promise<boolean> {
    return new Promise((resolve) => {
      let settled = false;
      const done = (ok: boolean) => {
        if (!settled) {
          settled = true;
          resolve(ok);
        }
      };
      let child: ReturnType<typeof nodeSpawn>;
      try {
        child = spawnCodex(args);
      } catch {
        done(false);
        return;
      }
      child.stdout?.on('data', () => {});
      child.stderr?.on('data', () => {});
      child.on('error', () => done(false));
      child.on('exit', (code: number | null) => done(code === 0));
    });
  }

  /**
   * Two questions, not one: is the binary here, and is there a session behind
   * it. They have different fixes — one is an install, the other is a sign-in —
   * so collapsing them into a single "not available" string left the setup UI
   * guessing which screen to show. Exit codes only; the wording of codex's own
   * output is not a contract we can pin.
   */
  async function probe(): Promise<EngineAvailability> {
    // Test servers set this so the machine's own codex login cannot turn a
    // deterministic run into a real build. Answered before spawning anything.
    if (process.env.SCENRI_NO_CODEX === '1') {
      return { ok: false, reason: NOT_INSTALLED_REASON, code: 'not-installed' };
    }
    if (!(await exitedZero(['--version']))) {
      return { ok: false, reason: NOT_INSTALLED_REASON, code: 'not-installed' };
    }
    if (!(await exitedZero(['login', 'status']))) {
      return { ok: false, reason: NOT_AUTHENTICATED_REASON, code: 'not-authenticated' };
    }
    return { ok: true };
  }

  return { run, withWorkDir, probe };
}
