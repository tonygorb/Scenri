import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * A scene is a photographic setup: light, ground, mood. It never names a
 * product, because in a brief the product arrives as its own ingredient and
 * brings its own locked photo. Swap the subject and the scene still holds.
 */
export interface SceneField {
  key: string;
  label: string;
  placeholder?: string;
}
export interface TextZone {
  /** Scene field whose value seeds this editable layer. */
  fieldKey: string;
  x: number;
  y: number;
  width: number;
  size: number;
  align: 'left' | 'center' | 'right';
  weightHint?: number;
}
export type SceneSubject = 'product' | 'person' | 'either';

export interface Scene {
  id: string;
  /** What humans read. Free to change: nothing resolves by it. */
  name: string;
  /**
   * What the model reads, when the scene's name reaches the prompt at all
   * (the legacy `templateId` path brackets it at the head of the prompt).
   * Frozen at the naming migration to whatever `name` was then, so shortening
   * a display name can never alter a generated image. Falls back to `name`
   * for scenes authored since.
   */
  promptName?: string;
  /** Short phrase naming the light. Scenes relate to each other by this. */
  lighting: string;
  description: string;
  subject: SceneSubject;
  /** Themed groupings, e.g. "Studio", "Lived-in". */
  collections: string[];
  /** Industry filters, e.g. "Beauty", "Home". */
  verticals: string[];
  /** The set only. A scene carrying {product_name} is rejected at load. */
  prompt: string;
  /**
   * The scene's camera *tendency* — lens, distance, height, depth of field —
   * and nothing else. Optional and, deliberately, only a default: the compiler
   * emits it solely when the shot direction says nothing about camera, so a
   * recipe asking for an 85mm macro is never argued down by a scene that
   * happens to mention 50mm.
   *
   * Camera belongs to the shot. A scene owns the world: environment, materials,
   * light character. This field exists so a scene can still express what is
   * characteristic of it without locking every generation into one composition.
   * Absent on every scene today, so behaviour is unchanged until scenes migrate.
   */
  camera?: string;
  width: number;
  height: number;
  /** Ids this scene used to be called, so stored briefs keep resolving. */
  aliases?: string[];
  /**
   * Display names this scene used to carry. Two jobs: search still finds it by
   * the name someone remembers, and shot titles baked before a rename can be
   * translated forward. Distinct from `aliases`, which are *ids* — these are
   * human strings and are never used to resolve anything.
   */
  legacyNames?: string[];
  /**
   * Search vocabulary. Never rendered. This is what buys the right to a short
   * name: "Ice Core" stays findable by glacier, frozen, crystalline, skincare.
   */
  keywords?: string[];
  fields?: SceneField[];
  /** Zones the model leaves empty; text lands as editable overlay layers instead of baked pixels. */
  textZones?: TextZone[];
}

const SUBJECTS = new Set<SceneSubject>(['product', 'person', 'either']);
const ID = /^[a-z0-9-]+$/;

function isScene(x: any): x is Scene {
  return (
    x &&
    typeof x.id === 'string' &&
    ID.test(x.id) &&
    typeof x.name === 'string' &&
    typeof x.lighting === 'string' &&
    typeof x.description === 'string' &&
    SUBJECTS.has(x.subject) &&
    Array.isArray(x.collections) &&
    x.collections.every((c: any) => typeof c === 'string' && c) &&
    Array.isArray(x.verticals) &&
    x.verticals.every((v: any) => typeof v === 'string' && v) &&
    typeof x.prompt === 'string' &&
    // the whole point of the model: the set never names the product
    !x.prompt.includes('{product_name}') &&
    Number.isFinite(x.width) &&
    Number.isFinite(x.height) &&
    (x.camera === undefined || typeof x.camera === 'string') &&
    (x.promptName === undefined || (typeof x.promptName === 'string' && !!x.promptName)) &&
    (x.legacyNames === undefined ||
      (Array.isArray(x.legacyNames) && x.legacyNames.every((n: any) => typeof n === 'string' && !!n))) &&
    (x.keywords === undefined ||
      (Array.isArray(x.keywords) && x.keywords.every((k: any) => typeof k === 'string' && !!k))) &&
    (x.aliases === undefined ||
      (Array.isArray(x.aliases) && x.aliases.every((a: any) => typeof a === 'string' && ID.test(a)))) &&
    (x.fields === undefined ||
      (Array.isArray(x.fields) &&
        x.fields.every((f: any) => f && typeof f.key === 'string' && typeof f.label === 'string'))) &&
    (x.textZones === undefined ||
      (Array.isArray(x.textZones) &&
        x.textZones.every(
          (z: any) =>
            z &&
            typeof z.fieldKey === 'string' &&
            Number.isFinite(z.x) &&
            Number.isFinite(z.y) &&
            Number.isFinite(z.width) &&
            Number.isFinite(z.size),
        )))
  );
}

/** Load scene files; a bad file is skipped with a warning, never fatal. */
export function loadScenes(dir = defaultScenesDir()): { scenes: Scene[]; warnings: string[] } {
  const warnings: string[] = [];
  if (!dir || !existsSync(dir)) return { scenes: [], warnings: [`scenes dir not found: ${dir}`] };
  const scenes: Scene[] = [];
  for (const f of readdirSync(dir)
    .filter((n) => n.endsWith('.json'))
    .sort()) {
    try {
      const parsed = JSON.parse(readFileSync(join(dir, f), 'utf8'));
      if (isScene(parsed)) scenes.push(parsed);
      else warnings.push(`invalid scene skipped: ${f}`);
    } catch {
      warnings.push(`unparseable scene skipped: ${f}`);
    }
  }
  return { scenes, warnings };
}

/** Resolve by current id first, then by any id a scene used to answer to. */
export function sceneResolver(scenes: Scene[]): (id: string) => Scene | undefined {
  const byId = new Map<string, Scene>();
  for (const s of scenes) byId.set(s.id, s);
  for (const s of scenes) for (const a of s.aliases ?? []) if (!byId.has(a)) byId.set(a, s);
  return (id: string) => byId.get(id);
}

/** Every collection and vertical actually in use, for the library filters. */
export function facetsOf(scenes: Scene[]): { collections: string[]; verticals: string[] } {
  const collections = new Set<string>();
  const verticals = new Set<string>();
  for (const s of scenes) {
    for (const c of s.collections) collections.add(c);
    for (const v of s.verticals) verticals.add(v);
  }
  return { collections: [...collections].sort(), verticals: [...verticals].sort() };
}

export function defaultScenesDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  // dev: monorepo root /templates; published: bundled next to package
  for (const p of [join(here, '..', '..', '..', 'templates'), join(here, '..', 'templates')]) {
    if (existsSync(p)) return p;
  }
  return join(here, '..', '..', '..', 'templates');
}

/**
 * Fill the few slots a scene still has. Only copy scenes keep fields, so most
 * scenes pass through untouched; the product is never interpolated here.
 */
export function composePrompt(scene: Scene, input: { fields?: Record<string, string>; notes?: string }): string {
  let out = scene.prompt;
  for (const f of scene.fields ?? []) {
    const v = (input.fields?.[f.key] ?? '').trim();
    out = out.replaceAll(`{${f.key}}`, v || f.placeholder?.split('/')[0]?.trim() || '');
  }
  out = out
    .replace(/\{[a-z0-9_]+\}/g, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([,.])/g, '$1')
    .trim();
  const notes = input.notes?.trim();
  return notes ? `${out}. Art direction: ${notes}` : out;
}
