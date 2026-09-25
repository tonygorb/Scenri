import { randomUUID } from 'node:crypto';
import type { BrandContext, Core, EngineAdapter, ReferenceRole } from '@scenri/core';
import { brandScenes, commit, type CustomScene, type SceneExample, type SceneExampleRole } from './assetRecords.js';
import type { BriefToken, CompiledBrief } from './brief.js';
import { physicalPoseDirective, wardrobeRelease } from './briefDirectives.js';
import { checkedPicture, personError, trimEdgeBars } from './customAssets.js';
import type { DemoProduct } from './demoProducts.js';
import type { Presenter } from './presenters.js';
import { drawAtScale, needsOwnScale, type ProductSize } from './productScale.js';
import type { ProductSizes } from './productSizes.js';

/**
 * A scene's examples: the place in use, shown on its page and never handed to
 * a shot.
 *
 * A curated scene carries six pictures of its world in use, drawn offline in
 * six roles; a scene someone makes ends with one picture of the place, empty.
 * These give it the same kind of set: a Scenri demo product (or presenter, for
 * a world built around a person) in the place, in the curated roles.
 *
 * Every example is drawn from the place's own picture, never from its words
 * alone. Drawn from the words, a presenter and a pair of hands landed in a
 * daylit loft while the product sat in the golden one the picture shows: a
 * blind judge saw two places (2026-09-22). Drawn from the picture (the empty
 * surface at the product's magnification, or an edit of the place or of the
 * hero), all seven read as one place, 7 of 7 at true size.
 *
 * The hero comes first, and it comes with the place: the studio draws it the
 * moment it draws the place (`drawHero`), so the first picture a person judges
 * is the world at its best, in use, and saving it saves both. What it shows is
 * decided before it is drawn (`heroModeOf`), never by looking at pictures.
 *
 * The rhythm (DESIGN.md): nothing here is ever drawn without being asked for.
 * Saving a scene spends nothing; the rest of the set is one press (the close-up,
 * or the hero and the close-up for a scene made before the hero came first),
 * three more another. Every picture here is spent quota, so no path in this file
 * reaches `begin` except `start`, and a place picture that changes stops the
 * run that was drawing the old one rather than starting a new one.
 */

export type ExampleRole = SceneExampleRole;
/** Drawn by themselves once a scene first has its picture. */
export const AUTO_ROLES: readonly ExampleRole[] = ['hero', 'close'];
/** Asked for from the page: "Add three more" (two for a world built around a person). */
export const MORE_ROLES: readonly ExampleRole[] = ['hands', 'angle', 'bold'];
const PERSON_MORE: readonly ExampleRole[] = ['angle', 'bold'];
/** The set's order: every role is drawn after the hero it is drawn from. */
const ORDER: readonly ExampleRole[] = ['hero', 'close', 'hands', 'angle', 'bold'];

/**
 * A place staged in someone's hands (the questionnaire's "In someone's hands"):
 * its hero is already held, so a Hands example would be the hero again.
 * Plural and whole, so "a hand's width" and "hand-painted" are not hands, and
 * a place that says "no hands" has none.
 */
export function handsStaged(prompt: string | undefined): boolean {
  const p = prompt ?? '';
  return /\bhands\b(?!-)/i.test(p) && !/\b(?:no|without) (?:\w+ )?hands\b/i.test(p);
}

/** The roles a scene can ask for, in the order they are drawn. */
export function rolesFor(subject: ExampleSubject, which: 'auto' | 'more', prompt?: string): ExampleRole[] {
  if (which === 'auto') return [...AUTO_ROLES];
  if (subject.kind === 'presenter') return [...PERSON_MORE];
  return handsStaged(prompt) ? MORE_ROLES.filter((r) => r !== 'hands') : [...MORE_ROLES];
}

/** What stands in the place: a Scenri demo product, or a demo presenter for a world built around a person. */
export type ExampleSubject = { kind: 'product'; id: string } | { kind: 'presenter'; id: string };

/** Who stands in a hero: a demo product, a demo presenter, or both. */
export interface HeroWith {
  product?: string;
  presenter?: string;
}

/**
 * What a scene's hero shows: a product staged in it, a person, a person with a
 * product, or the place alone. The reader decides it with the words (it sees
 * what the pictures and the words say the world is for); a reading without
 * that answer decides here, from what it already knows: a person in the role
 * with a product in the pictures is both, a person is a presenter, and every
 * other world is shown with a product in it, because that is what a scene is
 * for. Nothing looks at a picture to choose.
 */
export type HeroMode = 'product' | 'presenter' | 'both' | 'place';
const HERO_MODES: readonly HeroMode[] = ['product', 'presenter', 'both', 'place'];
export function heroModeOf(r: {
  hero?: unknown;
  figure?: string | null;
  subject?: string;
  holds?: readonly string[];
}): HeroMode {
  if (HERO_MODES.includes(r.hero as HeroMode)) return r.hero as HeroMode;
  if (r.figure && r.holds?.includes('product')) return 'both';
  return r.figure || r.subject === 'person' ? 'presenter' : 'product';
}

/**
 * The scene's categories, as the demo catalog files its products. A category
 * the catalog has no product for (Sport) names the few that fit it; a scene
 * with none gets the small everyday objects every world can hold.
 */
