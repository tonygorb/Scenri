import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * A composer that cannot be answered says why in its placeholder ("Add their
 * photos above.", "Retry above."). The global `.sc-in:disabled` fades the
 * whole field to --sc-disabled, on top of the --sc-fg3 the placeholder already
 * is. The composer's own rule undoes the fade, and outranks the global one by
 * its longer selector wherever the two sit in the manifest.
 */
const CSS = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'styles', 'components', 'conversation.css'),
  'utf8',
).replace(/\/\*[\s\S]*?\*\//g, '');

function block(selector: string): string | undefined {
  const at = CSS.indexOf(`${selector} {`);
  return at < 0 ? undefined : CSS.slice(at, CSS.indexOf('}', at));
}

describe('the disabled composer', () => {
  it('shows its reason at the placeholder grey, never faded below it', () => {
    expect(block('.sc-convo-card textarea.sc-in::placeholder')).toMatch(/color:\s*var\(--sc-fg3\)/);
    const off = block('.sc-convo-card textarea.sc-in:disabled');
    expect(off).toMatch(/opacity:\s*1;/);
    expect(off).toMatch(/color:\s*var\(--sc-fg3\)/);
  });
});
