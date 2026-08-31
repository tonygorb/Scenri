import type { TreeNode } from './api.js';
import type { TokenNames } from './feedRules.js';

/**
 * What changed between a shot and the one it came from.
 *
 * Two refinements of the same setup are told apart by their pictures alone,
 * which after twenty minutes of work is not enough: "warmer light" and "lower
 * camera angle" read as two nearly identical frames with no record of the
 * instruction that separates them. Both briefs are already stored on their
 * shots, so the difference can simply be read rather than remembered.
 *
 * Deliberately plain: this names the ingredient that moved, not every token
 * that shifted position. Rewording the prose is one change however many words
 * moved, and a sentence that lists nine things is one nobody reads.
 */

type Brief = TreeNode['brief'];

interface Tok {
  t: string;
  id?: string;
  v?: string;
  hex?: string;
  name?: string;
  imageHash?: string;
}

const tokens = (b: Brief): Tok[] => ((b?.tokens ?? []) as Tok[]).filter((t) => t && typeof t.t === 'string');

/**
 * A brief's whole context: its own tokens plus what it inherited from the
 * shot it refines. The change line diffs against this, or a refinement that
 * CARRIED the parent's mark read as "1 brand mark removed".
 */
const contextTokens = (b: Brief): Tok[] => [
  ...tokens(b),
  ...(((b as { inherited?: unknown })?.inherited ?? []) as Tok[]).filter((t) => t && typeof t.t === 'string'),
];

const idsOf = (b: Brief, kind: string): string[] =>
  contextTokens(b)
    .filter((t) => t.t === kind && typeof t.id === 'string')
    .map((t) => t.id as string);

const proseOf = (b: Brief): string =>
  tokens(b)
    .filter((t) => t.t === 'text')
    .map((t) => (typeof t.v === 'string' ? t.v : ''))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();

const countOf = (b: Brief, kind: string): number => contextTokens(b).filter((t) => t.t === kind).length;

/** A name if the catalog still knows it, else something honest and short. */
const label = (id: string, resolve: (id: string) => string | null, fallback: string): string => resolve(id) ?? fallback;

/**
 * One short phrase per ingredient that moved, in the order a person would
 * notice them: what it is, who is in it, where it is, then how it was said.
 *
 * Returns an empty array when the two briefs describe the same setup, and when
 * either shot predates briefs entirely — an unknown before is not a change.
 */
export function briefChanges(from: Brief, to: Brief, names: TokenNames): string[] {
  if (!from || !to) return [];
  const out: string[] = [];

  const swapped = (kind: string, resolve: (id: string) => string | null, noun: string, missing: string) => {
    const a = idsOf(from, kind);
    const b = idsOf(to, kind);
    const added = b.filter((id) => !a.includes(id));
    const gone = a.filter((id) => !b.includes(id));
    if (!added.length && !gone.length) return;
    // one out, one in reads as a swap, which is what it is
    if (added.length === 1 && gone.length === 1) {
      out.push(`${noun} ${label(gone[0], resolve, missing)} to ${label(added[0], resolve, missing)}`);
      return;
    }
    for (const id of added) out.push(`${noun} ${label(id, resolve, missing)} added`);
    for (const id of gone) out.push(`${noun} ${label(id, resolve, missing)} removed`);
  };

  swapped('product', names.product, 'product', 'a product');
  swapped('character', names.person, 'presenter', 'a presenter');
  swapped('template', names.scene, 'scene', 'a scene');

  // colours and references are counted rather than named: a hex is not a thing
  // anyone recognises in a sentence, and "two references" is the useful fact
  for (const [kind, noun] of [
    ['color', 'colour'],
    ['ref', 'reference'],
    ['mark', 'brand mark'],
  ] as const) {
    const a = countOf(from, kind);
    const b = countOf(to, kind);
    if (a === b) continue;
    const n = Math.abs(b - a);
    const plural = n === 1 ? noun : `${noun}s`;
    out.push(b > a ? `${n} ${plural} added` : `${n} ${plural} removed`);
  }

  const beforeProse = proseOf(from);
  const afterProse = proseOf(to);
  if (beforeProse !== afterProse) {
    // the instruction itself, when there is one and it is short enough to read
    // at a glance; otherwise say that it changed and let the shot speak
    out.push(afterProse && afterProse.length <= 60 ? `“${afterProse}”` : 'wording changed');
  }

  return out;
}