const CATEGORY_OF: Record<string, readonly string[]> = {
  beauty: ['beauty'],
  fragrance: ['fragrance'],
  jewelry: ['jewelry'],
  accessories: ['accessories'],
  electronics: ['electronics'],
  footwear: ['footwear'],
  apparel: ['apparel'],
  beverage: ['beverage'],
  home: ['furniture'],
  furniture: ['furniture'],
  'food & drink': ['food', 'beverage'],
};
const SPORT = ['voss-rowe-ridgeline-trail', 'slate-harbor-cropped-puffer', 'carrick-stead-chug-710'];
const DEFAULT_CATEGORIES = ['fragrance', 'beauty', 'accessories'];

/** A stable number from a string, so the same scene always picks the same subject. */
function stable(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

type Picked = Pick<CustomScene, 'id' | 'verticals'>;
const pickOf =
  (scene: Picked) =>
  <T extends { id: string }>(xs: readonly T[]): T | null =>
    xs.length ? xs[stable(scene.id) % xs.length] : null;
const verticalsOf = (scene: Picked) => (scene.verticals ?? []).map((v) => v.toLowerCase());

/** A demo presenter who suits the scene's categories, the same one every time for this scene. */
function presenterFor(scene: Picked, presenters: readonly Pick<Presenter, 'id' | 'suitableCategories'>[]) {
  const verticals = verticalsOf(scene);
  const fits = presenters.filter((p) =>
    (p.suitableCategories ?? []).some((c) => verticals.includes(String(c).toLowerCase())),
  );
  return pickOf(scene)(fits.length ? fits : presenters)?.id ?? null;
}

/** A demo product from the scene's categories, the same one every time for this scene. */
function productFor(scene: Picked, demoProducts: readonly Pick<DemoProduct, 'id' | 'category'>[]) {
  const verticals = verticalsOf(scene);
  const sport = verticals.includes('sport') ? demoProducts.filter((p) => SPORT.includes(p.id)) : [];
  const categories = new Set(verticals.flatMap((v) => CATEGORY_OF[v] ?? []));
  const fits = [...sport, ...demoProducts.filter((p) => categories.has(String(p.category)))];
  const fallback = demoProducts.filter((p) => DEFAULT_CATEGORIES.includes(String(p.category)));
  return pickOf(scene)(fits.length ? fits : fallback.length ? fallback : demoProducts)?.id ?? null;
}

/**
 * Who stands in this scene's examples. A world built around a person gets a
 * demo presenter who suits its categories; every other world a demo product
 * from them. Deterministic, so Try again keeps the same subject.
 */
export function pickSubject(
  scene: Pick<CustomScene, 'id' | 'subject' | 'figure' | 'verticals'>,
  demoProducts: readonly Pick<DemoProduct, 'id' | 'category'>[],
  presenters: readonly Pick<Presenter, 'id' | 'suitableCategories'>[],
): ExampleSubject | null {
  if (scene.subject === 'person' || scene.figure) {
    const id = presenterFor(scene, presenters);
    return id ? { kind: 'presenter', id } : null;
  }
  const id = productFor(scene, demoProducts);
  return id ? { kind: 'product', id } : null;
}

/** Who stands in a hero of this mode: picked the way `pickSubject` picks, null for the place alone. */
export function heroWithFor(
  mode: HeroMode,
  scene: Picked,
  demoProducts: readonly Pick<DemoProduct, 'id' | 'category'>[],
  presenters: readonly Pick<Presenter, 'id' | 'suitableCategories'>[],
): HeroWith | null {
  if (mode === 'place') return null;
  const product = mode === 'presenter' ? null : productFor(scene, demoProducts);
  const presenter = mode === 'product' ? null : presenterFor(scene, presenters);
  if ((mode !== 'presenter' && !product) || (mode !== 'product' && !presenter)) return null;
  return { ...(product ? { product } : {}), ...(presenter ? { presenter } : {}) };
}

/**
 * Who stands in a scene's set: the ones its hero was drawn with, so a set whose
 * hero came from the studio keeps them, and otherwise the scene's own pick. The
 * rest of the set follows one of them: the presenter when there is one.
 */
export function standInsOf(
  scene: Pick<CustomScene, 'id' | 'subject' | 'figure' | 'verticals' | 'examples'>,
  demoProducts: readonly Pick<DemoProduct, 'id' | 'category'>[],
  presenters: readonly Pick<Presenter, 'id' | 'suitableCategories'>[],
): { with: HeroWith; subject: ExampleSubject } | null {
  const hero = (scene.examples ?? []).find((e) => e.role === 'hero' && (e.product || e.presenter));
  const picked = hero ? null : pickSubject(scene, demoProducts, presenters);
  const withs: HeroWith | null = hero
    ? { ...(hero.product ? { product: hero.product } : {}), ...(hero.presenter ? { presenter: hero.presenter } : {}) }
    : picked
      ? picked.kind === 'product'
        ? { product: picked.id }
        : { presenter: picked.id }
      : null;
  if (!withs) return null;
  const subject: ExampleSubject = withs.presenter
    ? { kind: 'presenter', id: withs.presenter }
    : { kind: 'product', id: withs.product as string };
  return { with: withs, subject };
}

/**
 * The tested ways of shooting a scene (the studio's FRAMINGS) that an example
 * shows. Mirrors apps/studio/src/create/scene/sceneSetups.ts, word for word,
 * because those lines are the ones a real Codex battery drew right.
 */
export const FRAMING_CAMERA: Record<'close' | 'top-down' | 'ground', string> = {
  close: 'Close in on the subject, its surface, edge and material filling the frame',
  'top-down': 'Directly overhead, looking straight down, the subject centred, deep focus',
  ground: 'Ground level, camera low, the subject close and large in frame, the place rising behind it',
};

/** A tabletop world is looked down on; anything else is looked up at. */
export function angleFor(scene: Pick<CustomScene, 'prompt'>): 'top-down' | 'ground' {
  return /\b(table|tabletop|desk|counter|worktop|tray|flat ?lay|shelf|surface)\b/i.test(scene.prompt ?? '')
    ? 'top-down'
    : 'ground';
}

/** The experimental role's own words: the three moves a curated set's sixth frame uses. */
export const BOLD_WORDS =
  'as a bold, memorable campaign frame: seen through an out-of-focus foreground edge of the place, or in its reflection, or from an extreme perspective';

const clean = (s: string) =>
  s
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.\s]+$/, '');
const joinLines = (lines: string[]) => lines.map(clean).filter(Boolean).join('. ');

