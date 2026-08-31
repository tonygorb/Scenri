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
 * How long a launched exec may stay completely silent before it counts as
 * never having started. A healthy `codex exec` prints its preamble within
 * seconds of launch; the wedged spawns this guards against (observed upstream
 * on Windows) never print anything at all. The guard is one-shot: once the
 * first byte arrives on either pipe it is disarmed for good, because silence
 * AFTER that is normal work — the image_gen tool call is a single quiet HTTP
 * round-trip that regularly exceeds two minutes, and a rolling silence
 * watchdog here used to kill those healthy runs about one time in eight. A
 * run that wedges after its banner is bounded by the hard cap instead.
 */
export const FIRST_OUTPUT_TIMEOUT_MS = 60_000;

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
  /** The silence-from-launch window before a run counts as never started. Tests shrink it. */
  firstOutputMs?: number;
  /** Tests pin this so the spawn contract does not fork with the CI host OS. */
  platform?: NodeJS.Platform;
}

/** Per-call knobs for one exec; the runner's own options are the defaults. */
export interface RunIo {
  stdin?: string;
  /** Overrides the runner's hard cap for this one exec. */
  timeoutMs?: number;
  /** Names this exec in the diagnostic line, e.g. "gen v2/4 refs=3". */
  label?: string;
}

