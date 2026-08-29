import { describe, it, expect } from 'vitest';
import { describeCancelled, describeFailure, failureToast } from '../src/failure.js';

/**
 * Every `raw` in here is a string this repo actually throws, copied from the
 * place that throws it. A humaniser tested against invented inputs is a
 * humaniser that works on invented inputs.
 */
const REAL = {
  openrouter401:
    'OpenRouter request failed: HTTP 401: {"error":{"message":"Missing Authentication header","code":401}}',
  fal500: 'fal.ai request failed: HTTP 500: {"detail":"Internal Server Error"}',
  spendCap: 'Spend cap for openrouter: $10.00/mo. Spent $9.80, next ~$0.40 would exceed it.',
  aspect: 'engine returned 1024x1024 for a 1024x1280 request: this engine cannot produce the requested aspect ratio',
  references:
    'Codex cannot carry enough reference images, so Acme Kettle would be named in the prompt but never shown. The result would not be your product. Choose an engine that supports reference images, or remove Acme Kettle from the brief.',
  spawn: 'Failed to spawn codex: spawn codex ENOENT',
  codexTimeout: 'Codex CLI timed out after 600000ms',
  codexAbort: 'Codex CLI run aborted',
  codexEmpty: 'Codex finished but produced no images',
  restarted: 'interrupted: server restarted mid-generation',
  exitCode: 'codex exited with code 1: some unrecognised gibberish',
  codexSignedOut: 'codex exited with code 1: Not logged in',
  codexUnverified: 'Could not verify Codex on this computer',
  codexTooOld: 'Codex CLI 0.140.0 is too old. Scenri needs 0.145.0 or newer.',
  codexSilent: 'Codex CLI produced no output for 120s, treating it as stuck',
  codexNeverStarted: 'Codex CLI produced no output for 60s after launch, treating it as stuck',
  codexAuthMidJob: 'codex exited with code 1: ERROR: unexpected status 401 Unauthorized',
  codexExitSaysTimeout: 'codex exited with code 124: timeout',
  nodeBudget: 'generation timed out after 11 minutes',
  replicateTimeout: 'Replicate prediction timed out after 300000ms',
};