/* ------------------------------------------------------------ the words */

/**
 * An anchor (`CustomScene.anchor`) is drawn beside the scene's own pictures and
 * may keep what they staged, made nobody's: a plain object held or shown as the
 * hero, a figure. Told "this place, empty" over one of those, an example came
 * out with two people or two products, so the stand-in is named for what it is.
 */
const PLACE_OF = (anchor: boolean) => (anchor ? 'input.png is this place.' : 'input.png is this place, empty.');

export function heroProductInstruction(
  name: string,
  size: ProductSize | null,
  lines: string[],
  anchor = false,
): string {
  const sized = size ? `, ${clean(size.text)}` : '';
  return (
    `${PLACE_OF(anchor)} ` +
    (anchor ? 'A plain object it shows as the hero only marks where the product goes, and gives way to it. ' : '') +
    `Put ${name} into it where it belongs, at its true real-world size${sized}: ` +
    'resting on a real surface of the place with true contact and a true shadow in the same light. ' +
    'Keep the place exactly as it is: its camera, framing, light, materials and every object in it. ' +
    (lines.length ? `${joinLines(lines)}. ` : '') +
    'Add no other object, no person, no hands and no text'
  );
}

export function heroPresenterInstruction(identity: string, anchor = false): string {
  return (
    `${PLACE_OF(anchor)} ` +
    (anchor
      ? 'Any person in it is a stand-in: the person in the references takes their place, their pose and their scale, with their own face and body. '
      : '') +
    'Put the person in the references into it as the hero portrait of this place: ' +
    'standing or seated where the place invites, at true human scale against its furniture and architecture, ' +
    'in the same light, with true contact and shadow. Keep the place exactly as it is: its camera, framing, light, ' +
    'materials and every object in it. ' +
    `${wardrobeRelease()} ${physicalPoseDirective()} Give them the expression the moment calls for. ` +
    (identity ? `${clean(identity)}. ` : '') +
    'Add no other person and no text'
  );
}

/**
 * A person with the product, for a world built around someone living with it.
 * Two of their views and one product photo ride with the place, which is what
 * every engine's edit can carry.
 */
export function heroBothInstruction(
  name: string,
  size: ProductSize | null,
  lines: string[],
  identity: string,
  anchor = false,
): string {
  const sized = size ? `, ${clean(size.text)}` : '';
  return (
    `${PLACE_OF(anchor)} ` +
    (anchor
      ? 'Any person in it is a stand-in: the person in the references takes their place, their pose and their scale, with their own face and body. ' +
        'A plain object it shows as the hero only marks where the product goes, and gives way to it. '
      : '') +
    `Put the person in the references into it as the hero of this place, with ${name}: holding, wearing or using it the way a real person does, ` +
    `${name} at its true real-world size${sized}, in true proportion to their hands and body. ` +
    'They stand or sit where the place invites, at true human scale against its furniture and architecture, ' +
    'in the same light, with true contact and shadow. Keep the place exactly as it is: its camera, framing, light, ' +
    'materials and every object in it. ' +
    `${wardrobeRelease()} ${physicalPoseDirective()} Give them the expression the moment calls for. ` +
    (identity ? `${clean(identity)}. ` : '') +
    (lines.length ? `${joinLines(lines)}. ` : '') +
    'Add no other person, no other product and no text'
  );
}

/**
 * The hero changed by the sentence that changed its place (Change something),
 * so the picture the person judged keeps its composition, its stand-ins and
 * their pose, and only what the sentence names moves.
 */
export function heroChangeInstruction(ask: string): string {
  const said = clean(ask);
  return (
    `input.png, changed only in this: ${said}. That change is the point of this picture. ` +
    'Everything the sentence does not touch stays exactly as it is: the person or product in it, their pose and ' +
    'place, the camera, the framing and the light. Add no text'
  );
}

const KEEP_PRODUCT = (name: string) =>
  `Keep ${name} exactly as it is, the same light and the same place; nothing new enters the frame`;
const KEEP_PERSON =
  'Keep their face, hair, skin and clothing exactly as they are, the same light and the same place; nothing new enters the frame';

export function closeInstruction(subject: ExampleSubject, name: string): string {
  return subject.kind === 'presenter'
    ? `move the camera in close on the person: head and shoulders fill the frame, with a shallow depth of field and the place behind them only as soft light and colour. ${KEEP_PERSON}`
    : `move the camera in close on ${name}: its surface, edge and material fill most of the frame, with a shallow depth of field and the place behind it only as soft light and colour. ${KEEP_PRODUCT(name)}`;
}

/**
 * The close-up of a set whose hero is a person with a product: the product's, never a
 * portrait, since a close-up is product-led wherever there is a product (Tony, 2026-09-25).
 * The person stays in it only where the product is worn. Said as a condition, like the
 * wearability line: no category list decides what is worn.
 */
