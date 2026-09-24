import { randomUUID } from 'node:crypto';
import type { BrandContext, Core, EngineAdapter, ReferenceRole } from '@scenri/core';
import { brandScenes, commit, type CustomScene, type SceneExample, type SceneExampleRole } from './assetRecords.js';
import type { BriefToken, CompiledBrief } from './brief.js';
import { trimEdgeBars } from './customAssets.js';
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
 * The rhythm (DESIGN.md): nothing here is ever drawn without being asked for.
 * Saving a scene spends nothing; the hero and a close-up are one press, three
 * more another. Every picture here is spent quota, so no path in this file
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
  const verticals = (scene.verticals ?? []).map((v) => v.toLowerCase());
  const pick = <T extends { id: string }>(xs: readonly T[]): T | null =>
    xs.length ? xs[stable(scene.id) % xs.length] : null;
  if (scene.subject === 'person' || scene.figure) {
    const fits = presenters.filter((p) =>
      (p.suitableCategories ?? []).some((c) => verticals.includes(String(c).toLowerCase())),
    );
    const p = pick(fits.length ? fits : presenters);
    return p ? { kind: 'presenter', id: p.id } : null;
  }
  const sport = verticals.includes('sport') ? demoProducts.filter((p) => SPORT.includes(p.id)) : [];
  const categories = new Set(verticals.flatMap((v) => CATEGORY_OF[v] ?? []));
  const fits = [...sport, ...demoProducts.filter((p) => categories.has(String(p.category)))];
  const fallback = demoProducts.filter((p) => DEFAULT_CATEGORIES.includes(String(p.category)));
  const p = pick(fits.length ? fits : fallback.length ? fallback : demoProducts);
  return p ? { kind: 'product', id: p.id } : null;
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
    'materials and every object in it. Dress them for this place to a commercial standard, never the plain base ' +
    'layers they were photographed in, and give them the expression the moment calls for. ' +
    (identity ? `${clean(identity)}. ` : '') +
    'Add no other person and no text'
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
    ? `the camera moves: ${clean(camera)}, and the moment moves on, a different pose and gesture than before. ${KEEP_PERSON}`
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
  subject: ExampleSubject;
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

const HASH = /^[0-9a-f]{32}$/;
const hashOf = (ref: unknown): string | null => {
  const s = String(ref ?? '');
  const h = s.startsWith('asset:') ? s.slice(6) : '';
  return HASH.test(h) ? h : null;
};

export interface SceneExamples {
  /**
   * The scene's place picture changed. A run still drawing the earlier one is
   * stopped, because what it would land shows a place this scene no longer
   * has. Nothing is drawn in its place: that is `start`, and only a person
   * presses it.
   */
  placeChanged(brandId: string, sceneId: string): void;
  /** Draw these roles now (Draw two pictures, Add three more, Try again, Redraw). Joins a run under way. */
  start(brandId: string, sceneId: string, roles: ExampleRole[]): ExampleJob;
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
}

