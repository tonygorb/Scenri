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
 * A lookup from image hash to the words of the shot it came from, over every
 * project of one brand. Built once per compile and read lazily: most briefs
 * carry no seatless reference, and a brand can hold hundreds of shots.
 */
export function shotWordsFor(core: Core, brandId: string): (hash: string) => string | null {
  let byHash: Map<string, string> | null = null;
  return (hash) => {
    if (!byHash) {
      byHash = new Map();
      for (const p of core.store.listProjects(brandId)) {
        for (const n of core.store.treeFor(p.id)) {
          const words = shotWords(n.prompt);
          if (!words) continue;
          for (const h of n.images ?? []) if (!byHash.has(h)) byHash.set(h, words);
        }
      }
    }
    return byHash.get(hash) ?? null;
  };
}
