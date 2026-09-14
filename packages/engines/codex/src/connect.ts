/**
 * Proving Codex works, rather than assuming it from the shape of the machine.
 *
 * The probe's four questions - is the binary here, is it new enough, is there
 * a session, could we tell - are all answerable without running anything, and
 * that is exactly their limit. A stale CODEX_API_KEY leaves every one of them
 * green and kills every generation, because `codex exec` reads that variable
 * and `codex login status` does not. So there is a fifth question, and the
 * only honest way to ask it is to run the same command a shot runs.
 *
 * It costs one short turn of the user's own ChatGPT plan, so it is never
 * speculative: the setup dialog asks it, a real generation answers it for
 * free, and nothing else may spend it.
 */
import type { EngineAvailability } from '@scenri/core';
import type { CodexFailure, CodexFailureCode } from './classify.js';

/**
 * One model turn, no tools, no files, no image. Kept free of quotes, percent
 * signs and newlines so it stays safe if it is ever moved off stdin and
 * through the win32 shell quoting in run.ts.
 */
export const CONNECT_PROMPT =
  'Reply with the single word READY. Do not use any tools. Do not generate an image. Do not read or write any files.';

/**
 * A starting figure, not a measurement. A refused connection answers in about
 * a second because the 401 lands before any model work; a healthy one is a
 * low-effort turn. run() writes ttfb and total for every exec, so this gets
 * tuned from real runs rather than argued about.
 */
export const CONNECT_TIMEOUT_MS = 45_000;

/** How long a proven connection stays proven. The fingerprint covers every known way it can stop being true. */
export const CONNECT_TTL_MS = 10 * 60_000;

export type ConnectOutcome = 'proven' | 'refused' | 'unproven';

export interface CodexConnection {
  outcome: ConnectOutcome;
  /** Present on refused and on unproven: what the failed exec was. */
  failure?: CodexFailure;
  at: number;
  /** Everything that could change the answer. A mismatch voids the verdict at once. */
  fingerprint: string;
}

export function connectFingerprint(p: {
  command: string;
  version: string | null;
  present: readonly string[];
  ignored: readonly string[];
}): string {
  return [p.command, p.version ?? 'unknown', [...p.present].sort().join('+'), [...p.ignored].sort().join('+')].join(
    '|',
  );
}

/**
 * Which failures are allowed to say the connection is broken.
 *
 * Everything else is `unproven`, and unproven never downgrades a verdict. A
 * slow link, a used-up plan or an exit nobody recognised must not turn a
 * working Codex off: that would be a worse bug, and a more confusing one, than
 * the false green this rung exists to remove.
 */
export function outcomeFor(code: CodexFailureCode): ConnectOutcome {
  switch (code) {
    case 'CODEX_AUTH_CONFLICT':
    case 'CODEX_401':
    case 'CODEX_NOT_AUTHENTICATED':
    case 'CODEX_NOT_FOUND':
    case 'CODEX_VERSION_TOO_OLD':
      return 'refused';
    default:
      return 'unproven';
  }
}

/**
 * The ladder's verdict, corrected by what a real run found out. Only a
 * positive identification may change it, and only downwards.
 */
export function availabilityFrom(shallow: EngineAvailability, conn: CodexConnection | null): EngineAvailability {
  if (!shallow.ok) return shallow;
  if (!conn || conn.outcome !== 'refused' || !conn.failure) return shallow;
  const { code, reason } = conn.failure;
  switch (code) {
    case 'CODEX_AUTH_CONFLICT':
      return { ok: false, reason, code: 'env-conflict' };
    case 'CODEX_401':
    case 'CODEX_NOT_AUTHENTICATED':
      return { ok: false, reason, code: 'not-authenticated' };
    case 'CODEX_VERSION_TOO_OLD':
      return { ok: false, reason, code: 'update-needed' };
    case 'CODEX_NOT_FOUND':
      return { ok: false, reason, code: 'not-installed' };
    default:
      return shallow;
  }
}
