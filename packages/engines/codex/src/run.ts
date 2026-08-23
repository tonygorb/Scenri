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
import { MIN_CODEX_VERSION, parseCodexVersion, resolveCodex, versionAtLeast, type ResolvedCodex } from './locate.js';

export const NOT_INSTALLED_REASON = 'Codex CLI is not installed on this computer';
export const NOT_AUTHENTICATED_REASON = 'Codex CLI is installed but not signed in';
export const UNVERIFIED_REASON = 'Could not verify Codex on this computer';
/** @deprecated kept so older callers still compile; prefer the two specific reasons. */
export const NOT_AVAILABLE_REASON = 'Codex CLI not found or not signed in (run: codex login)';
export const DEFAULT_TIMEOUT_MS = 300_000;
/** A probe answer is either quick or worthless: past this it is "could not verify". */
export const PROBE_TIMEOUT_MS = 10_000;
/**
 * How long a run may produce nothing on either pipe before it counts as dead.
 * codex streams its transcript continuously while working; total silence this
 * long is a hang (observed upstream on Windows), not thinking.
 */
export const NO_ACTIVITY_TIMEOUT_MS = 120_000;

/** How hard codex thinks before it acts. Imagegen wants speed; reading a face wants care. */
export type ReasoningEffort = 'low' | 'high';

/** How long one probe answer stays true. Short: a sign-in can happen any time. */
export const PROBE_TTL_MS = 30_000;

export interface RunnerOptions {
  spawnImpl?: typeof nodeSpawn;
  timeoutMs?: number;
  /** Tests pin this so the probe verdicts do not take ten real seconds. */
  probeTimeoutMs?: number;
  /** Probe cache lifetime; 0 disables the cache. Tests pass 0. */
  probeTtlMs?: number;
  /** The silence window before a run counts as hung. Tests shrink it. */
  noActivityMs?: number;
  /** Tests pin this so the spawn contract does not fork with the CI host OS. */
  platform?: NodeJS.Platform;
}

export interface CodexRunner {
  run(args: string[], signal?: AbortSignal, opts?: { stdin?: string }): Promise<void>;
  withWorkDir<T>(fn: (dir: string) => Promise<T>): Promise<T>;
  probe(): Promise<EngineAvailability>;
  /** Forget the cached probe answer: something (install, login, failure) changed the world. */
  invalidateProbe(): void;
}

/**
 * Shared exec args. The positional tail is `-`, codex's own marker for "read
 * the prompt from stdin": as an argv tail the prompt hit cmd.exe's 8191-char
 * line limit and the win32 quoting substitutions; stdin carries exact bytes on
 * every platform. --color never keeps the transcript free of ANSI codes.
 */
export function execArgs(dir: string, effort: ReasoningEffort = 'low'): string[] {
  return [
    'exec',
    '--skip-git-repo-check',
    '--sandbox',
    'workspace-write',
    '--color',
    'never',
    '-c',
    `model_reasoning_effort="${effort}"`,
    '-C',
    dir,
    '-',
  ];
}

/**
 * End a spawned child for real. On POSIX the pid is the process itself and
 * SIGTERM is enough. On Windows a shell:true child is cmd.exe wrapping the
 * real work (codex, npm), and terminating a Windows process does not touch
 * its children — the grandchild would keep running (and billing) invisibly.
 * So taskkill /T takes the whole tree down by pid, /F because a process being
 * killed for hanging cannot be trusted to honor a polite close.
 */
