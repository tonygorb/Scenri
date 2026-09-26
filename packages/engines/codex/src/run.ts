/**
 * Shared plumbing for driving the user's local `codex` binary.
 *
 * Both things this package does — generating images and analysing references
 * into structured data — are the same three moves: make a temp workspace, run
 * one `codex exec` inside it, read the file codex left behind. The transcript
 * on stdout is never the answer; the file is.
 */
import { spawn as nodeSpawn } from 'node:child_process';
import { copyFile, lstat, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { EngineAvailability } from '@scenri/core';
import { MIN_CODEX_VERSION, parseCodexVersion, resolveCodex, versionAtLeast, type ResolvedCodex } from './locate.js';
import { buildChildEnv, SIBLING_PROVIDER_KEYS } from './childEnv.js';
import { type CodexFailure, classifyCodexFailure, conflictReason, presentConflictKeys } from './classify.js';
import {
  CONNECT_PROMPT,
  CONNECT_TIMEOUT_MS,
  CONNECT_TTL_MS,
  type CodexConnection,
  availabilityFrom,
  connectFingerprint,
  outcomeFor,
} from './connect.js';

export const NOT_INSTALLED_REASON = 'Codex CLI is not installed on this computer';
export const NOT_AUTHENTICATED_REASON = 'Codex CLI is installed but not signed in';
export const UNVERIFIED_REASON = 'Could not verify Codex on this computer';
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
  /** How long a proven connection stays proven; 0 disables the rung entirely. */
  connectTtlMs?: number;
  /** The connection check's own cap. */
  connectTimeoutMs?: number;
  /**
   * Names to keep out of every codex child's environment, read per spawn so a
   * repair takes effect on the next run without rebuilding the runner. The
   * parent process is never touched.
   */
  ignoreEnvKeys?: () => readonly string[];
  /** The environment children inherit from. Injected for tests; process.env otherwise. */
  env?: NodeJS.ProcessEnv;
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
  /**
   * Run one real `codex exec` and report what it proved. Costs a turn of the
   * user's plan, so only an explicit check calls it; everything else reads the
   * verdict a check or a generation already left behind.
   */
  connect(opts?: { force?: boolean }): Promise<CodexConnection>;
  /** Forget the connection verdict only. Sign-in, an env repair and Check again call this. */
  invalidateConnection(): void;
  /** Record what a real generation already proved, so nothing is tested twice. */
  noteConnection(outcome: 'proven' | 'refused' | 'unproven', failure?: CodexFailure): void;
}

/**
 * Copy one of the person's pictures into the workdir. Node's own failure names
 * both absolute paths (the library's and the temp dir's), and this message is
 * what the studio shows, so the raw one goes to the log and the person reads a
 * sentence.
 */
export async function copyReference(src: string, dest: string): Promise<void> {
  try {
    await copyFile(src, dest);
  } catch (err) {
    console.error(`codex: ${String((err as Error)?.message ?? err)}`);
    throw new Error('A reference picture could not be read.');
  }
}

/**
 * Read a file codex left behind, only when it is a plain file. The agent runs
 * in a sandbox and Scenri does not: a link it left as out-1.png would have
 * Scenri copy whatever the link points at into the library.
 */
export async function readLeftFile(path: string, name: string): Promise<Buffer> {
  if (!(await lstat(path)).isFile()) throw new Error(`codex: ${name} is not a plain file`);
  return readFile(path);
}

/**
 * The model every exec runs on. Scenri used to pass none, so each run took the
 * machine's codex default (gpt-6-astra since the Codex app moved config.toml),
 * and on 2026-09-26 eight images cost 56% of a Team plan's 5-hour window, about
 * four fifths of it the text model's own tokens. gpt-6-sol is the cheaper
 * frontier model on the same plan. A codex too old to know it refuses before
 * drawing, and the runner already turns that refusal into "update Codex".
 */
export const CODEX_MODEL = 'gpt-6-sol';

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
    '-m',
    CODEX_MODEL,
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
 * codex's own refusal when ~/.codex/config.toml names a model the installed
 * CLI predates. Captured live on 2026-09-07 (v0.145.0; the Codex desktop app
 * beside it had written model = "gpt-6-astra"):
 *
 *   ERROR: {"type":"error","status":400,"error":{"type":"invalid_request_error",
 *   "message":"The 'gpt-6-astra' model requires a newer version of Codex. ..."}}
 *
 * Scenri passes no --model on purpose (the config is the user's), so the fix
 * is the one codex names: a newer CLI. Not a floor matter: the flag surface is
 * fine, this version simply predates that model.
 */
const MODEL_NEEDS_NEWER_CODEX = /The '([^']+)' model requires a newer version of Codex/;

