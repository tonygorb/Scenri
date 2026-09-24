import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import type { Core } from '@scenri/core';
import { contentFile } from './content/overlay.js';

/**
 * A presenter is a curated, identity-locked person: a name, a fixed
 * appearance, and a 4-shot reference set. Presenters attach straight from
 * this catalog into a brief, the same way a Scene does — no per-brand roster
 * copy. `brandJsonWithResolvedPresenters` below is the read-through resolver
 * that makes that work; `characters[]` on a brand only holds whatever older
 * casts left behind before this catalog existed.
 */
export type PresenterPresentation = 'woman' | 'man';

export interface Presenter {
  id: string;
  name: string;
  presentation: PresenterPresentation;
  /** The casting-sheet caption, e.g. "Warm editorial · dark waves · confident, understated". */
  descriptor: string;
  ageRange: string;
  facial: string;
  skin: string;
  hair: string;
  build: string;
  wardrobeDefault: string;
  /** Industry filters, mirrors Scene's `verticals`. */
  suitableCategories: string[];
  /** Style/mood tags, mirrors Scene's `collections`. */
  suitableStyles: string[];
  identityNotes: string;
  negativeConstraints: string[];
  width: number;
  height: number;
}

const PRESENTATIONS = new Set<PresenterPresentation>(['woman', 'man']);
const ID = /^[a-z0-9-]+$/;

function isPresenter(x: any): x is Presenter {
  return (
    x &&
    typeof x.id === 'string' &&
    ID.test(x.id) &&
    typeof x.name === 'string' &&
    PRESENTATIONS.has(x.presentation) &&
    typeof x.descriptor === 'string' &&
    typeof x.ageRange === 'string' &&
    typeof x.facial === 'string' &&
    typeof x.skin === 'string' &&
    typeof x.hair === 'string' &&
    typeof x.build === 'string' &&
    typeof x.wardrobeDefault === 'string' &&
    Array.isArray(x.suitableCategories) &&
    x.suitableCategories.every((c: any) => typeof c === 'string' && c) &&
    Array.isArray(x.suitableStyles) &&
    x.suitableStyles.every((s: any) => typeof s === 'string' && s) &&
    typeof x.identityNotes === 'string' &&
    Array.isArray(x.negativeConstraints) &&
    x.negativeConstraints.every((n: any) => typeof n === 'string' && n) &&
    Number.isFinite(x.width) &&
    Number.isFinite(x.height)
  );
}

/** Load presenter files; a bad file is skipped with a warning, never fatal. */
export function loadPresenters(dir = defaultPresentersDir()): { presenters: Presenter[]; warnings: string[] } {
  const warnings: string[] = [];
  if (!dir || !existsSync(dir)) return { presenters: [], warnings: [`presenters dir not found: ${dir}`] };
  const presenters: Presenter[] = [];
  for (const f of readdirSync(dir)
    .filter((n) => n.endsWith('.json'))
    .sort()) {
    try {
      const parsed = JSON.parse(readFileSync(join(dir, f), 'utf8'));
      if (isPresenter(parsed)) presenters.push(parsed);
      else warnings.push(`invalid presenter skipped: ${f}`);
    } catch {
      warnings.push(`unparseable presenter skipped: ${f}`);
    }
  }
  return { presenters, warnings };
}

export function presenterResolver(presenters: Presenter[]): (id: string) => Presenter | undefined {
  const byId = new Map<string, Presenter>();
  for (const p of presenters) byId.set(p.id, p);
  return (id: string) => byId.get(id);
}

/** Every category and style actually in use, for the library filters. */
export function presenterFacetsOf(presenters: Presenter[]): { categories: string[]; styles: string[] } {
  const categories = new Set<string>();
  const styles = new Set<string>();
  for (const p of presenters) {
    for (const c of p.suitableCategories) categories.add(c);
    for (const s of p.suitableStyles) styles.add(s);
  }
  return { categories: [...categories].sort(), styles: [...styles].sort() };
}

/** Which reference slot is which angle — the fixed 4-shot identity plan every presenter follows: full-length front, left profile, right profile, back, all standing in the same pose. */
export const PRESENTER_ANGLES: [string, string][] = [
  ['ref-01', 'front'],
  ['ref-02', 'left-profile'],
  ['ref-03', 'right-profile'],
  ['ref-04', 'back'],
];

