import type { Core } from '@scenri/core';

/**
 * What one of the brand's own shots showed, in words, for a reference whose
 * photo found no seat: the head of the shot's recorded prompt, which opens
 * with the brief as the user wrote it (the chips' names and the prose)
 * before the compiler's directives begin.
 */
export function shotWords(prompt: string | null | undefined, max = 160): string | null {
  if (!prompt) return null;
  // the brief's own words end where the first directive sentence starts
  const head = prompt.split(/\. (?=[A-Z])/)[0]?.trim() ?? '';
  if (!head) return null;
  const clipped = head.length > max ? `${head.slice(0, max).replace(/\s+\S*$/, '')}…` : head;
  return clipped.replace(/[.\s]+$/, '');
}

/**
 * A lookup from image hash to the words of the shot it came from. Read
 * lazily, one indexed row per hash: most briefs carry no seatless reference,
 * and a brand can hold thousands of shots.
 */
export function shotWordsFor(core: Core, brandId: string): (hash: string) => string | null {
  // one read per hash asked, remembered for the compile; this used to read
  // every shot in the brand to answer for one reference
  const byHash = new Map<string, string | null>();
  return (hash) => {
    if (!byHash.has(hash)) byHash.set(hash, shotWords(core.store.promptForImage(brandId, hash)));
    return byHash.get(hash) ?? null;
  };
}
