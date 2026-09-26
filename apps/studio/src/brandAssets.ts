import {
  assetUrl,
  type Brand,
  type Presenter,
  type Scene,
  type SceneExampleRole,
  type SceneSetup,
  type SceneView,
} from './api.js';

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
  /** Made here from a description, or built from photographs of a real person. Absent on older records: photos. */
  source?: 'synthetic' | 'photos';
  /** The likeness confirmation given for a real person. */
  likeness?: { attestedAt: string; version: string };
  /** The photographs this person was built from. Never generated. */
  sourceRefs: string[];
  /** The normalized views, in the order a brief attaches them. */
  shots: string[];
  /** The record this one replaced, when an edit that changed a picture made it. */
  revisionOf?: string;
  /** The record that replaced this one. Absent on the head, the only record a list shows. */
  supersededBy?: string;
  /** The identity-wide instructions accepted when this record's views were drawn. */
  identityEdits?: string[];
}

export interface CustomScene extends Scene {
  custom: true;
  /** The user's own inspiration images. Read into words, and drawn beside for the scene's picture. Never sent with a shot. */
  refs: string[];
  /** The scene's own picture as its store hash; null when none was drawn (`placeUrl` may then fall back to an upload). */
  previewHash: string | null;
  /**
   * The place: the picture a shot is given, the one its examples are drawn
   * from. Not necessarily the cover (`previewUrl`), which may be its hero.
   */
  placeUrl: string | null;
  /** That picture is an anchor, so a shot is given it as the world's picture. */
  anchor?: boolean;
  /** What they asked for in their own words when it was built. */
  instruction?: string;
  /** The camera tendency of this world, when it has one. Told to a shot that names no camera. */
  camera?: string;
  /** The figure this concept depends on, if it depends on one. A role, never a person. */
  figure?: string;
  /** What has been applied to that figure: stickers, paint, a veil, a silhouette. */
  figureTreatment?: string;
  /** Ways to shoot this same world: a label and a camera line each, never a picture. */
  setups?: SceneSetup[];
  /** The place in use, with a Scenri demo product or presenter. Sent with a shot only when picked for one. */
  examples?: SceneExampleView[];
}

export interface SceneExampleView {
  role: SceneExampleRole;
  url: string;
  /** The picture's store hash, for the studio's conversation and its stage. */
  hash: string;
  /** Drawn from a picture of the place that has since been replaced. */
  earlier: boolean;
  /** The way of shooting it this example shows, when it shows one (FRAMINGS). */
  setup?: string;
  /** Who stands in it: a Scenri demo product, or a demo presenter. */
  with: 'product' | 'presenter';
}

const EXAMPLE_ROLES: readonly SceneExampleRole[] = ['hero', 'close', 'hands', 'angle', 'bold'];

const urls = (rows: unknown): string[] =>
  Array.isArray(rows) ? rows.map((r: any) => assetUrl(r?.file)).filter((u): u is string => !!u) : [];

const customRows = (brand: Brand | null | undefined): any[] =>
  ((brand?.json?.characters ?? []) as any[]).filter((c) => c?.origin === 'custom');

/**
 * Newest first for every "yours" wall.
 *
 * The brand document still appends: an edit keeps its slot, and an older
 * brand is not rewritten. Display is the other direction, so a card that
 * sat top-left while it built stays top-left when it lands - the same rule
 * the Create feed already keeps for shots.
 */
export function newestFirst<T>(rows: readonly T[]): T[] {
  return rows.length < 2 ? [...rows] : rows.slice().reverse();
}

/**
 * The unified product library, newest first, without disturbing the store's half.
 *
 * Products come from two places and only one of them appends. The brand
 * document still lists hand-made products oldest first, so that half reverses
 * like presenters and scenes do. The imported half arrives already sorted
 * newest first by the server (`catalog/rows.ts`, `created_at DESC, rowid DESC`),
 * and reversing the whole array would have put a store's catalogue in oldest
 * order and pushed the hand-made products to the end behind it.
 */
export function productsNewestFirst<T extends { origin?: string | null }>(rows: readonly T[]): T[] {
  const own = rows.filter((p) => p.origin !== 'catalog');
  if (own.length === rows.length) return newestFirst(rows);
  return [...newestFirst(own), ...rows.filter((p) => p.origin === 'catalog')];
}

/**
 * A brand's own people, newest first for display: one record per person, the
 * current one. A record an edit replaced stays in the document for the shots
 * made against it, and never in a list. The document still appends.
 */
export function customPresentersOf(brand: Brand | null | undefined): CustomPresenter[] {
  return newestFirst(
    customRows(brand)
      .filter((c) => !c.supersededBy)
      .map(toPresenter),
  );
}

/** Any record by id, the head or one an edit replaced, so an old shot's presenter still opens. */
export function customPresenterById(brand: Brand | null | undefined, id: string): CustomPresenter | undefined {
  const row = customRows(brand).find((c) => c.id === id);
  return row ? toPresenter(row) : undefined;
}

