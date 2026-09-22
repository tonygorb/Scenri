/**
 * The closing line of a scene's page: the presenter page's footnote, for a place.
 *
 * What is true about the record and acted on by nobody: what its pictures are
 * (the one sentence a person cannot see for themselves), what it was read from
 * and how many ways it keeps. Where it is filed is not here: that is the chips
 * under the name, the way a presenter's are.
 */

/** A scene, as far as its closing line is concerned. */
export interface FactualScene {
  refs?: readonly string[];
  setups?: readonly { id: string }[];
}

/**
 * The record's closing line: the facts nobody acts on, under the page rather
 * than in it. Empty when a scene carries none of them, and then the tail is
 * just the delete.
 */
export function sceneTailLine(scene: FactualScene, about = ''): string {
  const parts: string[] = [];
  const refs = scene.refs?.length ?? 0;
  if (refs > 0) parts.push(`read from ${refs} ${refs === 1 ? 'photograph' : 'photographs'}`);
  const ways = scene.setups?.length ?? 0;
  if (ways > 0) parts.push(`${ways} ${ways === 1 ? 'way' : 'ways'} to shoot it`);
  const line = parts.join(' · ');
  const facts = line ? `${line.charAt(0).toUpperCase()}${line.slice(1)}.` : '';
  return [about.trim(), facts].filter(Boolean).join(' ');
}
