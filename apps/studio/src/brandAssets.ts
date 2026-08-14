import { assetUrl, type Brand, type Presenter, type Scene } from './api.js';

/**
 * The presenters and scenes a brand built for itself, read out of its own
 * document and shaped like the curated ones.
 *
 * Everything downstream — cards, chips, the attach panel, the compiler — takes
 * a Presenter or a Scene and does not ask where it came from. So rather than
 * teach each of those surfaces about a second kind of object, a brand's own
 * assets are adapted into the same shape here, once, with `custom` set for the
 * few places that genuinely need to know (an editable page, a "yours" section).
 */

export interface CustomPresenter extends Presenter {
  custom: true;
  /** The photographs this person was built from. Never generated. */
  sourceRefs: string[];
  /** The normalized views, in the order a brief attaches them. */
  shots: string[];
}

export interface CustomScene extends Scene {
  custom: true;
  /** The user's own inspiration images. Display only. */
  refs: string[];
  /** What they asked for in their own words when it was built. */
  instruction?: string;
}

const urls = (rows: unknown): string[] =>
  Array.isArray(rows) ? rows.map((r: any) => assetUrl(r?.file)).filter((u): u is string => !!u) : [];

/** A brand's own people, newest last, exactly as its document lists them. */
export function customPresentersOf(brand: Brand | null | undefined): CustomPresenter[] {
  const rows: any[] = brand?.json?.characters ?? [];
  return rows.filter((c) => c?.origin === 'custom').map(toPresenter);
}

export function customPresenterById(brand: Brand | null | undefined, id: string): CustomPresenter | undefined {
  return customPresentersOf(brand).find((p) => p.id === id);
}

function toPresenter(c: any): CustomPresenter {
  const shots = urls(c.shots);
  const sourceRefs = urls(c.sourceRefs);
  const preview = assetUrl(c.preview) ?? shots[0] ?? sourceRefs[0] ?? null;
  return {
    id: String(c.id),
    name: String(c.name ?? ''),
    // Frozen at creation and never rendered: this is what the engine is told.
    promptName: c.promptName,
    presentation: c.presentation === 'man' ? 'man' : 'woman',
    descriptor: String(c.descriptor ?? ''),
    ageRange: String(c.ageRange ?? ''),
    hair: String(c.hair ?? ''),
    identityNotes: String(c.identityNotes ?? ''),
    negativeConstraints: Array.isArray(c.negativeConstraints) ? c.negativeConstraints.map(String) : [],
    // A curated presenter carries these from its casting sheet. A person built
    // here has them folded into identityNotes instead, so they stay empty
    // rather than being invented to fill a shape. `suitableCategories` is the
    // exception: it is what the category tabs filter on, so a person with none
    // would be invisible under every tab but "Every presenter".
    facial: '',
    skin: '',
    build: '',
    wardrobeDefault: '',
    suitableCategories: Array.isArray(c.suitableCategories) ? c.suitableCategories.map(String) : [],
    suitableStyles: [],
    width: 1024,
    height: 1280,
    previewUrl: preview,
    // A real square head crop where there is one. Null rather than the 4:5
    // card crop otherwise: claiming that as an avatar skips the zoom the
    // circle needs and renders a torso.
    avatarUrl: assetUrl(c.avatar),
    custom: true,
    shots,
    sourceRefs,
  };
}

/** A brand's own places. */
export function customScenesOf(brand: Brand | null | undefined): CustomScene[] {
  const rows: any[] = brand?.json?.scenes ?? [];
  return rows.map(toScene);
}

export function customSceneById(brand: Brand | null | undefined, id: string): CustomScene | undefined {
  return customScenesOf(brand).find((s) => s.id === id);
}

function toScene(s: any): CustomScene {
  const refs = urls(s.refs);
  return {
    id: String(s.id),
    name: String(s.name ?? ''),
    promptName: s.promptName,
    description: String(s.description ?? ''),
    lighting: String(s.lighting ?? ''),
    subject: s.subject === 'product' || s.subject === 'person' ? s.subject : 'either',
    collections: Array.isArray(s.collections) ? s.collections.map(String) : [],
    verticals: Array.isArray(s.verticals) ? s.verticals.map(String) : [],
    keywords: Array.isArray(s.keywords) ? s.keywords.map(String) : undefined,
    prompt: String(s.prompt ?? ''),
    width: Number(s.width) || 1024,
    height: Number(s.height) || 1280,
    // No preview yet is normal: the scene works, it just has nothing to show
    // but the references it was built from.
    previewUrl: assetUrl(s.preview) ?? refs[0] ?? null,
    previewColor: null,
    custom: true,
    refs,
    instruction: s.instruction ? String(s.instruction) : undefined,
  };
}

/**
 * The brand's own first, then the catalog.
 *
 * Same precedence the compiler uses, so what a picker offers and what a brief
 * resolves can never disagree about which asset an id means.
 */
export function withCustomFirst<T extends { id: string }>(mine: T[], catalog: T[]): T[] {
  const owned = new Set(mine.map((m) => m.id));
  return [...mine, ...catalog.filter((c) => !owned.has(c.id))];
}