export function createSceneExamples(deps: SceneExamplesDeps): SceneExamples {
  const jobs = new Map<string, ExampleJob>();
  const controllers = new Map<string, AbortController>();
  const tasks = new Map<string, Promise<void>>();
  const key = (brandId: string, sceneId: string) => `${brandId}:${sceneId}`;

  const sceneOf = (brandId: string, sceneId: string): CustomScene | undefined =>
    brandScenes(deps.core.store.getBrand(brandId)?.json).find((s) => s.id === sceneId);

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

  async function run(job: ExampleJob, signal: AbortSignal): Promise<void> {
    const engine = await deps.engine();
    if (!engine) throw new Error('Nothing can draw these right now. Connect Codex and try again.');
    const engineId = engine.capabilities().id;
    const brand = deps.brandContext(job.brandId);
    const placeHash = hashOf(job.from) as string;
    const path = (h: string) => deps.core.images.pathFor(h);

    // Every call is spent quota: the cap is asked first and the cost kept after.
    const edit = async (
      source: string,
      instruction: string,
      refs: string[],
      role: ReferenceRole,
      scene: CustomScene,
    ) => {
      const req = {
        instruction,
        sourceImage: path(source),
        brand,
        referenceImages: refs.map(path),
        referenceRoles: refs.map(() => role),
        width: scene.width,
        height: scene.height,
      };
      deps.core.ledger.assertUnderCap(engineId, await engine.costEstimate(req).catch(() => 0));
      const r = await engine.edit(req, signal);
      deps.core.ledger.recordCost(engineId, null, r.costUsd);
      if (!r.images[0]) throw new Error('the engine returned no picture');
      return r.images[0];
    };

    let subjectName = '';
    let presenterRefs: string[] = [];
    let identity = '';

    const heroOf = (scene: CustomScene) =>
      hashOf((scene.examples ?? []).find((e) => e.role === 'hero' && e.from === job.from)?.file);

    for (let i = 0; i < job.roles.length; i++) {
      const role = job.roles[i];
      if (signal.aborted) return;
      const scene = sceneOf(job.brandId, job.sceneId);
      if (!scene || scene.preview !== job.from) return; // the place moved on, or is gone
      job.current = role;
      try {
        let hash: string;
        let setup: string | undefined;
        if (job.subject.kind === 'product') {
          const tokens = (words?: string): BriefToken[] => [
            { t: 'product', id: job.subject.id },
            ...(words ? [{ t: 'text' as const, v: ` ${words}` }] : []),
            { t: 'template', id: job.sceneId },
          ];
          const { compiled } = await deps.compile(job.brandId, tokens(), engine);
          const lead = compiled.lead;
          if (!lead) throw new Error("Scenri's library of demo products has not downloaded yet.");
          subjectName = lead.name;
          const size = await deps.sizes
            .ensure(
              job.brandId,
              {
                id: lead.productId,
                name: lead.name,
                dimensions: lead.dimensions ?? undefined,
                ...(lead.description ? { description: lead.description } : {}),
                photo: path(lead.productHash),
              },
              signal,
            )
            .catch(() => null);
          const atScale = async (words?: string) => {
            const plan = words
              ? (await deps.compile(job.brandId, tokens(words), engine)).compiled.scale
              : compiled.scale;
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
          const hero = () => heroOf(sceneOf(job.brandId, job.sceneId) ?? scene);
          if (role === 'hero') {
            hash =
              (await atScale()) ??
              (await edit(
                placeHash,
                heroProductInstruction(lead.name, size, lead.productLines, scene.anchor === true),
                [lead.productHash],
                'product',
                scene,
              ));
          } else if (role === 'angle' || role === 'bold') {
            const framing = role === 'angle' ? angleFor(scene) : null;
            const words = framing ? FRAMING_CAMERA[framing] : BOLD_WORDS;
            if (framing) setup = framing;
            const drawn = await atScale(words);
            const heroHash = drawn ? null : hero();
            if (!drawn && !heroHash) throw new Error('The hero is not drawn yet.');
            hash =
              drawn ??
              (await edit(
                heroHash as string,
                cameraInstruction(job.subject, lead.name, words),
                [lead.productHash],
                'product',
                scene,
              ));
          } else {
            const heroHash = hero();
            if (!heroHash) throw new Error('The hero is not drawn yet.');
            if (role === 'close') setup = 'close';
            hash = await edit(
              heroHash,
              role === 'close' ? closeInstruction(job.subject, lead.name) : handsInstruction(lead.name),
              [lead.productHash],
              'product',
              scene,
            );
          }
        } else {
          if (!presenterRefs.length) {
            const { brand: json } = await deps.compile(
              job.brandId,
              [
                { t: 'character', id: job.subject.id },
                { t: 'template', id: job.sceneId },
              ],
              engine,
            );
            const who = (json?.characters ?? []).find((c: any) => c?.id === job.subject.id);
            presenterRefs = ((who?.shots ?? []) as { file?: string }[])
              .map((s) => hashOf(s.file))
              .filter((h): h is string => !!h && deps.core.images.has(h))
              .slice(0, 3);
            if (!presenterRefs.length) throw new Error("Scenri's library of demo presenters has not downloaded yet.");
            subjectName = String(who?.promptName ?? who?.name ?? 'the person');
            identity = [who?.identityNotes, who?.facial, who?.skin, who?.build].filter(Boolean).join('. ');
          }
          const heroHash = heroOf(sceneOf(job.brandId, job.sceneId) ?? scene);
          if (role === 'hero') {
            hash = await edit(
              placeHash,
              heroPresenterInstruction(identity, scene.anchor === true),
              presenterRefs,
              'character',
              scene,
            );
          } else {
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
              words ? cameraInstruction(job.subject, subjectName, words) : closeInstruction(job.subject, subjectName),
              presenterRefs.slice(0, 1),
              'character',
              scene,
            );
          }
        }
        if (signal.aborted) return;
        hash = await trimEdgeBars(deps.core, hash);
        const wrote = write(job, {
          role,
          file: `asset:${hash}`,
          from: job.from,
          ...(setup ? { setup } : {}),
          ...(job.subject.kind === 'product' ? { product: job.subject.id } : { presenter: job.subject.id }),
        });
        if (!wrote) {
          // The place moved on while this was drawing: nothing holds the picture.
          deps.release([hash]);
          return;
        }
        job.done.push(role);
      } catch (err: any) {
        if (signal.aborted) return;
        job.failed.push({ role, error: String(err?.message ?? err) });
        deps.log?.({ scene: job.sceneId, role, err: String(err?.message ?? err) }, 'scene example failed');
        // Without its hero the rest of a set has nothing to be drawn from.
        if (role === 'hero') return;
      }
    }
  }

  function begin(brandId: string, sceneId: string, roles: ExampleRole[], scene: CustomScene): ExampleJob | null {
    const k = key(brandId, sceneId);
    const live = jobs.get(k);
    if (live?.status === 'running') {
      // Joins the run: roles not already waiting go on the end of its queue.
      const pending = live.roles.slice(live.current ? live.roles.indexOf(live.current) + 1 : 0);
      for (const r of roles) if (!pending.includes(r)) live.roles.push(r);
      return live;
    }
    const subject = pickSubject(scene, deps.demoProducts, deps.presenters);
    if (!subject || !scene.preview || !ready(subject)) return null;
    // Every other role is drawn from the hero, so a missing hero comes first.
    const hasHero = (scene.examples ?? []).some((e) => e.role === 'hero' && e.from === scene.preview);
    const queue: ExampleRole[] = !hasHero && !roles.includes('hero') ? ['hero', ...roles] : [...roles];
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
      startedAt: new Date().toISOString(),
      finishedAt: null,
      error: null,
    };
    jobs.set(k, job);
    const ctrl = new AbortController();
    controllers.set(k, ctrl);
    const task = run(job, ctrl.signal)
      .then(() => {
        job.status = ctrl.signal.aborted ? 'cancelled' : job.failed.length && !job.done.length ? 'failed' : 'done';
        if (job.status === 'failed') job.error = job.failed[0].error;
      })
      .catch((err) => {
        job.status = ctrl.signal.aborted ? 'cancelled' : 'failed';
        job.error = String(err?.message ?? err);
      })
      .finally(() => {
        job.current = null;
        job.finishedAt = new Date().toISOString();
        // only this run's own entries: a run begun after it keeps its own
        if (controllers.get(k) === ctrl) controllers.delete(k);
        if (tasks.get(k) === task) tasks.delete(k);
      });
    tasks.set(k, task);
    return job;
  }

  const ready = (subject: ExampleSubject) => deps.ready?.(subject) ?? true;

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
    start(brandId, sceneId, roles) {
      const scene = sceneOf(brandId, sceneId);
      if (!scene) throw Object.assign(new Error('scene not found'), { statusCode: 404 });
      if (!scene.preview)
        throw Object.assign(new Error('this scene has no picture to draw from yet'), { statusCode: 409 });
      const job = begin(brandId, sceneId, roles, scene);
      if (!job) {
        const subject = pickSubject(scene, deps.demoProducts, deps.presenters);
        const why = subject
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
      const subject = pickSubject(scene, deps.demoProducts, deps.presenters);
      return subject && ready(subject) ? rolesFor(subject, 'more', scene.prompt) : [];
    },
    offerFirst(scene) {
      if (!scene.preview) return [];
      const subject = pickSubject(scene, deps.demoProducts, deps.presenters);
      if (!subject || !ready(subject)) return [];
      const examples = scene.examples ?? [];
      if (!examples.length) return rolesFor(subject, 'auto');
      // only what the place moved under: a role already showing this picture
      // is not drawn again for the price of one that is not
      const stale = examples.filter((e) => e.from !== scene.preview).map((e) => e.role);
      return ORDER.filter((r) => stale.includes(r));
    },
    list: (brandId) => [...jobs.values()].filter((j) => j.brandId === brandId),
    sceneGone(brandId, sceneId, examples) {
      controllers.get(key(brandId, sceneId))?.abort();
      jobs.delete(key(brandId, sceneId));
      deps.release(examples.map((e) => hashOf(e.file)).filter((h): h is string => !!h));
    },
    runningCount: () => controllers.size,
    async settle() {
      for (const c of controllers.values()) c.abort();
      await Promise.allSettled([...tasks.values()]);
    },
  };
}