describe('describeFailure', () => {
  it('names the missing key, and does not offer a retry that cannot work', () => {
    const f = describeFailure(REAL.openrouter401, 'OpenRouter');
    expect(f.kind).toBe('auth');
    expect(f.title).toBe('OpenRouter did not accept your API key.');
    expect(f.fix).toBe('Add or replace the key, then run this again.');
    expect(f.remedy).toEqual({ label: 'Add key', opens: 'engines' });
    expect(f.retryable).toBe(false);
  });

  it('keeps the raw text byte for byte, so a bug report still has it', () => {
    expect(describeFailure(REAL.openrouter401, 'OpenRouter').raw).toBe(REAL.openrouter401);
  });

  it('reads a 403 as a key that does not cover this', () => {
    const f = describeFailure('HTTP 403: forbidden', 'OpenRouter');
    expect(f.kind).toBe('auth');
    expect(f.title).toBe('OpenRouter refused this key.');
    expect(f.retryable).toBe(false);
  });

  it("sends Scenri's own spend cap to the budget pane, not the provider", () => {
    const f = describeFailure(REAL.spendCap, 'OpenRouter');
    expect(f.kind).toBe('budget');
    expect(f.title).toBe('This would go past your monthly cap for OpenRouter.');
    expect(f.remedy).toEqual({ label: 'Open budget', opens: 'budget' });
    expect(f.retryable).toBe(false);
  });

  it('separates the provider running dry from our own cap', () => {
    const f = describeFailure('HTTP 402: insufficient credit', 'OpenRouter');
    expect(f.kind).toBe('credit');
    expect(f.remedy?.opens).toBe('engines');
  });

  it('a rate limit is the one money-adjacent failure worth retrying', () => {
    const f = describeFailure('HTTP 429: rate limit exceeded', 'OpenRouter');
    expect(f.kind).toBe('rate');
    expect(f.retryable).toBe(true);
    expect(f.remedy).toBeUndefined();
  });

  it('tells a declined brief to be reworded rather than re-run', () => {
    const f = describeFailure('flagged by the safety system', 'OpenRouter');
    expect(f.kind).toBe('policy');
    expect(f.title).toBe('OpenRouter declined this brief.');
    expect(f.retryable).toBe(false);
  });

  it("passes the server's reference sentence through, because it names the ingredients", () => {
    const f = describeFailure(REAL.references, 'Codex');
    expect(f.kind).toBe('references');
    // The names are the useful half — losing them to our own shorter wording
    // would leave "this engine cannot do references" and nothing actionable.
    expect(f.title).toContain('Acme Kettle');
    expect(f.remedy?.opens).toBe('engines');
  });

  it("reads the server's delivered-shape check as a format problem", () => {
    const f = describeFailure(REAL.aspect, 'OpenRouter');
    expect(f.kind).toBe('format');
    expect(f.title).toBe('OpenRouter cannot make this shape.');
    expect(f.retryable).toBe(false);
  });

  it('does not let a 404 swallow the more specific capability failures', () => {
    expect(describeFailure('HTTP 404: model not found', 'OpenRouter').kind).toBe('model');
    // both of these contain no 404, but they used to be reachable only if the
    // generic rules were ordered after them
    expect(describeFailure(REAL.aspect, 'OpenRouter').kind).toBe('format');
    expect(describeFailure(REAL.references, 'Codex').kind).toBe('references');
  });

  it('routes a missing codex binary to the setup wizard, not to Settings', () => {
    const f = describeFailure(REAL.spawn, 'Codex');
    expect(f.kind).toBe('setup');
    expect(f.title).toBe('Codex is not installed on this machine.');
    expect(f.remedy).toEqual({ label: 'Set up Codex', opens: 'setup' });
  });

  it('reads the codex timeout, abort and empty-handed cases', () => {
    expect(describeFailure(REAL.codexTimeout, 'Codex').kind).toBe('timeout');
    expect(describeFailure(REAL.codexAbort, 'Codex').kind).toBe('cancelled');
    expect(describeFailure(REAL.codexEmpty, 'Codex').kind).toBe('empty');
    expect(describeFailure(REAL.codexEmpty, 'Codex').retryable).toBe(true);
  });

  it('names which budget was blown instead of one generic "took too long"', () => {
    const cap = describeFailure(REAL.codexTimeout, 'Codex');
    expect(cap.kind).toBe('timeout');
    expect(cap.title).toBe('Codex ran out of time on this shot.');
    const guard = describeFailure(REAL.codexNeverStarted, 'Codex');
    expect(guard.kind).toBe('timeout');
    expect(guard.title).toBe('Codex never started answering.');
    const node = describeFailure(REAL.nodeBudget, 'Codex');
    expect(node.kind).toBe('timeout');
    expect(node.title).toBe('This run hit the overall time limit.');
    // other engines keep the generic copy
    const rep = describeFailure(REAL.replicateTimeout, 'Replicate');
    expect(rep.kind).toBe('timeout');
    expect(rep.title).toBe('Replicate took too long to answer.');
  });

  it('reads a mid-job 401 as a sign-in, not as an API-key problem', () => {
    const f = describeFailure(REAL.codexAuthMidJob, 'Codex');
    expect(f.kind).toBe('auth');
    expect(f.title).toBe('Codex is signed out on this machine.');
    expect(f.remedy).toEqual({ label: 'Sign in', opens: 'setup' });
  });

  it('does not read the word "timeout" in codex stderr as our own timeout', () => {
    expect(describeFailure(REAL.codexExitSaysTimeout, 'Codex').kind).toBe('unknown');
  });

  it('reads a signed-out codex as a sign-in, not a mystery exit code', () => {
    const f = describeFailure(REAL.codexSignedOut, 'Codex');
    expect(f.kind).toBe('auth');
    expect(f.title).toBe('Codex is signed out on this machine.');
    expect(f.remedy).toEqual({ label: 'Sign in', opens: 'setup' });
    expect(f.retryable).toBe(false);
  });

  it('reads an unverifiable codex as a check, with the restart hint', () => {
    const f = describeFailure(REAL.codexUnverified, 'Codex');
    expect(f.kind).toBe('setup');
    expect(f.title).toBe('Scenri could not verify Codex.');
    expect(f.fix).toContain('restart Scenri');
    expect(f.remedy).toEqual({ label: 'Check Codex', opens: 'setup' });
    expect(f.retryable).toBe(true);
  });

  it('reads a below-floor codex as an update, never as not installed', () => {
    const f = describeFailure(REAL.codexTooOld, 'Codex');
    expect(f.kind).toBe('setup');
    expect(f.title).toBe('Codex CLI needs an update.');
    expect(f.remedy).toEqual({ label: 'Update Codex', opens: 'setup' });
    expect(f.retryable).toBe(false);
  });

  it('treats codex silence as a timeout the user can retry, old records included', () => {
    // The pre-0.6.6 inactivity-kill wording still lives in stored failures.
    const f = describeFailure(REAL.codexSilent, 'Codex');
    expect(f.kind).toBe('timeout');
    expect(f.title).toBe('Codex never started answering.');
    expect(f.retryable).toBe(true);
  });

  it('says a restart lost the shot but not the brief', () => {
    const f = describeFailure(REAL.restarted, 'Codex');
    expect(f.kind).toBe('restarted');
    expect(f.title).toBe('Scenri restarted while this was rendering.');
    expect(f.retryable).toBe(true);
    // Rows written by older builds keep the em-dash form in the DB forever.
    expect(describeFailure('interrupted — server restarted mid-generation', 'Codex').kind).toBe('restarted');
  });

  it('reads 5xx as their problem, and offers the retry that goes with that', () => {
    const f = describeFailure(REAL.fal500, 'fal.ai');
    expect(f.kind).toBe('server');
    expect(f.title).toBe('fal.ai had a problem on its end.');
    expect(f.retryable).toBe(true);
  });

  it('reads the node-level network errors', () => {
    expect(describeFailure('fetch failed: ECONNREFUSED', 'OpenRouter').kind).toBe('network');
    expect(describeFailure('getaddrinfo ENOTFOUND openrouter.ai').title).toBe('Could not reach the engine.');
  });

  it('falls through rather than guessing, and stays retryable', () => {
    const f = describeFailure(REAL.exitCode, 'Codex');
    expect(f.kind).toBe('unknown');
    expect(f.title).toBe('This shot did not finish.');
    expect(f.fix).toBeUndefined();
    expect(f.raw).toBe(REAL.exitCode);
    expect(f.retryable).toBe(true);
  });

  it('survives no error text at all', () => {
    for (const raw of [null, undefined, '', '   ']) {
      const f = describeFailure(raw, 'OpenRouter');
      expect(f.kind).toBe('unknown');
      expect(f.raw).toBe('');
      expect(f.retryable).toBe(true);
    }
  });

  it('capitalises the fallback rather than saying "the engine did not accept"', () => {
    expect(describeFailure(REAL.openrouter401).title).toBe('The engine did not accept your API key.');
    // mid-sentence it stays lower case
    expect(describeFailure('ECONNREFUSED').title).toBe('Could not reach the engine.');
  });

  it('drops the BYOK suffix, which is a billing fact and not a name', () => {
    expect(describeFailure(REAL.openrouter401, 'OpenRouter (BYOK)').title).toBe(
      'OpenRouter did not accept your API key.',
    );
  });
});