export function closeWithPersonInstruction(name: string): string {
  return (
    `move the camera in close on ${name}: its surface, edge and material fill most of the frame, with a shallow ` +
    'depth of field and the place behind it only as soft light and colour. ' +
    `If ${name} is something a person wears, it stays on them where they wear it and the close-up shows it there, ` +
    'with only as much of them as frames it, their face in the frame only when it is worn on the face or head; ' +
    `otherwise it is ${name} in their hands or where it rests, and their face stays out of the frame. ` +
    `${KEEP_PRODUCT(name)}, and wherever they show, their skin, hands and clothing stay exactly as they are`
  );
}

export function handsInstruction(name: string): string {
  return (
    `a pair of anonymous hands, no face in the frame, picks up ${name} and holds it toward the camera, which comes close; ` +
    `the place stays the same behind them as soft light and colour. ${KEEP_PRODUCT(name)}. ` +
    `Five natural fingers on each hand, true contact, ${name} at its real size in the hands`
  );
}

/** A camera move made on the hero: for a person the moment moves on too, so the set is not one pose three times. */
export function cameraInstruction(subject: ExampleSubject, name: string, camera: string): string {
  return subject.kind === 'presenter'
    ? `the camera moves: ${clean(camera)}, and the moment moves on, a different pose and gesture than before. ${physicalPoseDirective()} ${KEEP_PERSON}`
    : `the camera moves: ${clean(camera)}. ${KEEP_PRODUCT(name)}`;
}

/* ------------------------------------------------------------ the job */

export interface ExampleJob {
  id: string;
  brandId: string;
  sceneId: string;
  /** What Activity calls it: the scene's name. */
  name: string;
  status: 'running' | 'done' | 'failed' | 'cancelled';
  /** The roles asked for, in order; the queue can grow while it runs. */
  roles: ExampleRole[];
  done: ExampleRole[];
  failed: { role: ExampleRole; error: string }[];
  current: ExampleRole | null;
  /** The place picture every example of this run is drawn from. */
  from: string;
  /** Who the rest of the set follows: the hero's presenter, else its product. */
  subject: ExampleSubject;
  /** Who stands in the hero. */
  with: HeroWith;
  startedAt: string;
  finishedAt: string | null;
  error: string | null;
}

/** What a run needs that only the server holds. */
export interface SceneExamplesDeps {
  core: Core;
  /** The engine that draws the studio's pictures (Codex first), or null when none can. */
  engine: () => Promise<EngineAdapter | null>;
  brandContext: (brandId: string) => BrandContext;
  demoProducts: readonly DemoProduct[];
  presenters: readonly Presenter[];
  /** The whole compile chain a shot goes through, for these tokens. */
  compile: (
    brandId: string,
    tokens: BriefToken[],
    engine: EngineAdapter,
    /** A scene not saved yet (the studio's hero), which the template token names. */
    scene?: CustomScene,
  ) => Promise<{ compiled: CompiledBrief; brand: any }>;
  sizes: ProductSizes;
  /** Let pictures nobody refers to any more go. */
  release: (hashes: string[]) => void;
  /**
   * The subject's own pictures are on disk. Scenri's library is downloaded
   * after install, and until it is there is nothing to stand in the place: a
   * run then would only fail, so none starts.
   */
  ready?: (subject: ExampleSubject) => boolean;
  log?: (obj: object, msg: string) => void;
}

/** One engine edit: the source, what to do, the pictures that ride and each one's role. */
type Edit = (
  source: string,
  instruction: string,
  refs: string[],
  role: ReferenceRole | ReferenceRole[],
) => Promise<string>;

/** The studio's hero, asked for with the place it draws (sceneStudio.ts). */
export interface HeroRequest {
  brandId: string;
  /** The scene as read, not yet saved: `preview` is the place just drawn, `id` the key its stand-ins are picked by. */
  scene: CustomScene;
  mode: HeroMode;
  /** Keep these stand-ins (a change of a hero that already has them). */
  with?: HeroWith;
  /** Change this hero by `ask` instead of drawing one fresh from the place. */
  prior?: string;
  ask?: string;
  signal: AbortSignal;
}
export interface HeroDrawn extends HeroWith {
  hash: string;
}

const HASH = /^[0-9a-f]{32}$/;
const hashOf = (ref: unknown): string | null => {
  const s = String(ref ?? '');
  const h = s.startsWith('asset:') ? s.slice(6) : '';
  return HASH.test(h) ? h : null;
};

/**
 * A refusal that can only repeat: signed out, out of plan, over the spend cap.
 * The rest of a set is not asked for one role at a time against it; the offer
 * draws them on the next press. Codex's own list (`isFatalSetupError`), with
 * the limits added.
 */
const REPEATS =
  /failed to spawn|not logged in|login required|\b401\b|unauthorized|is too old|environment is overriding|usage limit|spend cap/i;