export function killTree(
  child: ReturnType<typeof nodeSpawn>,
  platform: NodeJS.Platform,
  spawnImpl: typeof nodeSpawn,
): void {
  if (platform === 'win32' && child.pid) {
    try {
      const tk = spawnImpl('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
      // An unhandled 'error' event would crash the server; the plain kill
      // below is the fallback either way.
      tk.on('error', () => {});
    } catch {
      // taskkill missing or refused: same fallback.
    }
  }
  try {
    child.kill();
  } catch {
    // Already gone.
  }
}

export function createRunner(opts: RunnerOptions = {}): CodexRunner {
  const spawnImpl = opts.spawnImpl ?? nodeSpawn;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const probeTimeoutMs = opts.probeTimeoutMs ?? PROBE_TIMEOUT_MS;
  const probeTtlMs = opts.probeTtlMs ?? PROBE_TTL_MS;
  const noActivityMs = opts.noActivityMs ?? NO_ACTIVITY_TIMEOUT_MS;
  const platform = opts.platform ?? process.platform;

  const killCodex = (child: ReturnType<typeof nodeSpawn>) => killTree(child, platform, spawnImpl);

  // The probe refreshes this every time it runs, so a codex installed after
  // Scenri started is found on the next check. run() reuses the last answer
  // because every generation is preceded by a probe on the same runner.
  let resolved: ResolvedCodex | null = null;
  async function resolution(): Promise<ResolvedCodex> {
    resolved ??= await resolveCodex(platform, spawnImpl);
    return resolved;
  }

  // On Windows, npm installs codex as codex.cmd, and a .cmd only runs through
  // a shell (CVE-2024-27980 made Node refuse it otherwise). The prompt can
  // quote imported library text, so the line has to be injection-safe:
  // cmd.exe cannot be defused for an embedded quote (any backslash game still
  // toggles cmd's own quoting) or for % (expands even inside quotes), and
  // newlines split the line. All three are prose-safe substitutions in an
  // image prompt, so they are substituted, then every argument is quoted,
  // which makes & | < > ^ literal to cmd. A where-resolved codex.exe skips
  // all of this: argv spawn, exact bytes, killable pid.
  const winArg = (a: string) =>
    `"${a
      .replace(/[\r\n]+/g, ' ')
      .replace(/"/g, "'")
      .replace(/%/g, ' percent ')}"`;
  const spawnCodex = (exe: ResolvedCodex, args: string[], stdinOpen: boolean) => {
    const stdio: ('pipe' | 'ignore')[] = [stdinOpen ? 'pipe' : 'ignore', 'pipe', 'pipe'];
    return exe.direct
      ? spawnImpl(exe.command, args, { stdio })
      : spawnImpl([exe.command, ...args].map(winArg).join(' '), [], { stdio, shell: true });
  };

  /** Run `codex <args>`, resolving on exit 0; kill + reject after timeoutMs. */
  async function run(args: string[], signal?: AbortSignal, io?: { stdin?: string }): Promise<void> {
    const exe = await resolution();
    return new Promise<void>((resolve, reject) => {
      let child: ReturnType<typeof nodeSpawn>;
      try {
        child = spawnCodex(exe, args, io?.stdin != null);
      } catch (err) {
        reject(new Error(`Failed to spawn codex: ${(err as Error).message}`));
        return;
      }

      let settled = false;
      let stderr = '';
      // A codex that says nothing on either pipe for the whole window is hung,
      // not thinking: the transcript streams continuously while it works. The
      // hard cap below still bounds a run that chats forever.
      let activityTimer = setTimeout(onSilence, noActivityMs);
      function sawActivity(): void {
        if (settled) return;
        clearTimeout(activityTimer);
        activityTimer = setTimeout(onSilence, noActivityMs);
      }
      function onSilence(): void {
        finish(() =>
          reject(
            new Error(`Codex CLI produced no output for ${Math.round(noActivityMs / 1000)}s, treating it as stuck`),
          ),
        );
        killCodex(child);
      }
      // codex streams its full transcript to stdout; it MUST be drained or the
      // 64KB pipe buffer fills and codex blocks forever (real hang, 2026-08-01).
      child.stdout?.on('data', sawActivity);
      child.stderr?.on('data', (d: Buffer | string) => {
        stderr += String(d);
        sawActivity();
      });

      if (io?.stdin != null) {
        // The child can die before or while the prompt is written; an
        // unhandled EPIPE here would take the server down with it.
        child.stdin?.on('error', () => {});
        child.stdin?.write(io.stdin);
        child.stdin?.end();
      }

      const timer = setTimeout(() => {
        // Settle first, then kill: the kill can surface an exit event
        // synchronously, and that exit must not outvote the timeout.
        finish(() => reject(new Error(`Codex CLI timed out after ${timeoutMs}ms`)));
        killCodex(child);
      }, timeoutMs);

      const onAbort = () => {
        finish(() => reject(new Error('Codex CLI run aborted')));
        killCodex(child);
      };

      function finish(fn: () => void): void {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        clearTimeout(activityTimer);
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
   * Run one short `codex` subcommand to a verdict. Never rejects: an absent
   * binary is an answer, not a fault — and so is a hang, which gets its own
   * verdict instead of stalling the request that asked. Output is captured
   * bounded (the version line is all the probe reads) and otherwise drained,
   * because a full pipe hangs the child.
   */
  function probeSpawn(
    exe: ResolvedCodex,
    args: string[],
  ): Promise<{ outcome: 'ok' | 'nonzero' | 'spawn-error' | 'timeout'; stdout: string }> {
    const CAP = 8192;
    return new Promise((resolve) => {
      let settled = false;
      let stdout = '';
      const done = (outcome: 'ok' | 'nonzero' | 'spawn-error' | 'timeout') => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ outcome, stdout });
      };
      let child: ReturnType<typeof nodeSpawn>;
      const timer = setTimeout(() => {
        // Verdict first, then kill: the kill can surface an exit event
        // synchronously, and that exit must not outvote the timeout.
        done('timeout');
        if (child) killCodex(child);
      }, probeTimeoutMs);
      try {
        child = spawnCodex(exe, args, false);
      } catch {
        done('spawn-error');
        return;
      }
      child.stdout?.on('data', (d: Buffer | string) => {
        if (stdout.length < CAP) stdout += String(d).slice(0, CAP - stdout.length);
      });
      child.stderr?.on('data', () => {});
      child.on('error', () => done('spawn-error'));
      child.on('exit', (code: number | null) => done(code === 0 ? 'ok' : 'nonzero'));
    });
  }

  // One line per verdict change, to the terminal Scenri runs in: exactly what
  // a bug report needs and nothing a credential could ride on.
  let lastDiag = '';
  function verdict(avail: EngineAvailability, exe: ResolvedCodex, version: string | null): EngineAvailability {
    const line = `codex probe: exe=${exe.command} version=${version ?? 'unknown'} outcome=${avail.ok ? 'ready' : avail.code}`;
    if (line !== lastDiag) {
      lastDiag = line;
      if (!avail.ok) console.warn(line);
      else if (process.env.SCENRI_DEBUG === '1') console.log(line);
    }
    return avail;
  }

  /**
   * Four questions, not one: is the binary here, is it new enough, is there a
   * session behind it, and could we actually tell. Each has a different fix —
   * install, update, sign in, check again — so each keeps its own code, and
   * anything the probe cannot verify is reported as exactly that. Unknown is
   * never ready. Exit codes only; the wording of codex's own output is not a
   * contract we can pin (the version line is the one parse, and failing to
   * parse it is not a failure).
   */
  let cached: { at: number; value: EngineAvailability } | null = null;

  async function probe(): Promise<EngineAvailability> {
    // Test servers set this so the machine's own codex login cannot turn a
    // deterministic run into a real build. Answered before spawning anything.
    if (process.env.SCENRI_NO_CODEX === '1') {
      return { ok: false, reason: NOT_INSTALLED_REASON, code: 'not-installed' };
    }
    // One page load asks about codex several times (engines list, preflight,
    // capabilities). One answer serves them all for a short while; anything
    // that changes the world calls invalidateProbe.
    if (cached && probeTtlMs > 0 && Date.now() - cached.at < probeTtlMs) {
      return cached.value;
    }
    const value = await probeUncached();
    cached = { at: Date.now(), value };
    return value;
  }

  async function probeUncached(): Promise<EngineAvailability> {
    // Fresh every probe: an install that happened after Scenri started must be
    // found on the next check, not after a restart.
    resolved = await resolveCodex(platform, spawnImpl);
    const exe = resolved;

    const ver = await probeSpawn(exe, ['--version']);
    if (ver.outcome === 'timeout') {
      return verdict({ ok: false, reason: UNVERIFIED_REASON, code: 'unverified' }, exe, null);
    }
    if (ver.outcome !== 'ok') {
      return verdict({ ok: false, reason: NOT_INSTALLED_REASON, code: 'not-installed' }, exe, null);
    }
    const version = parseCodexVersion(ver.stdout);
    if (version && !versionAtLeast(version, MIN_CODEX_VERSION)) {
      return verdict(
        {
          ok: false,
          reason: `Codex CLI ${version} is too old. Scenri needs ${MIN_CODEX_VERSION} or newer.`,
          code: 'update-needed',
        },
        exe,
        version,
      );
    }

    const login = await probeSpawn(exe, ['login', 'status']);
    if (login.outcome === 'ok') {
      return verdict({ ok: true }, exe, version);
    }
    if (login.outcome === 'nonzero') {
      return verdict({ ok: false, reason: NOT_AUTHENTICATED_REASON, code: 'not-authenticated' }, exe, version);
    }
    return verdict({ ok: false, reason: UNVERIFIED_REASON, code: 'unverified' }, exe, version);
  }

  function invalidateProbe(): void {
    cached = null;
    resolved = null;
  }

  return { run, withWorkDir, probe, invalidateProbe };
}
