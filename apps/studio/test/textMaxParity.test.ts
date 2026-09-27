import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { COMPOSED_TEXT_MAX, TEXT_MAX } from '../src/conversation/textMax.js';

/**
 * The box and the record agree on how long a person's words may be.
 *
 * The chat composer stopped typing at 400 while the fields behind it cut
 * lower still, so a description was either refused mid-sentence or trimmed
 * in silence after it was sent (2026-09-27). One number now, said on both
 * sides of the wire; this holds them together.
 */
const here = dirname(fileURLToPath(import.meta.url));
const read = (...parts: string[]) => readFileSync(join(here, '..', ...parts), 'utf8');
const records = read('..', '..', 'packages', 'cli', 'src', 'assetRecords.ts');
const serverSays = (name: string): number => {
  const m = new RegExp(`export const ${name} = (\\d+);`).exec(records);
  if (!m) throw new Error(`the server no longer says ${name}`);
  return Number(m[1]);
};

describe('how long a person can type', () => {
  it('is the same number in the studio and on the server', () => {
    expect(TEXT_MAX).toBe(serverSays('TYPED_TEXT_MAX'));
    expect(COMPOSED_TEXT_MAX).toBe(serverSays('COMPOSED_TEXT_MAX'));
    expect(COMPOSED_TEXT_MAX).toBeGreaterThan(TEXT_MAX);
  });

  it('is the chat composer limit, not a number of its own', () => {
    const box = read('src', 'conversation', 'ConversationComposer.tsx');
    expect(box).toContain('maxLength={TEXT_MAX}');
    expect(box).not.toMatch(/maxLength=\{\d+\}/);
  });
});
