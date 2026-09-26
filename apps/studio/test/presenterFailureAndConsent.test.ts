import { describe, expect, it } from 'vitest';
import { attestText, photoUnreadable } from '../src/create/presenter/presenterCopy.js';
import { stoppedOrFailed } from '../src/create/presenter/presenterRecordTurns.js';

/**
 * What the creation conversation says about a failure and about where a real
 * person's photographs go. The raw strings are ones the engines really throw.
 */
const options = (q: ReturnType<typeof stoppedOrFailed>) => (q.kind === 'confirm' ? q.options : []);

describe('a view that could not be drawn', () => {
  it('says a signed-out Codex in words, with Sign in before Retry', () => {
    const q = stoppedOrFailed('portrait', 'codex exited with code 1: ERROR: unexpected status 401 Unauthorized');
    expect(q.prompt).toBe(
      'The face could not be drawn. Codex is signed out on this machine. Sign in with your ChatGPT account, then run this again.',
    );
    expect(options(q)).toEqual([
      { id: 'remedy:setup', label: 'Sign in' },
      { id: 'retry', label: 'Retry' },
    ]);
  });

  it('offers the key for a key that was refused', () => {
    const q = stoppedOrFailed('front', 'OpenRouter request failed: HTTP 401: {"error":{"code":401}}');
    expect(options(q)[0]).toEqual({ id: 'remedy:engines', label: 'Add key' });
  });

  it('keeps Retry alone where retrying can work', () => {
    const q = stoppedOrFailed('front', 'OpenRouter request failed: HTTP 429: {"error":{"code":429}}');
    expect(options(q)).toEqual([{ id: 'retry', label: 'Retry' }]);
  });

  it('never leaves a failure that can only repeat itself with Retry alone', () => {
    const q = stoppedOrFailed('portrait', 'codex exited with code 1: ERROR: code-mode host exited during handshake');
    expect(options(q).map((o) => o.id)).toEqual(['remedy:engines', 'retry']);
  });

  it('keeps the words of an error nothing recognises, and says what is kept', () => {
    expect(stoppedOrFailed('portrait', 'quota exceeded').prompt).toBe(
      'The face could not be drawn: quota exceeded. Everything else you had is kept.',
    );
  });
});

describe('the likeness confirmation', () => {
  it('names where the photographs go', () => {
    expect(attestText('OpenRouter (BYOK)')).toBe(
      "I have permission to use this person's likeness, and to send these photos to OpenRouter to draw them.",
    );
    expect(attestText('Codex CLI')).toContain('OpenAI, through Codex');
  });

  it('still says they leave when no engine is known', () => {
    expect(attestText(null)).toBe(
      "I have permission to use this person's likeness, and to send these photos to the engine that draws them.",
    );
  });
});

describe('a photograph the store could not read', () => {
  it('never promises HEIC, and says what to do with one', () => {
    expect(photoUnreadable('holiday.jpg')).not.toContain('HEIC');
    expect(photoUnreadable('IMG_0001.HEIC')).toBe(
      'IMG_0001.HEIC is a HEIC photo, which Scenri cannot read yet. Export it as JPEG and add that.',
    );
  });
});