/** The current record for any presenter id, following the chain of replacements; an unknown id is its own head. */
export function headPresenterId(brand: Brand | null | undefined, id: string): string {
  const rows = customRows(brand);
  const seen = new Set<string>([id]);
  let cur = id;
  for (;;) {
    const next = rows.find((c) => c.id === cur)?.supersededBy;
    if (typeof next !== 'string' || !next || seen.has(next) || !rows.some((c) => c.id === next)) return cur;
    seen.add(next);
    cur = next;
  }
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
    // The casting-sheet prose a person built in the studio carries, the same
    // three the curated roster does; an older record has none and stays
    // empty rather than being invented to fill a shape. `wardrobeDefault` is
    // the capture uniform and never rides.
    facial: String(c.facial ?? ''),
    skin: String(c.skin ?? ''),
    build: String(c.build ?? ''),
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
    identityEdits: Array.isArray(c.identityEdits) ? c.identityEdits.map(String) : [],
    ...(c.revisionOf ? { revisionOf: String(c.revisionOf) } : {}),
    ...(c.supersededBy ? { supersededBy: String(c.supersededBy) } : {}),
    ...(c.source === 'synthetic' || c.source === 'photos' ? { source: c.source } : {}),
    ...(c.likeness?.attestedAt
      ? { likeness: { attestedAt: String(c.likeness.attestedAt), version: String(c.likeness.version ?? 'v1') } }
      : {}),
  };
}

/** A brand's own places, newest first for display; the document still appends. */
export function customScenesOf(brand: Brand | null | undefined): CustomScene[] {
  const rows: any[] = brand?.json?.scenes ?? [];
  return newestFirst(rows.map(toScene));
}

export function customSceneById(brand: Brand | null | undefined, id: string): CustomScene | undefined {
  return customScenesOf(brand).find((s) => s.id === id);
}

const SCENE_VIEWS: readonly SceneView[] = ['place', ...EXAMPLE_ROLES];

function toScene(s: any): CustomScene {
  const refs = urls(s.refs);
  // No preview yet is normal: the scene works, it just has nothing to show
  // but the references it was built from.
  const place = assetUrl(s.preview) ?? refs[0] ?? null;
  const examples: SceneExampleView[] | undefined = Array.isArray(s.examples)
    ? s.examples
        .filter((e: any) => EXAMPLE_ROLES.includes(e?.role) && assetUrl(e?.file))
        .map((e: any) => ({
          role: e.role as SceneExampleRole,
          url: assetUrl(e.file) as string,
          hash: String(e.file).slice('asset:'.length),
          earlier: e.from !== s.preview,
          with: e.presenter ? ('presenter' as const) : ('product' as const),
          ...(e.setup ? { setup: String(e.setup) } : {}),
        }))
    : undefined;
  // The cover names a view; a view the scene no longer has shows the place, and
  // so does one drawn from an earlier picture of it (the place moved on).
  const cover: SceneView | undefined = SCENE_VIEWS.includes(s.cover) ? s.cover : undefined;
  const covered = cover && cover !== 'place' ? examples?.find((e) => e.role === cover && !e.earlier)?.url : undefined;
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
    previewUrl: covered ?? place,
    placeUrl: place,
    ...(cover ? { cover } : {}),
    previewColor: null,
    custom: true,
    refs,
    previewHash: /^asset:[a-f0-9]{32}$/.test(String(s.preview ?? '')) ? String(s.preview).slice('asset:'.length) : null,
    ...(s.anchor === true ? { anchor: true } : {}),
    instruction: s.instruction ? String(s.instruction) : undefined,
    camera: s.camera ? String(s.camera) : undefined,
    figure: s.figure ? String(s.figure) : undefined,
    figureTreatment: s.figureTreatment ? String(s.figureTreatment) : undefined,
    setups: Array.isArray(s.setups)
      ? s.setups
          .filter((v: any) => v?.id && v?.label && v?.camera)
          .map((v: any) => ({ id: String(v.id), label: String(v.label), camera: String(v.camera) }))
      : undefined,
    examples,
  };
}

/**
 * Which view stands for a scene now: the one it shows as its cover, else the
 * place, which is also what a cover drawn from an earlier picture of it gives.
 */
export function coverViewOf(scene: Scene & { examples?: SceneExampleView[] }): SceneView {
  const v = scene.cover;
  if (!v || v === 'place') return 'place';
  return !scene.examples || scene.examples.some((e) => e.role === v && !e.earlier) ? v : 'place';
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

/**
 * A brief's presenter tokens, moved to the current revision of each person.
 *
 * A stored shot names the record it was made with, and that record keeps its
 * pictures so a refine of the shot conditions on the person in it. A new shot
 * started from the old one is a new shot of the person as they are now, so
 * its tokens are mapped to the head before they enter the composer.
 */
export function withHeadPresenters<T extends { t: string; id?: string }>(
  brand: Brand | null | undefined,
  tokens: T[],
): T[] {
  return tokens.map((t) => (t.t === 'character' && t.id ? { ...t, id: headPresenterId(brand, t.id) } : t));
}
