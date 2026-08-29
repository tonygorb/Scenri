import { readdirSync, readFileSync, existsSync } from 'node:fs';
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

export function presenterRefPath(templatesRoot: string, id: string, slot: string): string {
  // Overlays the downloaded library cache: the npm install carries no identity
  // sets, so post-fetch these resolve into ~/.scenri/content transparently.
  return contentFile(templatesRoot, 'previews', 'presenters', id, `${slot}.jpg`);
}

/**
 * The square head-and-shoulders portrait, for UI surfaces that render a presenter
 * small or square. Deliberately outside PRESENTER_ANGLES: it is a display asset,
 * not part of the identity plan sent to the engine, so `resolvePresenterImages`
 * never picks it up and no brief's output changes because it exists.
 */
export function presenterAvatarPath(templatesRoot: string, id: string): string {
  return contentFile(templatesRoot, 'previews', 'presenters', id, 'avatar.jpg');
}

/**
 * Loads one curated presenter's reference angles into the image store,
 * hashing each on first use. A read-through cache, not a write to any
 * brand's data — nothing here touches `characters[]`.
 */
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
  shots: { file: string; angle: string; locked: boolean }[];
} | null> {
  const shots: { file: string; angle: string; locked: boolean }[] = [];
  for (const [slot, angle] of PRESENTER_ANGLES) {
    const path = presenterRefPath(templatesRoot, presenter.id, slot);
    if (!existsSync(path)) continue;
    const png = await sharp(readFileSync(path)).png().toBuffer();
    const hash = core.images.save(png);
    shots.push({ file: `asset:${hash}`, angle, locked: true });
  }
  if (!shots.length) return null;
  // The casting sheet travels with the photos. These used to be dropped here,
  // so a curated presenter reached the compiler as a bare name and two shots
  // while a custom one kept its notes — same compile path, thinner payload.
  // `skin` rides too: it is rendering behavior the reference pixels cannot
  // enforce at generation time ("faint natural lines, minimal retouch"), and
  // dropping it here is part of why presenters came back airbrushed.
  // Deliberately NOT forwarded: `facial`, `hair` and `build` (geometry the
  // four reference photographs already lock), wardrobeDefault (the capture
  // uniform is not a wardrobe instruction) and promptName (a curated
  // presenter is named by `name`, which is why renaming one is a generation
  // change).
  return {
    id: presenter.id,
    name: presenter.name,
    ...(presenter.identityNotes ? { identityNotes: presenter.identityNotes } : {}),
    ...(presenter.negativeConstraints?.length ? { negativeConstraints: presenter.negativeConstraints } : {}),
    ...(presenter.skin ? { skin: presenter.skin } : {}),
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