/**
 * The Studio v2 view set a curated presenter may ship instead of the four
 * ref-NN frames: the same views a presenter made in the studio has
 * (presenterPrompts.ts VIEW_ROLES), each named by its view, with the avatar as
 * the portrait. Order is the identity plan's order.
 */
const VIEW_FILES = ['front', 'three-quarter', 'back', 'left', 'right'] as const;

/**
 * A curated presenter's standing views, each with its angle. A presenter that
 * ships any v2 view is read as v2, and its older ref-NN frames are ignored;
 * one that ships none keeps the four-frame plan above.
 */
export function presenterViews(templatesRoot: string, id: string): { slot: string; angle: string; path: string }[] {
  const at = (slot: string, angle: string) => ({ slot, angle, path: presenterRefPath(templatesRoot, id, slot) });
  const v2 = VIEW_FILES.map((view) => at(view, view)).filter((f) => existsSync(f.path));
  if (v2.length) return v2;
  return PRESENTER_ANGLES.map(([slot, angle]) => at(slot, angle)).filter((f) => existsSync(f.path));
}

/**
 * What a curated presenter's page shows: the portrait first, labelled Face,
 * the way a presenter made in the studio leads its shots with its portrait,
 * then the standing views. Page only: a brief already leads with the avatar,
 * so the portrait is never attached twice.
 */
export function presenterPageFrames(
  templatesRoot: string,
  id: string,
): { slot: string; angle: string; path: string }[] {
  const views = presenterViews(templatesRoot, id);
  const portrait = presenterRefPath(templatesRoot, id, 'portrait');
  return existsSync(portrait) ? [{ slot: 'portrait', angle: 'portrait', path: portrait }, ...views] : views;
}

/** A frame file name the preview route serves: the portrait, a v2 view or a ref-NN slot. */
export const PRESENTER_FRAME_FILE = /^(ref-[0-9]{2}|portrait|front|three-quarter|back|left|right)\.jpg$/;

export function presenterRefPath(templatesRoot: string, id: string, slot: string): string {
  // Overlays the downloaded library cache: the npm install carries no identity
  // sets, so post-fetch these resolve into ~/.scenri/content transparently.
  return contentFile(templatesRoot, 'previews', 'presenters', id, `${slot}.jpg`);
}

/**
 * The square head-and-shoulders portrait.
 *
 * It sits outside PRESENTER_ANGLES because it is not one of the four standing
 * views, not because it is decoration. It used to be excluded from the
 * identity plan on the grounds that it is a display asset, and that was a
 * measured mistake: it is 1024x1024 of head and shoulders, so the face is
 * around 450px brow to chin, while ref-01 is a 1024x1280 full-length frame
 * whose face is about 105px. Roughly eighteen times the facial pixels were
 * shipping with every curated presenter and never leaving the disk, which is
 * why four outputs of one brief came back with four different jaws.
 */
export function presenterAvatarPath(templatesRoot: string, id: string): string {
  return contentFile(templatesRoot, 'previews', 'presenters', id, 'avatar.jpg');
}

/**
 * Loads one curated presenter's reference angles into the image store,
 * hashing each on first use. A read-through cache, not a write to any
 * brand's data — nothing here touches `characters[]`.
 */
/**
 * Decoded once per process, keyed by source file.
 *
 * Every compile that names a curated presenter used to re-read and re-encode
 * their reference JPEGs, and the store is content-addressed so the work was
 * thrown away every time. That is per preview keystroke as well as per
 * generation, and the portrait made it five files instead of four.
 */
const resolvedRefs = new Map<string, string>();

async function refHash(core: Core, path: string): Promise<string> {
  // Keyed by the file's version as well as its path: a library update swaps
  // the pictures under the same names while the server keeps running.
  const { mtimeMs, size } = statSync(path);
  const key = `${path}\0${mtimeMs}\0${size}`;
  const hit = resolvedRefs.get(key);
  // Verified before it is trusted: a hash is only valid for the store that
  // holds it, and tests build a fresh core per case.
  if (hit && core.images.has(hit)) return hit;
  const hash = core.images.save(await sharp(readFileSync(path)).png().toBuffer());
  resolvedRefs.set(key, hash);
  return hash;
}

