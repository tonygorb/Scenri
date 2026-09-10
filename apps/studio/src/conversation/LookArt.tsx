import type { CSSProperties } from 'react';

/**
 * The figure on a look tile.
 *
 * Hair length and build are shapes, not words: "chin-length" and "slender" are
 * quicker to recognise than to read. Each is one cell of a sheet drawn once for
 * the whole row, so every tile in a row shares a hand and the whole row costs
 * one small file. The sheets live in `assets/look`; the cell is chosen by where
 * the option sits in its row.
 */

/** Where each option sits on its sheet, left to right and top to bottom. */
const CELL: Record<string, Record<string, [number, number]>> = {
  hair: {
    buzzed: [0, 0],
    cropped: [1, 0],
    short: [2, 0],
    'chin-length': [0, 1],
    'shoulder-length': [1, 1],
    long: [2, 1],
  },
  build: {
    slender: [0, 0],
    average: [1, 0],
    athletic: [0, 1],
    fuller: [1, 1],
  },
};

export function LookArt({ kind, id, who }: { kind: 'hair' | 'build'; id: string; who?: string }) {
  const [x, y] = CELL[kind]?.[id] ?? [0, 0];
  // a man's hair on a man's head: the figures follow who is being made, and
  // anyone who has not said stands with the fuller of the two
  const cast = who === 'man' ? 'man' : 'woman';
  return (
    <span
      className="sc-look-art"
      data-kind={kind}
      data-cast={cast}
      style={{ '--sc-look-x': x, '--sc-look-y': y } as CSSProperties}
      aria-hidden="true"
    />
  );
}
