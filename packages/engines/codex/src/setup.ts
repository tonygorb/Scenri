/**
 * Guided setup for the local Codex CLI.
 *
 * Scenri's primary engine is the user's own Codex session, and most of the
 * people it is for have a ChatGPT subscription but have never opened a
 * terminal. So the app runs the two setup commands for them — an install and a
 * sign-in — and polls the same probe the engine uses to know when it worked.
 *
 * Boundaries this file keeps, deliberately:
 * - Only official commands: `npm install -g @openai/codex`, `codex login`.
 * - Never reads, copies or stores a credential. Sign-in happens in the user's
 *   browser and the token lands in codex's own config, untouched by us.
 * - Install is opt-in per call: nothing here runs unless the UI asked.
 */
import { spawn as nodeSpawn } from 'node:child_process';
import type { EngineAvailability } from '@scenri/core';
import { createRunner, type CodexRunner, type RunnerOptions } from './run.js';

/** The one command we would otherwise ask a non-developer to type. */
export const INSTALL_COMMAND = 'npm install -g @openai/codex';

/** Where a user goes when the automatic install cannot work. */
export const INSTALL_DOCS_URL = 'https://developers.openai.com/codex/cli';

/**
 * npm's global folder is root-owned on a stock macOS Node install, so the
 * plain command fails with EACCES for the very people this wizard is for.
 */
export const INSTALL_COMMAND_SUDO = 'sudo npm install -g @openai/codex';

export type CodexSetupState = 'not-installed' | 'not-authenticated' | 'update-needed' | 'unverified' | 'ready';

export interface CodexInstallResult {
  ok: boolean;
  /** Present when the install failed: what to run by hand instead. */
  fallbackCommand?: string;
  docsUrl?: string;
  detail?: string;
}

export interface CodexLoginResult {
  ok: boolean;
  /** Present when launching the browser flow failed: the headless alternative. */
  fallbackCommand?: string;
  detail?: string;
}

export interface CodexSetup {
  /** Same probe the engine uses, mapped to the state the wizard switches on. */
  status(): Promise<{ state: CodexSetupState; reason?: string }>;
  install(): Promise<CodexInstallResult>;
  login(): Promise<CodexLoginResult>;
}

export interface CodexSetupOptions extends RunnerOptions {
  /** Injected for tests; defaults to node's spawn. */
  spawnImpl?: typeof nodeSpawn;
  /** How long the global npm install may take before we give up. */
  installTimeoutMs?: number;
  /** The process-wide runner, so setup shares the engine's probe cache. */
  runner?: CodexRunner;
}

const DEFAULT_INSTALL_TIMEOUT_MS = 180_000;

function stateFrom(avail: EngineAvailability): CodexSetupState {
  if (avail.ok) return 'ready';
  switch (avail.code) {
    case 'not-authenticated':
    case 'update-needed':
    case 'unverified':
      return avail.code;
    default:
      return 'not-installed';
  }
}

export function createCodexSetup(opts: CodexSetupOptions = {}): CodexSetup {
  const spawnImpl = opts.spawnImpl ?? nodeSpawn;
  const platform = opts.platform ?? process.platform;
  const runner = opts.runner ?? createRunner(opts);
  const installTimeoutMs = opts.installTimeoutMs ?? DEFAULT_INSTALL_TIMEOUT_MS;

  /** Run a command to completion, collecting stderr for the failure detail. */
  function run(
    cmd: string,
    args: string[],
    timeoutMs: number,
  ): Promise<{ code: number | null; stderr: string; spawnError?: string }> {
    return new Promise((resolve) => {
      let settled = false;
      let stderr = '';
      const done = (r: { code: number | null; stderr: string; spawnError?: string }) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(r);
      };
      let child: ReturnType<typeof nodeSpawn>;
      const timer = setTimeout(() => {
        child?.kill();
        done({ code: null, stderr, spawnError: `${cmd} timed out after ${timeoutMs}ms` });
      }, timeoutMs);
      try {
        child = spawnImpl(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], shell: platform === 'win32' });
      } catch (err) {
        done({ code: null, stderr, spawnError: (err as Error).message });
        return;
      }
      // Drained for the same reason every other codex pipe is: a full buffer hangs.
      child.stdout?.on('data', () => {});
      child.stderr?.on('data', (d: Buffer | string) => {
        stderr += String(d);
      });
      child.on('error', (err: Error) => done({ code: null, stderr, spawnError: err.message }));
      child.on('exit', (code: number | null) => done({ code, stderr }));
    });
  }

  return {
    async status() {
      // This endpoint IS the check the wizard offers, and the sign-in poll
      // rides on it, so it always asks fresh rather than serving the cache.
      runner.invalidateProbe();
      const avail = await runner.probe();
      return { state: stateFrom(avail), reason: avail.reason };
    },

    async install() {
      const res = await run('npm', ['install', '-g', '@openai/codex'], installTimeoutMs);
      if (res.code === 0) {
        // Trust the probe, not the exit code: a global install can succeed and
        // still leave the binary off this process's PATH.
        runner.invalidateProbe();
        const avail = await runner.probe();
        if (avail.code === 'not-installed') {
          return {
            ok: false,
            fallbackCommand: INSTALL_COMMAND,
            docsUrl: INSTALL_DOCS_URL,
            detail: 'Codex installed but is not on this app’s PATH yet. Restart Scenri, or install it yourself.',
          };
        }
        return { ok: true };
      }
      if (platform !== 'win32' && /EACCES|permission denied/i.test(res.stderr)) {
        return {
          ok: false,
          fallbackCommand: INSTALL_COMMAND_SUDO,
          docsUrl: INSTALL_DOCS_URL,
          detail:
            'npm needs your password to install into its system folder. Run the command below and type your password when asked; it stays invisible while you type.',
        };
      }
      const detail = (res.spawnError ?? res.stderr).trim().slice(0, 400) || undefined;
      return { ok: false, fallbackCommand: INSTALL_COMMAND, docsUrl: INSTALL_DOCS_URL, detail };
    },

    async login() {
      // `codex login` opens the user's browser and waits. That wait is the
      // point: it resolves once they finish in the browser, and the UI polls
      // status meanwhile so a closed tab or an abandoned flow still ends
      // somewhere honest rather than hanging the request.
      const res = await run('codex', ['login'], installTimeoutMs);
      // Whatever happened in the browser, the cached answer is stale now.
      runner.invalidateProbe();
      if (res.code === 0) return { ok: true };
      const detail = (res.spawnError ?? res.stderr).trim().slice(0, 400) || undefined;
      return { ok: false, fallbackCommand: 'codex login --device-auth', detail };
    },
  };
}