export interface SceneExamples {
  /**
   * The scene's place picture changed. A run still drawing the earlier one is
   * stopped, because what it would land shows a place this scene no longer
   * has. Nothing is drawn in its place: that is `start`, and only a person
   * presses it.
   */
  placeChanged(brandId: string, sceneId: string): void;
  /**
   * Draw these roles now (Draw two pictures, Add three more, Try again, Redraw). Joins a run under way.
   * `named`: the roles were asked for by name (Try again on one picture), so nothing is added to them.
   */
  start(brandId: string, sceneId: string, roles: ExampleRole[], named?: boolean): ExampleJob;
  stop(brandId: string, sceneId: string): boolean;
  /** Take one example off the scene. */
  remove(brandId: string, sceneId: string, role: ExampleRole): boolean;
  status(brandId: string, sceneId: string): ExampleJob | null;
  /** What Add more would draw for this scene now: nothing while the library is missing. */
  offer(scene: CustomScene): ExampleRole[];
  /**
   * What the first press would draw: the automatic two for a scene with no
   * set, and the roles that still show an earlier picture for one whose set
   * the place moved under. Empty when every example shows this place, so the
   * offer is never made twice for the same picture.
   */
  offerFirst(scene: CustomScene): ExampleRole[];
  list(brandId: string): ExampleJob[];
  /** The scene was deleted: stop its run and let its pictures go. */
  sceneGone(brandId: string, sceneId: string, examples: SceneExample[]): void;
  runningCount(): number;
  settle(): Promise<void>;
  /**
   * The studio's hero: the place it just drew, in use, drawn before anything is
   * saved. Null when the mode is the place alone or nothing can stand in it.
   */
  drawHero(req: HeroRequest): Promise<HeroDrawn | null>;
}

