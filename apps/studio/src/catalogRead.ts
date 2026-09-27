/**
 * Two things the four catalog hooks (useScenes, usePresenters, useDemoProducts,
 * useShowcase) share now that they are read again as library pictures land.
 */

/**
 * The held answer when a re-read says exactly the same, so the catalogs
 * untouched by a landing keep their reference and re-render nothing.
 */
export function keepIfSame<T>(held: T, next: T): T {
  return JSON.stringify(held) === JSON.stringify(next) ? held : next;
}

/** Tell whoever waits on a re-read that one has settled (see each hook's refetch). */
export function release(waiting: { current: (() => void)[] }): void {
  const ready = waiting.current;
  waiting.current = [];
  for (const resolve of ready) resolve();
}
