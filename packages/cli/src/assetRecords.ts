/**
 * The record layer of a brand's own presenters and scenes: the `.brand`
 * document shapes, their builders and lints, and the commit that writes them.
 * The build pipeline that generates imagery for these records stays in
 * `customAssets.ts`.
 */
import { randomUUID } from 'node:crypto';
import type { Core } from '@scenri/core';
import { validateBrand } from '@scenri/brand';
import type { Scene, SceneSubject } from './scenes.js';

export interface CustomShot {
  file: string;
  angle?: string;
  locked?: boolean;
}

/** A `characters[]` entry this app built. `origin` is what makes it editable. */
export interface CustomPresenter {
  id: string;
  name: string;
  origin: 'custom';
  promptName?: string;
  presentation?: 'woman' | 'man';
  descriptor?: string;
  ageRange?: string;
  hair?: string;
  identityNotes?: string;
  negativeConstraints?: string[];
  /** Industries this person is cast for. Filtering and display only. */
  suitableCategories?: string[];
  /** The normalized studio views. First two are what a brief attaches. */
  shots?: CustomShot[];
  /** The user's own photographs. Ground truth; a generator never replaces these. */
  sourceRefs?: { file: string }[];
  /** Card thumbnail, cropped from the first studio view. Never a generation of its own. */
  preview?: string;
  /** Square head-and-shoulders crop of the same view, for round surfaces. */
  avatar?: string;
  notes?: string;
}

/** A `scenes[]` entry. Structurally a Scene, plus where it came from. */
export interface CustomScene extends Scene {
  refs?: { file: string }[];
  preview?: string;
  instruction?: string;
  /**
   * The figure this concept depends on, when it depends on one.
   *
   * A role, never a person: "one person at close portrait range, filling the
   * frame". Absent means the concept survives with nobody in it; ambient human
   * presence lives in `prompt` with the rest of the set. The compiler binds this
   * to an attached presenter, which is the one thing prose cannot do.
   */
  figure?: string;
  /**
   * What is applied to that figure - stickers over the face, paint, a veil, a
   * silhouette. Scene owns the treatment; the presenter owns the identity under
   * it, and nothing here is ever written back to a presenter record.
   */
  figureTreatment?: string;
}

export const PRESENTER_ID_PREFIX = 'up';
export const SCENE_ID_PREFIX = 'us';
/** Every curated scene and presenter ships 4:5. A brand's own match them. */
export const ASSET_WIDTH = 1024;
export const ASSET_HEIGHT = 1280;

const mintId = (prefix: string) => `${prefix}-${randomUUID().slice(0, 8)}`;
export const str = (v: unknown, max: number): string =>
  String(v ?? '')
    .trim()
    .slice(0, max);
export const strList = (v: unknown, max: number, each: number): string[] =>
  Array.isArray(v)
    ? v
        .map((x) => str(x, each))
        .filter(Boolean)
        .slice(0, max)
    : [];
const assetRef = (hash: unknown): string | null => {
  const h = String(hash ?? '');
  return /^[a-f0-9]{32}$/.test(h) ? `asset:${h}` : null;
};
const _hashOf = (ref: unknown): string | null => {
  const s = String(ref ?? '');
  return s.startsWith('asset:') ? s.slice(6) : null;
};

/* -------------------------------------------------------------- lookups */

export function brandCharacters(brandJson: any): any[] {
  return Array.isArray(brandJson?.characters) ? brandJson.characters : [];
}

export function brandScenes(brandJson: any): CustomScene[] {
  return Array.isArray(brandJson?.scenes) ? brandJson.scenes : [];
}

/**
 * The brand's own scene for this id, if it has one.
 *
 * Handed to `compileBrief` ahead of the catalog resolver so a brand's scene
 * wins a name collision, exactly as its characters already do.
 */
export function brandSceneById(brandJson: any, id: string): Scene | undefined {
  return brandScenes(brandJson).find((s) => s?.id === id) as Scene | undefined;
}

/** Only what this app built is editable; an older hand-added cast stays as it is. */
export function isCustomPresenter(c: any): boolean {
  return c?.origin === 'custom';
}

/* ------------------------------------------------------------ validation */

const SUBJECTS = new Set<SceneSubject>(['product', 'person', 'either']);

export interface SceneInput {
  name?: unknown;
  promptName?: unknown;
  lighting?: unknown;
  description?: unknown;
  subject?: unknown;
  prompt?: unknown;
  camera?: unknown;
  collections?: unknown;
  verticals?: unknown;
  keywords?: unknown;
  instruction?: unknown;
  figure?: unknown;
  figureTreatment?: unknown;
  refHashes?: unknown;
  previewHash?: unknown;
}