export function createSceneExamples(deps: SceneExamplesDeps): SceneExamples {
  const jobs = new Map<string, ExampleJob>();
  const controllers = new Map<string, AbortController>();
  const tasks = new Map<string, Promise<void>>();
  const key = (brandId: string, sceneId: string) => `${brandId}:${sceneId}`;

  const sceneOf = (brandId: string, sceneId: string): CustomScene | undefined =>
    brandScenes(deps.core.store.getBrand(brandId)?.json).find((s) => s.id === sceneId);
  /**
   * The example's picture is in the library. A record can point at one that was
   * let go of (a studio version's hero Used again after a Try again replaced
   * it): that example counts as missing, so it is offered and drawn again, and
   * nothing is drawn from a file that is not there.
   */
  const stored = (e: SceneExample): boolean => {
    const h = hashOf(e.file);
    return !!h && deps.core.images.has(h);
  };

  /** Put one example on the scene, if it still shows the place it was drawn from. */
  const write = (job: ExampleJob, example: SceneExample): boolean => {
    let wrote = false;
    let replaced: string | null = null;
    commit(deps.core, job.brandId, (json) => {
      json.scenes = brandScenes(json).map((s: any) => {
        if (s.id !== job.sceneId || s.preview !== job.from) return s;
        wrote = true;
        const old = (s.examples ?? []) as SceneExample[];
        replaced = old.find((e) => e.role === example.role)?.file ?? null;
        const order = ORDER;
        const examples = [...old.filter((e) => e.role !== example.role), example].sort(
          (a, b) => order.indexOf(a.role) - order.indexOf(b.role),
        );
        return { ...s, examples };
      });
    });
    const gone = hashOf(replaced);
    if (gone && gone !== hashOf(example.file)) deps.release([gone]);
    return wrote;
  };

  /**
   * One engine edit of this scene's size, the cap asked first and the cost
   * kept after: every call here is spent quota.
   */
  function editorFor(
    engine: EngineAdapter,
    brandId: string,
    scene: Pick<CustomScene, 'width' | 'height'>,
    signal: AbortSignal,
  ): Edit {
    const engineId = engine.capabilities().id;
    const brand = deps.brandContext(brandId);
    const path = (h: string) => deps.core.images.pathFor(h);
    return async (source, instruction, refs, role) => {
      const req = {
        instruction,
        sourceImage: path(source),
        brand,
        referenceImages: refs.map(path),
        referenceRoles: refs.map((_, i) => (Array.isArray(role) ? role[i] : role)),
        width: scene.width,
        height: scene.height,
      };
      deps.core.ledger.assertUnderCap(engineId, await engine.costEstimate(req).catch(() => 0));
      const r = await engine.edit(req, signal);
      deps.core.ledger.recordCost(engineId, null, r.costUsd);
      if (!r.images[0]) throw new Error('the engine returned no picture');
      return checkedPicture(deps.core, r.images[0]);
    };
  }

  /**
   * A demo product as a shot would carry it into this scene: through the
   * compile a real shot goes through, so its name, photo, lines and measured
   * size are the ones a shot uses, and a small one is drawn at its own scale.
   * `inline` compiles a scene that is not saved yet (the studio's hero).
   */
  async function productIn(
    brandId: string,
    productId: string,
    scene: CustomScene,
    engine: EngineAdapter,
    signal: AbortSignal,
    inline: boolean,
  ) {
    const tokens = (words?: string): BriefToken[] => [
      { t: 'product', id: productId },
      ...(words ? [{ t: 'text' as const, v: ` ${words}` }] : []),
      { t: 'template', id: scene.id },
    ];
    const compileWith = (words?: string) =>
      deps.compile(brandId, tokens(words), engine, inline ? scene : undefined).then((r) => r.compiled);
    const compiled = await compileWith();
    const lead = compiled.lead;
    if (!lead) throw new Error("Scenri's library of demo products has not downloaded yet.");
    const size = await deps.sizes
      .ensure(
        brandId,
        {
          id: lead.productId,
          name: lead.name,
          dimensions: lead.dimensions ?? undefined,
          ...(lead.description ? { description: lead.description } : {}),
          photo: deps.core.images.pathFor(lead.productHash),
        },
        signal,
      )
      .catch(() => null);
    const engineId = engine.capabilities().id;
    const brand = deps.brandContext(brandId);
    /** The plate and then the placement, for a product small enough to need its own scale; null otherwise. */
    const atScale = async (words?: string): Promise<string | null> => {
      const plan = words ? (await compileWith(words)).scale : compiled.scale;
      if (!plan || !needsOwnScale(size)) return null;
      // Two draws a picture, the plate and then the placement, asked of the cap as one.
      const each = await engine
        .costEstimate({ prompt: plan.name, brand, width: scene.width, height: scene.height, count: 1 })
        .catch(() => 0);
      deps.core.ledger.assertUnderCap(engineId, 2 * each);
      const r = await drawAtScale({
        engine,
        images: deps.core.images,
        brand,
        plan,
        size,
        width: scene.width,
        height: scene.height,
        count: 1,
        signal,
        onImage: () => {},
      });
      deps.core.ledger.recordCost(engineId, null, r.costUsd);
      return r.images[0] ?? null;
    };
    return { lead, size, atScale };
  }

  /** A demo presenter's own pictures and the words that hold who they are. */
  async function presenterIn(
    brandId: string,
    presenterId: string,
    scene: CustomScene,
    engine: EngineAdapter,
    inline: boolean,
  ) {
    const { brand: json } = await deps.compile(
      brandId,
      [
        { t: 'character', id: presenterId },
        { t: 'template', id: scene.id },
      ],
      engine,
      inline ? scene : undefined,
    );
    const who = (json?.characters ?? []).find((c: any) => c?.id === presenterId);
    const refs = ((who?.shots ?? []) as { file?: string }[])
      .map((s) => hashOf(s.file))
      .filter((h): h is string => !!h && deps.core.images.has(h))
      .slice(0, 3);
    if (!refs.length) throw new Error("Scenri's library of demo presenters has not downloaded yet.");
    return {
      refs,
      name: String(who?.promptName ?? who?.name ?? 'the person'),
      identity: [who?.identityNotes, who?.facial, who?.skin, who?.build].filter(Boolean).join('. '),
    };
  }

  /**
   * The hero: the place with who stands in it, drawn from the place's own
   * picture. One path for the studio's first picture and the page's redraw, so
   * both are the same picture of the same idea.
   */
  async function heroPicture(o: {
    brandId: string;
    scene: CustomScene;
    placeHash: string;
    with: HeroWith;
    engine: EngineAdapter;
    signal: AbortSignal;
    inline: boolean;
    edit: Edit;
  }): Promise<string> {
    const anchor = o.scene.anchor === true;
    if (o.with.product && o.with.presenter) {
      const p = await productIn(o.brandId, o.with.product, o.scene, o.engine, o.signal, o.inline);
      const who = await presenterIn(o.brandId, o.with.presenter, o.scene, o.engine, o.inline);
      // Two of their views and the product: four with the place, inside every
      // engine's edit budget (Codex counts the place as one of five).
      const people = who.refs.slice(0, 2);
      return o.edit(
        o.placeHash,
        heroBothInstruction(p.lead.name, p.size, p.lead.productLines, who.identity, anchor),
        [...people, p.lead.productHash],
        [...people.map((): ReferenceRole => 'character'), 'product'],
      );
    }
    if (o.with.presenter) {
      const who = await presenterIn(o.brandId, o.with.presenter, o.scene, o.engine, o.inline);
      return o.edit(o.placeHash, heroPresenterInstruction(who.identity, anchor), who.refs, 'character');
    }
    const p = await productIn(o.brandId, o.with.product as string, o.scene, o.engine, o.signal, o.inline);
    return (
      (await p.atScale()) ??
      (await o.edit(
        o.placeHash,
        heroProductInstruction(p.lead.name, p.size, p.lead.productLines, anchor),
        [p.lead.productHash],
        'product',
      ))
    );
  }

  async function run(job: ExampleJob, signal: AbortSignal): Promise<void> {
    const engine = await deps.engine();
    if (!engine) throw new Error('Nothing can draw these right now. Connect Codex and try again.');
    const placeHash = hashOf(job.from) as string;
    let presenter: Awaited<ReturnType<typeof presenterIn>> | null = null;

    const heroOf = (scene: CustomScene) =>
      hashOf((scene.examples ?? []).find((e) => e.role === 'hero' && e.from === job.from && stored(e))?.file);

    for (let i = 0; i < job.roles.length; i++) {
      const role = job.roles[i];
      if (signal.aborted) return;
      const scene = sceneOf(job.brandId, job.sceneId);
      if (!scene || scene.preview !== job.from) return; // the place moved on, or is gone
      job.current = role;
      const edit = editorFor(engine, job.brandId, scene, signal);
      try {
        let hash: string;
        let setup: string | undefined;
        if (role === 'hero') {
          hash = await heroPicture({
            brandId: job.brandId,
            scene,
            placeHash,
            with: job.with,
            engine,
            signal,
            inline: false,
            edit,
          });
        } else if (job.subject.kind === 'product') {
          const p = await productIn(job.brandId, job.subject.id, scene, engine, signal, false);
          const hero = () => heroOf(sceneOf(job.brandId, job.sceneId) ?? scene);
          if (role === 'angle' || role === 'bold') {
            const framing = role === 'angle' ? angleFor(scene) : null;
            const words = framing ? FRAMING_CAMERA[framing] : BOLD_WORDS;
            if (framing) setup = framing;
            const drawn = await p.atScale(words);
            const heroHash = drawn ? null : hero();
            if (!drawn && !heroHash) throw new Error('The hero is not drawn yet.');
            hash =
              drawn ??
              (await edit(
                heroHash as string,
                cameraInstruction(job.subject, p.lead.name, words),
                [p.lead.productHash],
                'product',
              ));
          } else {
            const heroHash = hero();
            if (!heroHash) throw new Error('The hero is not drawn yet.');
            if (role === 'close') setup = 'close';
            hash = await edit(
              heroHash,
              role === 'close' ? closeInstruction(job.subject, p.lead.name) : handsInstruction(p.lead.name),
              [p.lead.productHash],
              'product',
            );
          }
        } else if (role === 'close' && job.with.product) {
          // A person with a product: the rest of the set follows the person, the close-up follows the product.
          const p = await productIn(job.brandId, job.with.product, scene, engine, signal, false);
          presenter ??= await presenterIn(job.brandId, job.subject.id, scene, engine, false);
          const heroHash = heroOf(sceneOf(job.brandId, job.sceneId) ?? scene);
          if (!heroHash) throw new Error('The hero is not drawn yet.');
          setup = 'close';
          hash = await edit(
            heroHash,
            closeWithPersonInstruction(p.lead.name),
            [p.lead.productHash, ...presenter.refs.slice(0, 1)],
            ['product', 'character'],
          );
        } else {
          presenter ??= await presenterIn(job.brandId, job.subject.id, scene, engine, false);
          const heroHash = heroOf(sceneOf(job.brandId, job.sceneId) ?? scene);
          if (!heroHash) throw new Error('The hero is not drawn yet.');
          const words =
            role === 'close'
              ? null
              : role === 'angle'
                ? 'down to ground level, low and closer, so they rise above it with the place behind them'
                : BOLD_WORDS;
          if (role === 'close') setup = 'close';
          hash = await edit(
            heroHash,
            words
              ? cameraInstruction(job.subject, presenter.name, words)
              : closeInstruction(job.subject, presenter.name),
            presenter.refs.slice(0, 1),
            'character',
          );
        }
        if (signal.aborted) {
          deps.release([hash]);
          return;
        }
        hash = await trimEdgeBars(deps.core, hash, deps.release);
        // The last moment a Stop can arrive before the write: from here the
        // example lands in one synchronous commit, so a picture finished after
        // Stop never goes on the scene.
        if (signal.aborted) {
          deps.release([hash]);
          return;
        }
        // The hero keeps everyone who stands in it, and so does a close-up that may show the product on them;
        // every other view names the one it follows.
        const who: HeroWith =
          role === 'hero' || (role === 'close' && job.with.product)
            ? job.with
            : job.subject.kind === 'product'
              ? { product: job.subject.id }
              : { presenter: job.subject.id };
        const wrote = write(job, {
          role,
          file: `asset:${hash}`,
          from: job.from,
          ...(setup ? { setup } : {}),
          ...(who.product ? { product: who.product } : {}),
          ...(who.presenter ? { presenter: who.presenter } : {}),
        });
        if (!wrote) {
          // The place moved on while this was drawing: nothing holds the picture.
          deps.release([hash]);
          return;
        }
        job.done.push(role);
      } catch (err: any) {
        if (signal.aborted) return;
        job.failed.push({ role, error: personError(err, 'This picture did not draw. Try it again.') });
        deps.log?.({ scene: job.sceneId, role, err: String(err?.message ?? err) }, 'scene example failed');
        // Without its hero the rest of a set has nothing to be drawn from, and
        // a refusal that can only repeat is not asked again for every role.
        if (role === 'hero' || REPEATS.test(String(err?.message ?? err))) return;
      }
    }
  }

  function begin(
    brandId: string,
    sceneId: string,
    roles: ExampleRole[],
    scene: CustomScene,
    named: boolean,
  ): ExampleJob | null {
    const k = key(brandId, sceneId);
    const live = jobs.get(k);
    const ctrl = controllers.get(k);
    if (live?.status === 'running') {
      // A run that was stopped is still unwinding, and one on an earlier place
      // throws what it draws away: neither takes the ask, which gets a run of
      // its own. The one on an earlier place is stopped, it spends for nothing.
      if (!ctrl?.signal.aborted && live.from === scene.preview) {
        // Joins the run: roles waiting or drawing now are not asked twice.
        const pending = live.roles.slice(live.current ? live.roles.indexOf(live.current) : 0);
        for (const r of roles) {
          if (pending.includes(r)) continue;
          live.roles.push(r);
          pending.push(r);
        }
        return live;
      }
      ctrl?.abort();
    }
    const standIns = standInsOf(scene, deps.demoProducts, deps.presenters);
    if (!standIns || !scene.preview || !readyAll(standIns.with)) return null;
    const { subject } = standIns;
    // Every other role is drawn from the hero, so a missing hero comes first.
    const hasHero = (scene.examples ?? []).some((e) => e.role === 'hero' && e.from === scene.preview && stored(e));
    // Try again on one picture promised that picture: it does not spend a hero
    // on the way. The offer that draws both is the honest door.
    if (!hasHero && named && !roles.includes('hero'))
      throw Object.assign(
        new Error(
          'The examples are drawn from the hero, and this picture of the place has none yet. Draw them again first.',
        ),
        { statusCode: 409 },
      );
    const queue: ExampleRole[] = [
      ...new Set<ExampleRole>(!hasHero && !roles.includes('hero') ? ['hero', ...roles] : roles),
    ];
    const job: ExampleJob = {
      id: randomUUID(),
      brandId,
      sceneId,
      name: scene.name,
      status: 'running',
      roles: queue,
      done: [],
      failed: [],
      current: null,
      from: scene.preview,
      subject,
      with: standIns.with,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      error: null,
    };
    jobs.set(k, job);
    const own = new AbortController();
    controllers.set(k, own);
    const task = run(job, own.signal)
      .then(() => {
        job.status = own.signal.aborted ? 'cancelled' : job.failed.length && !job.done.length ? 'failed' : 'done';
        if (job.status === 'failed') job.error = job.failed[0].error;
      })
      .catch((err) => {
        job.status = own.signal.aborted ? 'cancelled' : 'failed';
        job.error = personError(err, 'These pictures did not draw. Try them again.');
      })
      .finally(() => {
        job.current = null;
        job.finishedAt = new Date().toISOString();
        // only this run's own entries: a run begun after it keeps its own
        if (controllers.get(k) === own) controllers.delete(k);
        if (tasks.get(k) === task) tasks.delete(k);
      });
    tasks.set(k, task);
    return job;
  }

  const ready = (subject: ExampleSubject) => deps.ready?.(subject) ?? true;
  const readyAll = (w: HeroWith) =>
    (!w.product || ready({ kind: 'product', id: w.product })) &&
    (!w.presenter || ready({ kind: 'presenter', id: w.presenter }));

  /**
   * The scene's place picture changed. A run still drawing the earlier picture
   * is stopped: what it would land shows a place this scene no longer has, and
   * the write guard would throw it away anyway. Nothing is drawn to replace
   * it. The set it had stays, labelled as showing an earlier picture, and is
   * redrawn only when someone asks (`start`), because that is two to five
   * engine calls and saving a scene may not spend one.
   */
  function placeChanged(brandId: string, sceneId: string): void {
    const k = key(brandId, sceneId);
    const live = jobs.get(k);
    if (live?.status !== 'running') return;
    if (live.from === sceneOf(brandId, sceneId)?.preview) return;
    controllers.get(k)?.abort();
  }

  return {
    placeChanged,
    start(brandId, sceneId, roles, named = false) {
      const scene = sceneOf(brandId, sceneId);
      if (!scene) throw Object.assign(new Error('scene not found'), { statusCode: 404 });
      if (!scene.preview)
        throw Object.assign(new Error('this scene has no picture to draw from yet'), { statusCode: 409 });
      const job = begin(brandId, sceneId, [...new Set(roles)], scene, named);
      if (!job) {
        const why = standInsOf(scene, deps.demoProducts, deps.presenters)
          ? "Scenri's library has not downloaded yet, so it cannot be shown in use for now."
          : "Nothing in Scenri's library fits this scene yet.";
        throw Object.assign(new Error(why), { statusCode: 409 });
      }
      return job;
    },
    stop(brandId, sceneId) {
      const ctrl = controllers.get(key(brandId, sceneId));
      if (!ctrl) return false;
      ctrl.abort();
      return true;
    },
    remove(brandId, sceneId, role) {
      let gone: string | null = null;
      commit(deps.core, brandId, (json) => {
        json.scenes = brandScenes(json).map((s: any) => {
          if (s.id !== sceneId) return s;
          const old = (s.examples ?? []) as SceneExample[];
          gone = old.find((e) => e.role === role)?.file ?? null;
          const examples = old.filter((e) => e.role !== role);
          const next = { ...s, examples };
          if (!examples.length) delete next.examples;
          return next;
        });
      });
      const h = hashOf(gone);
      if (h) deps.release([h]);
      return !!gone;
    },
    status: (brandId, sceneId) => jobs.get(key(brandId, sceneId)) ?? null,
    offer(scene) {
      const standIns = standInsOf(scene, deps.demoProducts, deps.presenters);
      return standIns && readyAll(standIns.with) ? rolesFor(standIns.subject, 'more', scene.prompt) : [];
    },
    offerFirst(scene) {
      if (!scene.preview) return [];
      const standIns = standInsOf(scene, deps.demoProducts, deps.presenters);
      if (!standIns || !readyAll(standIns.with)) return [];
      const examples = (scene.examples ?? []).filter(stored);
      // Only what the place moved under, when it moved: a role already showing
      // this picture is not drawn again for the price of one that is not, and a
      // role taken off is not brought back with them. Otherwise the first two
      // that are missing, so a hero drawn with the place in the studio leaves
      // the close-up.
      const stale = examples.filter((e) => e.from !== scene.preview).map((e) => e.role);
      if (stale.length) return ORDER.filter((r) => stale.includes(r));
      const have = examples.map((e) => e.role);
      return rolesFor(standIns.subject, 'auto').filter((r) => !have.includes(r));
    },
    list: (brandId) => [...jobs.values()].filter((j) => j.brandId === brandId),
    sceneGone(brandId, sceneId, examples) {
      controllers.get(key(brandId, sceneId))?.abort();
      jobs.delete(key(brandId, sceneId));
      deps.release(examples.map((e) => hashOf(e.file)).filter((h): h is string => !!h));
    },
    runningCount: () => controllers.size,
    async drawHero(req) {
      if (req.mode === 'place') return null;
      const withs = req.with ?? heroWithFor(req.mode, req.scene, deps.demoProducts, deps.presenters);
      const placeHash = hashOf(req.scene.preview);
      if (!withs || !placeHash || !readyAll(withs)) return null;
      const engine = await deps.engine();
      if (!engine) return null;
      const edit = editorFor(engine, req.brandId, req.scene, req.signal);
      const drawn =
        req.prior && req.ask && deps.core.images.has(req.prior)
          ? await edit(req.prior, heroChangeInstruction(req.ask), [], 'reference')
          : await heroPicture({
              brandId: req.brandId,
              scene: req.scene,
              placeHash,
              with: withs,
              engine,
              signal: req.signal,
              inline: true,
              edit,
            });
      if (req.signal.aborted) {
        deps.release([drawn]);
        return null;
      }
      return { hash: await trimEdgeBars(deps.core, drawn, deps.release), ...withs };
    },
    async settle() {
      for (const c of controllers.values()) c.abort();
      await Promise.allSettled([...tasks.values()]);
    },
  };
}
