/**
 * The two lines of plain fact on a scene's page.
 *
 * A scene's page used to answer "what is this place" with the analyzer's own
 * prose: a lighting sentence, a camera sentence, a figure sentence and eight
 * hundred characters of set description. All of it true, almost none of it
 * read. The line a person actually scans is the one every asset page in this
 * app already has, a few words joined by middots, and a scene has had the
 * words for it all along: `keywords` is written when the scene is read and has
 * never been shown anywhere.
 */

/** A scene, as far as these two lines are concerned. */
export interface FactualScene {
  keywords?: readonly string[];
  lighting?: string;
  verticals?: readonly string[];
  refs?: readonly string[];
  setups?: readonly { id: string }[];
}

/** How many of a scene's keywords the eye reads as a line rather than a list. */
const ATTRS_SHOWN = 5;
/** Fewer than this and the line says less than the lighting sentence does. */
const ATTRS_MIN = 3;

/**
 * What this place is, in a few words: `cyclorama · overhead · wide angle`.
 *
 * Empty when the scene has too few to be worth a line, which is the demo
 * engine's fixtures (they carry the single keyword "demo") and any record
 * written before the analyzer wrote keywords at all. The caller falls back to
 * the lighting sentence, which every scene has.
 */
export function sceneAttributes(scene: FactualScene): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of scene.keywords ?? []) {
    const word = String(raw ?? '').trim();
    if (!word) continue;
    const key = word.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(word);
    if (out.length === ATTRS_SHOWN) break;
  }
  return out.length >= ATTRS_MIN ? out : [];
}

/** The attribute line if there is one, else what the light does. */
export function sceneFactsLine(scene: FactualScene): string {
  const attrs = sceneAttributes(scene);
  return attrs.length > 0 ? attrs.join(' · ') : (scene.lighting ?? '').trim();
}

/**
 * The record's closing line: the facts nobody acts on, under the page rather
 * than in it. Empty when a scene carries none of them, and then the tail is
 * just the delete.
 */
export function sceneTailLine(scene: FactualScene): string {
  const parts: string[] = [];
  const filed = (scene.verticals ?? []).filter(Boolean);
  if (filed.length > 0) parts.push(`Filed under ${filed.join(', ')}`);
  const refs = scene.refs?.length ?? 0;
  if (refs > 0) parts.push(`read from ${refs} ${refs === 1 ? 'photograph' : 'photographs'}`);
  const ways = scene.setups?.length ?? 0;
  if (ways > 0) parts.push(`${ways} ${ways === 1 ? 'way' : 'ways'} to shoot it`);
  if (parts.length === 0) return '';
  const line = parts.join(' · ');
  return `${line.charAt(0).toUpperCase()}${line.slice(1)}.`;
}