export async function resolvePresenterImages(
  core: Core,
  templatesRoot: string,
  presenter: Presenter,
): Promise<{
  id: string;
  name: string;
  identityNotes?: string;
  negativeConstraints?: string[];
  skin?: string;
  facial?: string;
  build?: string;
  shots: { file: string; angle: string; locked: boolean }[];
} | null> {
  const shots: { file: string; angle: string; locked: boolean }[] = [];
  // The portrait leads, because that is the order a brief attaches: shots[0]
  // is the essential character reference, and a face is what an identity is.
  // The standing views still ride behind it and still carry build, proportion
  // and the capture wardrobe the release clause names.
  const avatar = presenterAvatarPath(templatesRoot, presenter.id);
  if (existsSync(avatar)) shots.push({ file: `asset:${await refHash(core, avatar)}`, angle: 'portrait', locked: true });
  for (const { angle, path } of presenterViews(templatesRoot, presenter.id)) {
    shots.push({ file: `asset:${await refHash(core, path)}`, angle, locked: true });
  }
  if (!shots.length) return null;
  // The casting sheet travels with the photos. These used to be dropped here,
  // so a curated presenter reached the compiler as a bare name and two shots
  // while a custom one kept its notes — same compile path, thinner payload.
  // `skin` rides too: it is rendering behavior the reference pixels cannot
  // enforce at generation time ("faint natural lines, minimal retouch"), and
  // dropping it here is part of why presenters came back airbrushed.
  //
  // `facial` and `build` ride now as well. They were held back on the stated
  // grounds that they are "geometry the four reference photographs already
  // lock", and that turned out to be false: the four photographs are
  // full-length by construction, so the face is about 105px brow to chin,
  // and nothing in them pins a jaw. Measured 2026-08-30 against the reported
  // failure of four outputs of one brief coming back with four different
  // jaws. All 21 curated presenters carry a facial descriptor and none of it
  // was reaching the model.
  //
  // `hair` is forwarded since 2026-09-24: a direction may still restyle it,
  // and the compiler decides that from the brief's own words (hairDirective).
  //
  // Still deliberately NOT forwarded: wardrobeDefault (the capture uniform is
  // not a wardrobe instruction) and promptName (a curated presenter is named
  // by `name`, which is why renaming one is a generation change).
  return {
    id: presenter.id,
    name: presenter.name,
    ...(presenter.identityNotes ? { identityNotes: presenter.identityNotes } : {}),
    ...(presenter.negativeConstraints?.length ? { negativeConstraints: presenter.negativeConstraints } : {}),
    ...(presenter.skin ? { skin: presenter.skin } : {}),
    ...(presenter.facial ? { facial: presenter.facial } : {}),
    ...(presenter.hair ? { hair: presenter.hair } : {}),
    ...(presenter.build ? { build: presenter.build } : {}),
    shots,
  };
}

/**
 * A brief's `character` tokens may name a curated presenter directly rather
 * than a `characters[]` roster entry. This resolves only the ones actually
 * referenced (never the whole catalog) and folds them into a throwaway copy
 * of the brand json for `compileBrief` to read — existing `characters[]`
 * entries (older casts) are left exactly as they are and take priority, so
 * nothing already generated changes meaning.
 */
export async function brandJsonWithResolvedPresenters(
  core: Core,
  templatesRoot: string,
  presenters: Presenter[],
  brandJson: any,
  tokens: { t: string; id?: string }[],
): Promise<any> {
  const existing: any[] = brandJson?.characters ?? [];
  const neededIds = new Set(
    tokens.filter((t) => t.t === 'character' && typeof t.id === 'string').map((t) => t.id as string),
  );
  const missingIds = [...neededIds].filter((id) => !existing.some((c) => c.id === id));
  if (!missingIds.length) return brandJson;

  const extra: any[] = [];
  for (const id of missingIds) {
    const presenter = presenters.find((p) => p.id === id);
    if (!presenter) continue;
    const resolved = await resolvePresenterImages(core, templatesRoot, presenter);
    if (resolved) extra.push(resolved);
  }
  return extra.length ? { ...brandJson, characters: [...existing, ...extra] } : brandJson;
}

export function defaultPresentersDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  // dev: monorepo root /templates/presenters; published: bundled next to package
  for (const p of [
    join(here, '..', '..', '..', 'templates', 'presenters'),
    join(here, '..', 'templates', 'presenters'),
  ]) {
    if (existsSync(p)) return p;
  }
  return join(here, '..', '..', '..', 'templates', 'presenters');
}