/**
 * The other half of a conflict 401. Captured live on codex-cli 0.153.4
 * (2026-09-13) with a bogus CODEX_API_KEY exported and a healthy ChatGPT
 * sign-in in place:
 *
 *   ERROR: unexpected status 401 Unauthorized: Incorrect API key provided:
 *   sk-proj-****s000.
 *
 * A 401 without this wording is a refused session and keeps the signed-out
 * reading; this wording without a variable set here is not ours to blame.
 */
const BAD_KEY_401 = /incorrect api key provided|invalid_api_key|invalid api key/i;

/** The sentence both the failed exec and the probe say about it; the exec adds what to do. */
function tooOldForModel(version: string | null, model: string): string {
  return `Codex CLI ${version ?? 'on this computer'} is too old for the model it is set to, ${model}.`;
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
  const connectTtlMs = opts.connectTtlMs ?? CONNECT_TTL_MS;
  const connectTimeoutMs = opts.connectTimeoutMs ?? CONNECT_TIMEOUT_MS;
  const parentEnv = opts.env ?? process.env;
  const ignoreEnvKeys = opts.ignoreEnvKeys ?? (() => [] as readonly string[]);

  const killCodex = (child: ReturnType<typeof nodeSpawn>) => killTree(child, platform, spawnImpl);

  // The probe refreshes this every time it runs, so a codex installed after
  // Scenri started is found on the next check. run() reuses the last answer
  // because every generation is preceded by a probe on the same runner.
  let resolved: ResolvedCodex | null = null;
  async function resolution(): Promise<ResolvedCodex> {
    resolved ??= await resolveCodex(platform, spawnImpl);
    return resolved;
  }

  // What the last probe read from `codex --version`, and the verdict a failed
  // exec pinned on it. The probe alone cannot see a model the CLI predates:
  // the version meets the floor and login status exits 0, so it answered ready
  // while every exec died with codex's 400, and the setup wizard showed a green
  // check under a failed shot. The exec that finds out records it here, and
  // the probe repeats it for exactly that version. A newer codex clears it;
  // "check again" on the same one does not.
  let knownVersion: string | null = null;
  let tooOldFor: { version: string | null; model: string } | null = null;

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
    // One environment for every codex child, the check included: the whole
    // point of the connection check is that codex cannot tell it apart from a
    // real shot. Built per spawn so a repair lands on the next run.
    const env = buildChildEnv(parentEnv, [...ignoreEnvKeys(), ...SIBLING_PROVIDER_KEYS]);
    return exe.direct
      ? spawnImpl(exe.command, args, { stdio, env, ...(platform !== 'win32' ? { detached: true } : {}) })
      : spawnImpl([exe.command, ...args.map(winArg)].join(' '), [], { stdio, env, shell: true });
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
        // The configured model outranks this CLI: say so, and let the probe
        // say the same until the CLI changes (see tooOldFor).
        const newer = MODEL_NEEDS_NEWER_CODEX.exec(stderr);
        if (newer) {
          const model = newer[1];
          tooOldFor = { version: knownVersion, model };
          invalidateProbe();
          finish(`exit-${code ?? 'unknown'}`, () =>
            reject(new Error(`${tooOldForModel(knownVersion, model)} Update Codex CLI, then run this again.`)),
          );
          return;
        }
        // A 401 that names a bad API key, on a machine that is exporting one,
        // is not a signed-out session. Codex's own tail is dropped here: it
        // carries the masked key fragment and nothing a person needs.
        const conflicting = presentConflictKeys(parentEnv, ignoreEnvKeys());
        if (conflicting.length > 0 && /\b401\b|unauthorized/i.test(stderr) && BAD_KEY_401.test(stderr)) {
          noteConnection('refused', {
            code: 'CODEX_AUTH_CONFLICT',
            conflictKeys: conflicting,
            reason: conflictReason(conflicting),
          });
          finish(`exit-${code ?? 'unknown'}`, () => reject(new Error(conflictReason(conflicting))));
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
  let connCache: CodexConnection | null = null;
  let connectInFlight: Promise<CodexConnection> | null = null;

  /** Everything that could make a proven connection stop being true. */
  function fingerprintFor(exe: ResolvedCodex, version: string | null): string {
    const ignored = ignoreEnvKeys();
    return connectFingerprint({
      command: exe.command,
      version,
      present: presentConflictKeys(parentEnv, ignored),
      ignored,
    });
  }

  /** The stored verdict, if it is still fresh and still about this machine. */
  function freshConnection(exe: ResolvedCodex, version: string | null): CodexConnection | null {
    if (!connCache || connectTtlMs <= 0) return null;
    if (Date.now() - connCache.at >= connectTtlMs) return null;
    if (connCache.fingerprint !== fingerprintFor(exe, version)) return null;
    return connCache;
  }

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

  /**
   * The verdict, corrected by whatever a real run already proved.
   *
   * This never spawns an exec of its own. GET /api/engines is awaited on every
   * page load, so spending a turn of the user's plan here - or blocking it for
   * the length of one - is not on offer. The fifth rung is asked by the setup
   * dialog and answered for free by every generation.
   */
  async function probeUncached(): Promise<EngineAvailability> {
    const { avail, exe, version } = await probeLadder();
    return availabilityFrom(avail, freshConnection(exe, version));
  }

  async function probeLadder(): Promise<{ avail: EngineAvailability; exe: ResolvedCodex; version: string | null }> {
    // Fresh every probe: an install that happened after Scenri started must be
    // found on the next check, not after a restart.
    resolved = await resolveCodex(platform, spawnImpl);
    const exe = resolved;

    const ver = await probeSpawn(exe, ['--version']);
    if (ver.outcome === 'timeout') {
      return {
        avail: verdict({ ok: false, reason: UNVERIFIED_REASON, code: 'unverified' }, exe, null),
        exe,
        version: null,
      };
    }
    if (ver.outcome !== 'ok') {
      return {
        avail: verdict({ ok: false, reason: NOT_INSTALLED_REASON, code: 'not-installed' }, exe, null),
        exe,
        version: null,
      };
    }
    const version = parseCodexVersion(ver.stdout);
    knownVersion = version;
    if (version && !versionAtLeast(version, MIN_CODEX_VERSION)) {
      return {
        avail: verdict(
          {
            ok: false,
            reason: `Codex CLI ${version} is too old. Scenri needs ${MIN_CODEX_VERSION} or newer.`,
            code: 'update-needed',
          },
          exe,
          version,
        ),
        exe,
        version,
      };
    }
    if (tooOldFor) {
      if (version === tooOldFor.version) {
        return {
          avail: verdict(
            { ok: false, reason: tooOldForModel(version, tooOldFor.model), code: 'update-needed' },
            exe,
            version,
          ),
          exe,
          version,
        };
      }
      // A different codex is a different question; that verdict said nothing about it.
      tooOldFor = null;
    }

    const login = await probeSpawn(exe, ['login', 'status']);
    if (login.outcome === 'ok') {
      return { avail: verdict({ ok: true }, exe, version), exe, version };
    }
    if (login.outcome === 'nonzero') {
      return {
        avail: verdict({ ok: false, reason: NOT_AUTHENTICATED_REASON, code: 'not-authenticated' }, exe, version),
        exe,
        version,
      };
    }
    return { avail: verdict({ ok: false, reason: UNVERIFIED_REASON, code: 'unverified' }, exe, version), exe, version };
  }

  /**
   * The fifth question, asked for real: can THIS process start codex and have
   * OpenAI accept it. Nothing cheaper answers it - `codex login status` prints
   * "Logged in using ChatGPT" and exits 0 on a machine where every `codex
   * exec` 401s, because exec reads CODEX_API_KEY and login status does not.
   */
  async function connect(o: { force?: boolean } = {}): Promise<CodexConnection> {
    if (connectInFlight) return connectInFlight;
    const pending = (async (): Promise<CodexConnection> => {
      const { avail, exe, version } = await probeLadder();
      const fingerprint = fingerprintFor(exe, version);
      if (!o.force) {
        const fresh = freshConnection(exe, version);
        if (fresh) return fresh;
      }
      // Nothing to prove: the ladder already knows why this machine cannot
      // run codex, and spending a turn to hear it again helps nobody.
      if (!avail.ok) {
        return { outcome: 'unproven', at: Date.now(), fingerprint };
      }
      let result: CodexConnection;
      try {
        await withWorkDir((dir) =>
          run(execArgs(dir), undefined, {
            stdin: CONNECT_PROMPT,
            timeoutMs: connectTimeoutMs,
            label: 'connect',
          }),
        );
        result = { outcome: 'proven', at: Date.now(), fingerprint };
      } catch (err) {
        const failure = classifyCodexFailure({
          text: err instanceof Error ? err.message : String(err),
          env: parentEnv,
          ignored: ignoreEnvKeys(),
        });
        result = { outcome: outcomeFor(failure.code), failure, at: Date.now(), fingerprint };
      }
      connCache = result;
      cached = null;
      return result;
    })();
    connectInFlight = pending;
    try {
      return await pending;
    } finally {
      connectInFlight = null;
    }
  }

  /**
   * A finished shot is stronger proof than any check, and a shot that died on
   * a conflict has already paid for the answer. Recording it here means the
   * engine list and the composer banner catch up without spawning anything.
   */
  function noteConnection(outcome: 'proven' | 'refused' | 'unproven', failure?: CodexFailure): void {
    if (outcome === 'unproven') return;
    const exe = resolved;
    if (!exe) return;
    connCache = { outcome, failure, at: Date.now(), fingerprint: fingerprintFor(exe, knownVersion) };
    cached = null;
  }

  function invalidateProbe(): void {
    cached = null;
    resolved = null;
  }

  function invalidateConnection(): void {
    connCache = null;
    cached = null;
  }

  return { run, withWorkDir, probe, invalidateProbe, connect, invalidateConnection, noteConnection };
}