export interface CodexRunner {
  run(args: string[], signal?: AbortSignal, opts?: RunIo): Promise<void>;
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
 * How much of each pipe is kept for a failure message. codex streams its whole
 * transcript, so both buffers are tails and never transcripts: enough to carry
 * the line that ended the run, bounded so a long exec cannot grow them.
 */
const TAIL_BYTES = 4096;
/** How much of that tail a user is actually shown. */
const DETAIL_CHARS = 800;

/** Append to a rolling buffer that never exceeds TAIL_BYTES. */
function keepTail(buf: string, chunk: string): string {
  const next = buf + chunk;
  return next.length > TAIL_BYTES ? next.slice(next.length - TAIL_BYTES) : next;
}

/**
 * The session banner codex prints before it does any work. Its real shape,
 * captured live on v0.145.0:
 *
 *   OpenAI Codex v0.145.0
 *   --------
 *   workdir: /tmp/scenri-codex-x
 *   model: gpt-5.6-sol
 *   ...
 *   --------
 *
 * so the banner ends at the second separator. The prefix list is the fallback
 * for a codex whose separators ever change.
 */
const BANNER_RULE = /^-{3,}\s*$/;
const BANNER_LINE = /^(OpenAI Codex v|workdir:|model:|provider:|approval:|sandbox:|reasoning |-{3,}\s*$|\s*$)/;

function afterBanner(stderr: string): string {
  const lines = stderr.split(/\r?\n/);
  const rules: number[] = [];
  for (const [i, line] of lines.entries()) if (BANNER_RULE.test(line)) rules.push(i);
  if (rules.length >= 2)
    return lines
      .slice(rules[1] + 1)
      .join('\n')
      .trim();
  let i = 0;
  while (i < lines.length && BANNER_LINE.test(lines[i])) i++;
  return lines.slice(i).join('\n').trim();
}

/** The last DETAIL_CHARS of `text`, starting on a line boundary. */
function tailOf(text: string): string {
  if (text.length <= DETAIL_CHARS) return text;
  const cut = text.slice(text.length - DETAIL_CHARS);
  const nl = cut.indexOf('\n');
  return (nl >= 0 ? cut.slice(nl + 1) : cut).trim();
}

/**
 * What to show a user when codex exits nonzero.
 *
 * The rule this replaces kept the FIRST 200 characters of stderr, and a real
 * banner measures about 202 — so a Windows tester on 2026-08-31 was told his
 * shot failed because "workdir: ... model: gpt-5.6-sol", and the line that
 * said why was cut off. The reason a run ended is always at the END of it.
 * codex marks its own failures with `ERROR:`, so that wins when it is there;
 * stdout is the last resort, for an exit whose stderr is banner and nothing else.
 */
export function codexFailureDetail(stderr: string, stdout: string): string {
  const body = afterBanner(stderr);
  const errorAt = body.lastIndexOf('\nERROR:');
  const marked = body.startsWith('ERROR:') ? body : errorAt >= 0 ? body.slice(errorAt + 1) : '';
  return tailOf(marked) || tailOf(body) || tailOf(stdout.trim()) || tailOf(stderr.trim());
}

/**
 * End a spawned child for real. On POSIX the child is spawned detached, which
 * makes it its own process-group leader, so a negative-pid SIGTERM reaches
 * codex's own descendants (sips, cp, sandbox helpers) too — a plain kill on
 * the direct pid left those running after a timeout. On Windows a shell:true
 * child is cmd.exe wrapping the real work (codex, npm), and terminating a
 * Windows process does not touch its children — the grandchild would keep
 * running (and billing) invisibly. So taskkill /T takes the whole tree down
 * by pid, /F because a process being killed for hanging cannot be trusted to
 * honor a polite close.
 */
export function killTree(
  child: ReturnType<typeof nodeSpawn>,
  platform: NodeJS.Platform,
  spawnImpl: typeof nodeSpawn,
): void {
  if (platform === 'win32' && child.pid) {
    try {
      const tk = spawnImpl('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
      // taskkill must be the ONLY killer while it works: a plain kill fired
      // alongside it terminates the cmd.exe parent first, taskkill then walks
      // a dead pid, finds no tree, and the grandchild survives — the exact
      // orphan this function exists to prevent (caught by the real-spawn
      // suite on windows-latest). The plain kill runs only when taskkill
      // itself cannot: missing, refused, or exiting nonzero.
      const fallback = () => {
        try {
          child.kill();
        } catch {
          // Already gone.
        }
      };
      tk.on('error', fallback);
      tk.on('exit', (code: number | null) => {
        if (code !== 0) fallback();
      });
      return;
    } catch {
      // taskkill unavailable: fall through to the plain kill.
    }
  }
  // Only a real spawn made a real process group. A scripted spawnImpl (tests)
  // makes no process at all, and its fake pid must never be signalled for
  // real — negative-pid SIGTERM on a number that happens to be someone
  // else's process group would kill bystanders.
  if (platform !== 'win32' && child.pid && spawnImpl === nodeSpawn) {
    try {
      // The detached spawn made the child a group leader: -pid is its tree.
      process.kill(-child.pid, 'SIGTERM');
      return;
    } catch {
      // Not a group leader (or already gone): fall through to the plain kill.
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
  const defaultTimeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const probeTimeoutMs = opts.probeTimeoutMs ?? PROBE_TIMEOUT_MS;
  const probeTtlMs = opts.probeTtlMs ?? PROBE_TTL_MS;
  const firstOutputMs = opts.firstOutputMs ?? FIRST_OUTPUT_TIMEOUT_MS;
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
    // The program token is never quoted and never substituted: it is our own
    // constant, and cmd.exe only gives a .cmd shim a correct %~dp0 (the dir
    // the shim resolves its JavaScript against) when the batch is invoked by
    // its bare, unquoted name. Quoting it shipped in 0.3.5 and silently broke
    // every npm-shim install: the shim looked for its JS in the caller's cwd.
    // detached on POSIX only: the child becomes its own process-group leader
    // so killTree's -pid SIGTERM reaches codex's descendants. Never on the
    // win32 shell branch, where detachment has different semantics and
    // taskkill /T already owns tree teardown.
    return exe.direct
      ? spawnImpl(exe.command, args, { stdio, ...(platform !== 'win32' ? { detached: true } : {}) })
      : spawnImpl([exe.command, ...args.map(winArg)].join(' '), [], { stdio, shell: true });
  };

  /** Run `codex <args>`, resolving on exit 0; kill + reject on a blown budget. */
  async function run(args: string[], signal?: AbortSignal, io?: RunIo): Promise<void> {
    const exe = await resolution();
    const timeoutMs = io?.timeoutMs ?? defaultTimeoutMs;
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
      let stdout = '';
      // The diagnostic line is the evidence base for every timeout value here:
      // when a run fails, the terminal says which budget was blown and what
      // the pipes actually did. Success lines ride behind SCENRI_DEBUG=1.
      const spawnedAt = Date.now();
      let firstByteAt = 0;
      let lastByteAt = 0;
      let maxGapMs = 0;
      // One-shot: a healthy exec prints its preamble within seconds, a wedged
      // spawn never prints at all. Disarmed for good on the first byte —
      // silence after that is normal work (the image_gen round-trip), and the
      // hard cap below bounds a run that wedges once it has spoken.
      const firstOutputTimer = setTimeout(() => {
        finish('first-output-timeout', () =>
          reject(
            new Error(
              `Codex CLI produced no output for ${Math.round(firstOutputMs / 1000)}s after launch, treating it as stuck`,
            ),
          ),
        );
        killCodex(child);
      }, firstOutputMs);
      function sawActivity(): void {
        if (settled) return;
        const now = Date.now();
        if (firstByteAt === 0) {
          firstByteAt = now;
          clearTimeout(firstOutputTimer);
        } else {
          maxGapMs = Math.max(maxGapMs, now - lastByteAt);
        }
        lastByteAt = now;
      }
      // codex streams its full transcript to stdout; it MUST be drained or the
      // 64KB pipe buffer fills and codex blocks forever (real hang, 2026-08-01).
      // Draining used to mean discarding, which left an exit that narrated its
      // failure on stdout with nothing to report. Both pipes now keep a tail.
      child.stdout?.on('data', (d: Buffer | string) => {
        stdout = keepTail(stdout, String(d));
        sawActivity();
      });
      child.stderr?.on('data', (d: Buffer | string) => {
        stderr = keepTail(stderr, String(d));
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
        finish('hard-timeout', () => reject(new Error(`Codex CLI timed out after ${timeoutMs}ms`)));
        killCodex(child);
      }, timeoutMs);

      const onAbort = () => {
        finish('abort', () => reject(new Error('Codex CLI run aborted')));
        killCodex(child);
      };

      function finish(outcome: string, fn: () => void): void {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        clearTimeout(firstOutputTimer);
        signal?.removeEventListener('abort', onAbort);
        const ttfb = firstByteAt ? firstByteAt - spawnedAt : -1;
        const line =
          `codex exec${io?.label ? ` [${io.label}]` : ''}: outcome=${outcome} ` +
          `ttfb=${ttfb}ms maxGap=${maxGapMs}ms total=${Date.now() - spawnedAt}ms`;
        if (outcome !== 'ok' && outcome !== 'abort') console.warn(line);
        else if (process.env.SCENRI_DEBUG === '1') console.log(line);
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
        finish('spawn-error', () => reject(new Error(`Failed to spawn codex: ${err.message}`)));
      });
      child.on('exit', (code: number | null) => {
        if (code === 0) {
          finish('ok', resolve);
          return;
        }
        // A usage limit is the one failure worth its own sentence: the tail
        // below would show the raw refusal, which is three URLs long and does
        // not say the one thing a user needs. Keyed on the CLI's real
        // wording, captured live on 2026-08-29 (v0.145.0):
        //   ERROR: You've hit your usage limit. Upgrade to Pro (...), visit
        //   ... or try again at Aug 30th, 2026 12:41 AM.
        const limit = /You've hit your usage limit\.(?:[^\n]*?\btry again at ([^.\n]+)\.)?/.exec(stderr);
        if (limit) {
          const when = limit[1]?.trim();
          finish(`exit-${code ?? 'unknown'}`, () =>
            reject(
              new Error(
                `Your Codex plan's usage limit is used up${when ? ` until ${when}` : ''}. ` +
                  'Generation resumes on its own then, or add credits from your Codex account.',
              ),
            ),
          );
          return;
        }
        const snippet = codexFailureDetail(stderr, stdout);
        finish(`exit-${code ?? 'unknown'}`, () =>
          reject(new Error(`codex exited with code ${code ?? 'unknown'}${snippet ? `: ${snippet}` : ''}`)),
        );
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