/** The same thing as one line, or null when there is nothing worth saying. */
export function briefChangeLine(from: Brief, to: Brief, names: TokenNames): string | null {
  const parts = briefChanges(from, to, names);
  if (!parts.length) return null;
  // three is the most a glance carries; the rest is left to the picture
  const shown = parts.slice(0, 3);
  const rest = parts.length - shown.length;
  return `Changed: ${shown.join(', ')}${rest > 0 ? `, and ${rest} more` : ''}`;
}

/**
 * The image a refinement was actually made from.
 *
 * A run holds several images and a refinement is made from exactly one of
 * them. The server records which; before it did, every surface fell back to
 * the first, so a refinement of variant three showed variant one as its
 * source, Compare measured drift against a picture the edit never touched, and
 * Try again re-ran it from the wrong frame. The fallback stays for shots made
 * before the source was recorded — it is a guess, and the only one available.
 */
export function sourceImageOf(node: TreeNode, parent: TreeNode | null | undefined): string | undefined {
  const recorded = node.brief?.sourceImage;
  if (recorded && parent?.images.includes(recorded)) return recorded;
  return parent?.images[0];
}

/**
 * Only the words that were typed, with the chips left out.
 *
 * The shot record states its ingredients once, as a chip row; repeating their
 * names inside the prose said everything twice. The compiled prompt stays the
 * fallback for shots made before briefs were stored — for those it is the only
 * record there is.
 */
export function briefSaid(node: TreeNode): string {
  // The compiled-prompt fallback is only for shots with no brief at all: a
  // chips-only brief typed no words, and printing the compiler's wall of
  // directives under its chip row would say what nobody wrote.
  if (tokens(node.brief).length) return proseOf(node.brief);
  return node.prompt || '';
}

/**
 * What the person actually asked for.
 *
 * `node.prompt` is the compiled prompt: their sentence plus every directive the
 * compiler adds — product fidelity, preservation notes, brand rules, scene
 * guards. Shown as "Brief" it reads as a wall of instructions nobody wrote, and
 * it is the internals of the generator on a screen about a photograph. The
 * sentence they typed is in the brief's own text tokens; the compiled prompt is
 * the fallback for shots made before briefs were stored.
 */
export function briefProse(node: TreeNode, names: ProseNames): string {
  // Walk the tokens in order and speak every chip by name. Keeping only the
  // text runs left literal holes where the chips sat: "add this logo to the ."
  // — a sentence with its nouns removed.
  const said = tokens(node.brief)
    .map((t) => {
      switch (t.t) {
        case 'text':
          return typeof t.v === 'string' ? t.v : '';
        case 'product':
          return names.product(String(t.id)) ?? 'a product';
        case 'character':
          return names.person(String(t.id)) ?? 'a presenter';
        case 'template':
          return names.scene(String(t.id)) ?? 'a scene';
        case 'color':
          return String(t.name ?? t.hex ?? '');
        case 'ref':
          return 'the attached reference';
        case 'mark':
          return names.mark?.(String(t.imageHash)) ?? 'the brand mark';
        default:
          return '';
      }
    })
    .join(' ')
    .replace(/\s+/g, ' ')
    .replace(/\s+([.,!?;:])/g, '$1')
    .trim();
  return said || node.prompt || '';
}

/** The resolvers briefProse speaks with: TokenNames plus the brand's marks. */
export interface ProseNames {
  product(id: string): string | null;
  person(id: string): string | null;
  scene(id: string): string | null;
  mark?(hash: string): string | null;
}
