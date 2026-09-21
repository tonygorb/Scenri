import type { FeedNode, Scene } from './apiTypes.js';

export function hasNoShots(nodes: FeedNode[]): boolean {
  return nodes.every((n) => n.kind === 'root');
}

/**
 * Legacy scene display names mapped to the name that scene answers to now.
 *
 * A node's prompt is written once and never rewritten, so a shot made before a
 * scene was renamed carries the old name inside its `[Scene Name]` bracket
 * forever. That is right as a record of the text actually sent to the engine,
 * and wrong as a title in today's UI. `nodeLabel` consults this to show the
 * current name without rewriting a single stored prompt.
 *
 * A registry rather than a parameter on purpose: all thirteen `nodeLabel` call
 * sites want the same answer, most are deep in leaf components, and none of
 * them owns the scene catalog. Populated once from `useScenes`.
 */
let sceneNameAliases: ReadonlyMap<string, string> = new Map();

/** Rebuild the legacy-name map from the scene catalog. Called by `useScenes`. */
export function registerSceneNameAliases(scenes: Pick<Scene, 'name' | 'legacyNames'>[]): void {
  const m = new Map<string, string>();
  for (const s of scenes) {
    for (const legacy of s.legacyNames ?? []) if (legacy !== s.name) m.set(legacy, s.name);
  }
  sceneNameAliases = m;
}

/**
 * A name someone chose: the scene bracket, or the text-lift shorthand.
 * First words of a prompt are not this.
 */
export function nodeName(n: Pick<FeedNode, 'promptHead'>): string | undefined {
  const head = n.promptHead ?? '';
  const tag = /^\[([^\]]+)\]/.exec(head)?.[1];
  if (tag) return sceneNameAliases.get(tag) ?? tag;
  if (head.startsWith('Remove all overlaid marketing text') || head.startsWith('Remove ALL text')) return 'Text lift';
  return undefined;
}

/** Human title for a node: a name if it has one, otherwise first words of the prompt. */
export function nodeLabel(n: Pick<FeedNode, 'promptHead' | 'kind'>): string {
  // the head of the prompt is all a title ever needed; the whole prompt stays
  // on the server until one shot is opened
  const named = nodeName(n);
  if (named) return named;
  const words = (n.promptHead ?? '').trim().split(/\s+/).slice(0, 6).join(' ');
  return words || (n.kind === 'edit' ? 'Edit' : 'Generation');
}
