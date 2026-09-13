import { describe, expect, it } from 'vitest';
import { classifyCodexFailure, conflictReason, presentConflictKeys } from '../src/classify.js';

/**
 * The string every case here is written against, captured live from
 * codex-cli 0.153.4 on macOS, 2026-09-13, with a bogus CODEX_API_KEY exported
 * and a healthy ChatGPT sign-in in ~/.codex/auth.json:
 *
 *   ERROR: unexpected status 401 Unauthorized: Incorrect API key provided:
 *   sk-proj-****s000. You can find your API key at ...
 *
 * `codex login status` printed "Logged in using ChatGPT" and exited 0 in the
 * same shell, which is the whole reason this module exists.
 */
const CONFLICT_401 =
  'codex exited with code 1: ERROR: unexpected status 401 Unauthorized: Incorrect API key provided: sk-proj-****s000. You can find your API key at https://platform.openai.com/account/api-keys.';

describe('presentConflictKeys', () => {
  it('names only what is set, in codex precedence order', () => {
    expect(presentConflictKeys({ OPENAI_API_KEY: 'x', CODEX_API_KEY: 'y' })).toEqual([
      'CODEX_API_KEY',
      'OPENAI_API_KEY',
    ]);
  });

  it('ignores empty and whitespace values, which are not credentials', () => {
    expect(presentConflictKeys({ CODEX_API_KEY: '', CODEX_ACCESS_TOKEN: '   ' })).toEqual([]);
  });

  // A variable Scenri already keeps out of the child cannot be what the child
  // tripped over. Without this a repaired machine blames the key forever.
  it('does not name a key that is already being kept out of the child', () => {
    expect(presentConflictKeys({ CODEX_API_KEY: 'y' }, ['CODEX_API_KEY'])).toEqual([]);
  });
});

describe('classifyCodexFailure', () => {
  it('calls the measured 401 a conflict when a key is set here', () => {
    const f = classifyCodexFailure({ text: CONFLICT_401, env: { CODEX_API_KEY: 'sk-proj-x' } });
    expect(f.code).toBe('CODEX_AUTH_CONFLICT');
    expect(f.conflictKeys).toEqual(['CODEX_API_KEY']);
    expect(f.reason).toBe(conflictReason(['CODEX_API_KEY']));
    // Names only. The masked fragment codex prints is not something to repeat.
    expect(f.reason).not.toContain('sk-proj');
  });

  it('calls the same 401 a refused session when nothing here could explain it', () => {
    expect(classifyCodexFailure({ text: CONFLICT_401, env: {} }).code).toBe('CODEX_401');
  });

  it('stops blaming the key once Scenri is already dropping it', () => {
    const f = classifyCodexFailure({
      text: CONFLICT_401,
      env: { CODEX_API_KEY: 'sk-proj-x' },
      ignored: ['CODEX_API_KEY'],
    });
    expect(f.code).toBe('CODEX_401');
    expect(f.conflictKeys).toEqual([]);
  });

  it('reads our own conflict sentence back as a conflict', () => {
    const f = classifyCodexFailure({ text: conflictReason(['CODEX_API_KEY']), env: { CODEX_API_KEY: 'x' } });
    expect(f.code).toBe('CODEX_AUTH_CONFLICT');
  });

  it('keeps a signed-out codex signed out, even with a key set', () => {
    const f = classifyCodexFailure({ text: 'ERROR: Not logged in. Run codex login.', env: { CODEX_API_KEY: 'x' } });
    expect(f.code).toBe('CODEX_NOT_AUTHENTICATED');
  });

  it.each([
    ['Failed to spawn codex: spawn codex ENOENT', 'CODEX_NOT_FOUND'],
    ["ERROR: The 'gpt-6-astra' model requires a newer version of Codex", 'CODEX_VERSION_TOO_OLD'],
    ["ERROR: You've hit your usage limit. Upgrade to Pro", 'CODEX_USAGE_LIMIT'],
    ['error sending request for url', 'NETWORK_FAILURE'],
    ['Codex CLI produced no output for 60s after launch', 'CODEX_NO_OUTPUT'],
    ['Codex CLI timed out after 300000ms', 'CODEX_TIMEOUT'],
    ['codex exited with code 3: rate limited', 'CODEX_EXECUTION_FAILED'],
    ['', 'UNKNOWN'],
  ])('reads %j as %s', (text, code) => {
    expect(classifyCodexFailure({ text, env: {} }).code).toBe(code);
  });
});