/**
 * Build a scene record from a request body, or say why it cannot be built.
 *
 * `base` is the record being edited, so a PATCH carrying one field keeps the
 * rest. The `{placeholder}` refusal mirrors the catalog loader's: the set never
 * names what is staged in it.
 */
export function sceneRecordFrom(
  input: SceneInput,
  base?: CustomScene,
): { ok: true; scene: CustomScene } | { ok: false; error: string } {
  const has = (k: keyof SceneInput) => input[k] !== undefined;
  const prompt = has('prompt') ? str(input.prompt, 2000) : (base?.prompt ?? '');
  if (!prompt) return { ok: false, error: 'a scene needs a prompt describing the place' };
  if (/\{[^}]*\}/.test(prompt)) return { ok: false, error: 'a scene prompt cannot contain a {placeholder}' };
  const name = has('name') ? str(input.name, 60) : (base?.name ?? '');
  if (!name) return { ok: false, error: 'a scene needs a name' };
  const subjectRaw = has('subject') ? str(input.subject, 20).toLowerCase() : (base?.subject ?? 'either');
  if (!SUBJECTS.has(subjectRaw as SceneSubject)) {
    return { ok: false, error: 'subject must be product, person or either' };
  }
  const lighting = has('lighting') ? str(input.lighting, 200) : (base?.lighting ?? '');
  const description = has('description') ? str(input.description, 400) : (base?.description ?? '');
  const camera = has('camera') ? str(input.camera, 200) : (base?.camera ?? '');
  const refs = has('refHashes')
    ? strList(input.refHashes, 8, 64)
        .map((h) => assetRef(h))
        .filter((f): f is string => !!f)
        .map((file) => ({ file }))
    : base?.refs;
  const previewRef = has('previewHash') ? assetRef(input.previewHash) : (base?.preview ?? null);

  const scene: CustomScene = {
    id: base?.id ?? mintId(SCENE_ID_PREFIX),
    name,
    lighting: lighting || 'Even, neutral light',
    description: description || name,
    subject: subjectRaw as SceneSubject,
    collections: has('collections') ? strList(input.collections, 3, 40) : (base?.collections ?? []),
    verticals: has('verticals') ? strList(input.verticals, 6, 40) : (base?.verticals ?? []),
    prompt,
    width: base?.width ?? ASSET_WIDTH,
    height: base?.height ?? ASSET_HEIGHT,
  };
  const promptName = has('promptName') ? str(input.promptName, 60) : base?.promptName;
  if (promptName) scene.promptName = promptName;
  if (camera) scene.camera = camera;
  const keywords = has('keywords') ? strList(input.keywords, 12, 40) : base?.keywords;
  if (keywords?.length) scene.keywords = keywords;
  // An empty string is not an instruction to forget one. `runSceneBuild` always
  // passes this key, so a re-read carrying no new direction arrived here as ''
  // and, because the record is rebuilt from scratch, silently dropped whatever
  // the user had written. Blank falls back to what is already stored; clearing
  // it on purpose is what DELETE and a fresh build are for.
  const written = has('instruction') ? str(input.instruction, 400) : '';
  const instruction = written || base?.instruction;
  if (instruction) scene.instruction = instruction;
  // Through `has()` like every other field: the scene page PATCHes prompt and
  // lighting alone on each keystroke, so anything read unconditionally from
  // `input` would be erased by an edit that never mentioned it.
  const figure = has('figure') ? str(input.figure, 120).replace(/\s+/g, ' ') : base?.figure;
  if (figure && !/\{[^}]*\}/.test(figure)) scene.figure = figure;
  const treatment = has('figureTreatment')
    ? str(input.figureTreatment, 160).replace(/\s+/g, ' ')
    : base?.figureTreatment;
  // A treatment with no figure to sit on describes nobody.
  if (scene.figure && treatment && !/\{[^}]*\}/.test(treatment)) scene.figureTreatment = treatment;
  if (refs?.length) scene.refs = refs;
  if (previewRef) scene.preview = previewRef;
  return { ok: true, scene };
}

export interface PresenterInput {
  name?: unknown;
  promptName?: unknown;
  presentation?: unknown;
  descriptor?: unknown;
  ageRange?: unknown;
  hair?: unknown;
  identityNotes?: unknown;
  negativeConstraints?: unknown;
  suitableCategories?: unknown;
  /** Ordered: the first two are the views a brief attaches. */
  shotHashes?: unknown;
  sourceHashes?: unknown;
  previewHash?: unknown;
  avatarHash?: unknown;
}

