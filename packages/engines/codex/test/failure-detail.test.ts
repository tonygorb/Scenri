import { describe, expect, it } from 'vitest';
import { codexFailureDetail } from '../src/run.js';

/**
 * A codex failure has to say why it failed.
 *
 * It used to say the opposite. The rule was "first 200 characters of stderr",
 * and codex writes a session banner before it does any work, so the banner
 * filled the 200 and the error behind it was cut off. A Windows tester on
 * 2026-08-31 was shown this and nothing else:
 *
 *   codex exited with code 1: OpenAI Codex v0.151.0 --- workdir:
 *   C:\Users\...\scenri-codex-YSE2vF model: gpt-5.6-sol
 *
 * His real failure was a code-mode host that never started. These tests pin
 * the shape of the banner (captured live on v0.145.0) so that cannot recur.
 */
const BANNER =
  'OpenAI Codex v0.151.0\n--------\nworkdir: C:\\Users\\LENOVO\\AppData\\Local\\Temp\\scenri-codex-YSE2vF\n' +
  'model: gpt-5.6-sol\nprovider: openai\napproval: never\nsandbox: workspace-write [workdir, /tmp]\n' +
  'reasoning effort: low\n--------\n';

describe('codexFailureDetail', () => {
  it('keeps the error and drops the banner that used to hide it', () => {
    const detail = codexFailureDetail(`${BANNER}ERROR: code-mode host exited during handshake\n`, '');
    expect(detail).toBe('ERROR: code-mode host exited during handshake');
    expect(detail).not.toContain('workdir:');
    expect(detail).not.toContain('gpt-5.6-sol');
  });

  it('takes the last ERROR line when the prompt echo sits between it and the banner', () => {
    const stderr =
      `${BANNER}user\nGenerate one professional-grade image immediately\n` +
      'ERROR: stream disconnected before completion\n';
    expect(codexFailureDetail(stderr, '')).toBe('ERROR: stream disconnected before completion');
  });

  it('falls back to the tail when codex marks nothing', () => {
    expect(codexFailureDetail(`${BANNER}something went sideways\n`, '')).toBe('something went sideways');
  });

  it('reads stdout when stderr is banner and nothing else', () => {
    expect(codexFailureDetail(BANNER, 'tool call failed: image_gen unavailable')).toBe(
      'tool call failed: image_gen unavailable',
    );
  });

  it('passes a plain stderr through untouched', () => {
    expect(codexFailureDetail('not signed in', '')).toBe('not signed in');
  });

  it('caps the detail and starts it on a line boundary', () => {
    const noise = Array.from({ length: 400 }, (_, i) => `line ${i} of codex chatter`).join('\n');
    const detail = codexFailureDetail(`${BANNER}${noise}\nERROR: ${'x'.repeat(2000)}\n`, '');
    expect(detail.length).toBeLessThanOrEqual(800);
    expect(detail.startsWith('line ')).toBe(false);
  });

  it('says something rather than nothing when there is only a banner', () => {
    expect(codexFailureDetail(BANNER, '')).toContain('OpenAI Codex');
  });
});
