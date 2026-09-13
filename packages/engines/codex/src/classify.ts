/**
 * What went wrong with codex, as a code rather than a sentence.
 *
 * The case this exists for, measured live on codex-cli 0.153.4 (macOS,
 * 2026-09-13): with a stale `CODEX_API_KEY` exported, `codex login status`
 * printed "Logged in using ChatGPT" and exited 0, while `codex exec` answered
 *
 *   ERROR: unexpected status 401 Unauthorized: Incorrect API key provided:
 *   sk-proj-****s000.
 *
 * That is not a signed-out machine and must not be reported as one. Codex's
 * own source says why: load_auth opens with "API key via env var takes
 * precedence over any other auth method", gated on a flag that only the `exec`
 * subcommand passes as true. `exec` is what Scenri runs, and the interactive
 * TUI is not, which is exactly why the terminal looks healthy while every shot
 * fails.
 *
 * Ordered, first match wins, in the same doctrine as the studio's failure
 * table. Every pattern here is matched against a string this repo or codex
 * actually produces; none are speculative.
 */

export type CodexFailureCode =
  | 'CODEX_NOT_FOUND'
  | 'CODEX_VERSION_TOO_OLD'
  | 'CODEX_USAGE_LIMIT'
  | 'CODEX_NOT_AUTHENTICATED'
  | 'CODEX_AUTH_CONFLICT'
  | 'CODEX_401'
  | 'NETWORK_FAILURE'
  | 'CODEX_NO_OUTPUT'
  | 'CODEX_TIMEOUT'
  | 'CODEX_EXECUTION_FAILED'
  | 'UNKNOWN';

/**
 * The variables that can outrank a ChatGPT sign-in, in codex's own precedence
 * order. CODEX_API_KEY wins outright under `exec`; CODEX_ACCESS_TOKEN outranks
 * the stored session under every subcommand. OPENAI_API_KEY is inert for
 * `codex exec` on 0.153.4 (measured: a bogus one generates fine) and is listed
 * anyway, because it is what an older codex read and what a user-authored
 * model_providers entry in their own config.toml still can.
 */
export const CONFLICT_ENV_KEYS = ['CODEX_API_KEY', 'CODEX_ACCESS_TOKEN', 'OPENAI_API_KEY'] as const;

export interface CodexFailure {
  code: CodexFailureCode;
  /** Which conflicting variables this process carries. Names only, never a value. */
  conflictKeys: string[];
  /** One sentence, ours, for a person. */
  reason: string;
}

/**
 * Which of the conflicting names are set here and still being passed down. A
 * variable Scenri already drops from the child cannot be what the child
 * tripped over, so a repaired machine stops blaming a key it no longer sends.
 */
export function presentConflictKeys(env: NodeJS.ProcessEnv, ignored: readonly string[] = []): string[] {
  const dropped = new Set(ignored.map((n) => n.toUpperCase()));
  const present: string[] = [];
  for (const name of CONFLICT_ENV_KEYS) {
    if (dropped.has(name)) continue;
    const value = env[name];
    if (typeof value === 'string' && value.trim() !== '') present.push(name);
  }
  return present;
}

/** "CODEX_API_KEY" / "CODEX_API_KEY and OPENAI_API_KEY" / "CODEX_API_KEY, CODEX_ACCESS_TOKEN and ..." */
export function listKeys(keys: readonly string[]): string {
  if (keys.length === 0) return '';
  if (keys.length === 1) return keys[0];
  return `${keys.slice(0, -1).join(', ')} and ${keys[keys.length - 1]}`;
}

/** The sentence a conflict rejects with. Stable: the studio matches on it. */
export function conflictReason(keys: readonly string[]): string {
  return (
    `Codex is signed in, but ${listKeys(keys)} in this computer's environment is ` +
    'overriding that sign-in and OpenAI rejected it.'
  );
}

const NOT_FOUND = /failed to spawn codex|\bENOENT\b|command not found|is not recognized as an internal/i;
const TOO_OLD = /requires a newer version of Codex|is too old/i;
const USAGE_LIMIT = /usage limit/i;
const SIGNED_OUT = /not logged in|login required|run .{0,3}codex login|no credentials found/i;
const UNAUTHORIZED = /\b401\b|unauthorized/i;
const BAD_KEY = /incorrect api key provided|invalid_api_key|invalid api key/i;
const NETWORK =
  /ENOTFOUND|ECONNREFUSED|ECONNRESET|EAI_AGAIN|getaddrinfo|error sending request|dns error|tls handshake/i;
const NO_OUTPUT = /produced no output for \d+s/i;
const TIMED_OUT = /timed out after/i;
/** Our own conflict sentence, so classifying a message we already wrote is idempotent. */
const ALREADY_CONFLICT = /environment is overriding that sign-in/i;

export function classifyCodexFailure(input: {
  /** Whatever text is available: a stderr tail, a stdout tail, or an Error message we wrote. */
  text: string;
  env: NodeJS.ProcessEnv;
  /** Names the child was launched WITHOUT. */
  ignored?: readonly string[];
}): CodexFailure {
  const text = input.text ?? '';
  const conflictKeys = presentConflictKeys(input.env, input.ignored);
  const at = (code: CodexFailureCode, reason: string): CodexFailure => ({ code, conflictKeys, reason });

  if (ALREADY_CONFLICT.test(text)) return at('CODEX_AUTH_CONFLICT', conflictReason(conflictKeys));
  if (NOT_FOUND.test(text)) return at('CODEX_NOT_FOUND', 'Codex CLI is not installed on this computer.');
  if (TOO_OLD.test(text)) return at('CODEX_VERSION_TOO_OLD', 'Codex CLI on this computer is too old.');
  // A used-up plan is not a broken connection, and turning the engine off for
  // it would be a worse bug than the one this module exists for.
  if (USAGE_LIMIT.test(text)) return at('CODEX_USAGE_LIMIT', "Your Codex plan's usage limit is used up.");
  if (SIGNED_OUT.test(text)) return at('CODEX_NOT_AUTHENTICATED', 'Codex CLI is signed out on this computer.');
  if (UNAUTHORIZED.test(text)) {
    // All three halves are required. A 401 without the bad-key wording is a
    // refused session; a bad key with nothing set here is not ours to blame.
    if (BAD_KEY.test(text) && conflictKeys.length > 0) return at('CODEX_AUTH_CONFLICT', conflictReason(conflictKeys));
    return at('CODEX_401', 'OpenAI did not accept the Codex sign-in on this computer.');
  }
  if (NETWORK.test(text)) return at('NETWORK_FAILURE', 'Codex could not reach OpenAI.');
  if (NO_OUTPUT.test(text)) return at('CODEX_NO_OUTPUT', 'Codex never started answering.');
  if (TIMED_OUT.test(text)) return at('CODEX_TIMEOUT', 'Codex ran out of time.');
  if (text.trim() !== '') return at('CODEX_EXECUTION_FAILED', 'Codex stopped with an error.');
  return at('UNKNOWN', 'Codex stopped for a reason it did not give.');
}