describe('describeCancelled', () => {
  it('is not phrased as a failure, because it was on purpose', () => {
    const f = describeCancelled();
    expect(f.kind).toBe('cancelled');
    expect(f.title).toBe('You stopped this shot.');
    expect(f.retryable).toBe(true);
    expect(f.raw).toBe('');
  });
});

describe('failureToast', () => {
  it("keeps the caller's headline, because only it knows which action failed", () => {
    const t = failureToast(new Error(REAL.openrouter401), 'Could not run this again', 'OpenRouter');
    expect(t.kind).toBe('error');
    expect(t.title).toBe('Could not run this again');
    expect(t.detail).toBe('OpenRouter did not accept your API key. Add or replace the key, then run this again.');
  });

  it('does not restate a headline it cannot improve on', () => {
    const t = failureToast(new Error(REAL.exitCode), 'Could not archive this shot');
    // "This shot did not finish" under "Could not archive this shot" is two
    // sentences that between them say nothing, so the raw text is better here
    expect(t.detail).toBe(REAL.exitCode);
  });

  it('takes a thrown string or a bare object as readily as an Error', () => {
    expect(failureToast('HTTP 429 rate limit', 'Nope', 'OpenRouter').detail).toContain('rate limiting');
    expect(failureToast({ message: 'HTTP 429 rate limit' }, 'Nope', 'OpenRouter').detail).toContain('rate limiting');
  });
});