export function presenterRecordFrom(
  input: PresenterInput,
  base?: CustomPresenter,
): { ok: true; presenter: CustomPresenter } | { ok: false; error: string } {
  const has = (k: keyof PresenterInput) => input[k] !== undefined;
  const name = has('name') ? str(input.name, 60) : (base?.name ?? '');
  if (!name) return { ok: false, error: 'a presenter needs a name' };
  const shots = has('shotHashes')
    ? strList(input.shotHashes, 8, 64)
        .map((h) => assetRef(h))
        .filter((f): f is string => !!f)
        .map((file) => ({ file, locked: true }))
    : (base?.shots ?? []);
  if (!shots.length) return { ok: false, error: 'a presenter needs at least one photo' };
  const sources = has('sourceHashes')
    ? strList(input.sourceHashes, 8, 64)
        .map((h) => assetRef(h))
        .filter((f): f is string => !!f)
        .map((file) => ({ file }))
    : base?.sourceRefs;

  const presenter: CustomPresenter = {
    id: base?.id ?? mintId(PRESENTER_ID_PREFIX),
    name,
    origin: 'custom',
    shots,
  };
  // Frozen at creation. Without it `name` is what a generator is told, which
  // would make renaming this person a change to every future shot of them.
  const promptName = has('promptName') ? str(input.promptName, 240) : base?.promptName;
  if (promptName) presenter.promptName = promptName;
  const presentation = has('presentation') ? str(input.presentation, 10).toLowerCase() : base?.presentation;
  if (presentation === 'woman' || presentation === 'man') presenter.presentation = presentation;
  const descriptor = has('descriptor') ? str(input.descriptor, 120) : base?.descriptor;
  if (descriptor) presenter.descriptor = descriptor;
  const ageRange = has('ageRange') ? str(input.ageRange, 40) : base?.ageRange;
  if (ageRange) presenter.ageRange = ageRange;
  const hair = has('hair') ? str(input.hair, 120) : base?.hair;
  if (hair) presenter.hair = hair;
  const identityNotes = has('identityNotes') ? str(input.identityNotes, 900) : base?.identityNotes;
  if (identityNotes) presenter.identityNotes = identityNotes;
  const negatives = has('negativeConstraints') ? strList(input.negativeConstraints, 8, 160) : base?.negativeConstraints;
  if (negatives?.length) presenter.negativeConstraints = negatives;
  const categories = has('suitableCategories') ? strList(input.suitableCategories, 8, 40) : base?.suitableCategories;
  if (categories?.length) presenter.suitableCategories = categories;
  if (sources?.length) presenter.sourceRefs = sources;
  const previewRef = has('previewHash') ? assetRef(input.previewHash) : (base?.preview ?? null);
  if (previewRef) presenter.preview = previewRef;
  const avatarRef = has('avatarHash') ? assetRef(input.avatarHash) : (base?.avatar ?? null);
  if (avatarRef) presenter.avatar = avatarRef;
  return { ok: true, presenter };
}

/**
 * Warn when a scene's prose names something that belongs to a brief.
 *
 * The compiler already disowns a scene's products and wardrobe at generation
 * time, and the analyzer is told not to write them. This is the third pass, and
 * the only one a human reads: a scene that says "the amber serum bottle" will
 * fight every product ever staged in it.
 */
export function lintSceneProse(brandJson: any, scene: CustomScene): string[] {
  const haystack =
    `${scene.prompt} ${scene.description} ${scene.figure ?? ''} ${scene.figureTreatment ?? ''}`.toLowerCase();
  const named = new Set<string>();
  const consider = (raw: unknown) => {
    const n = String(raw ?? '').trim();
    // Two characters is a size, not a name; a very long one is a sentence.
    if (n.length < 3 || n.length > 40) return;
    if (haystack.includes(n.toLowerCase())) named.add(n);
  };
  consider(brandJson?.meta?.name);
  for (const p of brandJson?.products ?? []) consider(p?.name);
  for (const c of brandCharacters(brandJson)) consider(c?.name);
  return named.size
    ? [
        `This scene names ${[...named].join(', ')}. A scene is a place, so whatever you stage in it later has to argue with that.`,
      ]
    : [];
}

/**
 * Read the brand fresh, apply, validate, write.
 *
 * Never a read-modify-write across an await: the product library polls and
 * writes to the same document, and a stale copy here would silently drop
 * whatever it wrote while an engine was busy.
 */
export function commit(core: Core, brandId: string, mutate: (json: any) => void): any {
  const brand = core.store.getBrand(brandId);
  if (!brand) throw Object.assign(new Error('brand not found'), { statusCode: 404 });
  const json = { ...(brand.json as any) };
  mutate(json);
  const v = validateBrand(json);
  if (!v.valid) throw Object.assign(new Error(`brand became invalid: ${v.errors.join('; ')}`), { statusCode: 400 });
  return core.store.updateBrand(brand.id, json);
}
