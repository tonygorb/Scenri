/**
 * Pictures this session has already decoded, by src.
 *
 * A wall remounts its cards on every visit and the feed remounts a tile when it
 * hops column, and a remount used to replay the reveal: the picture went to
 * opacity 0 for a painted frame and faded back in, which is the page flashing.
 * Remembering the src lets the next mount load eagerly and call itself ready
 * before paint. One set for every surface, so a picture decoded on Home is
 * already known when the same card appears on Products.
 */
const ready = new Set<string>();

export function pictureIsReady(src: string): boolean {
  return ready.has(src);
}

export function markPictureReady(src: string): void {
  if (src) ready.add(src);
}
