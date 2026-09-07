import { randomUUID } from 'node:crypto';
import { draw, trimEdgeBars, type AssetBuildDeps } from './customAssets.js';
import { DERIVABLE_ANGLES } from './productPlan.js';
import type { ThumbStore } from './thumbs.js';

/**
 * A drawn view of a product, one at a time, held for a decision.
 *
 * Not an asset build. A build is fire-and-forget and commits at the end; a
 * candidate is a handshake with pending state, it is never written anywhere
 * until Save names it, and the notification bell must never see it. So it has
 * its own small registry, and reuses only the parts a build reuses: the one
 * draw helper, the edge-bar trim and the ledger's cost cap.
 *
 * Every candidate is drawn from the same evidence: all of the product's
 * photographs first, then the views already kept, capped by the engine. Never
 * from a previous candidate alone, so nothing drifts by chaining.
 *
 * Bytes are cleaned up. This is the first thing in Scenri that deletes from
 * the image store, and it does so behind three guards: only a hash this
 * candidate minted and nothing else referenced at the time (`bornHere`), only
 * after asking the store again whether anything references it now, and never
 * from a route (the routes call `reject`, `cancel` and `abandon`; the unlink is
 * here).
 */
export type CandidateStage = 'queued' | 'drawing' | 'ready' | 'kept' | 'rejected' | 'failed' | 'cancelled';

export interface ProductCandidate {
  id: string;
  brandId: string;
  /** The studio draft this belongs to: one product-addition attempt. */
  draftId: string;
  angle: string;
  attempt: number;
  correction: string | null;
  stage: CandidateStage;
  /** The offered frame once `ready`, and while `kept`. */
  hash: string | null;
  error: string | null;
  startedAt: string;
  /** No work is running: ready, kept, rejected, failed or cancelled. */
  finished: boolean;
}

interface Live extends ProductCandidate {
  /** Hashes this candidate minted that nothing else referenced when it did. The only hashes it may ever delete. */
  bornHere: Set<string>;
}

export interface CandidateSheet {
  promptName?: string | null;
  materials?: string | null;
  primaryColors?: string | null;
  preservationNotes?: string | null;
  negativeConstraints?: string | null;
}

export interface CandidateDeps extends AssetBuildDeps {
  thumbs?: ThumbStore | null;
}

export interface StartCandidateInput {
  brandId: string;
  draftId: string;
  angle: string;
  photoHashes: string[];
  keptHashes?: string[];
  sheet?: CandidateSheet | null;
  correction?: string | null;
  attempt?: number;
}

const candidates = new Map<string, Live>();
const running = new Map<string, AbortController>();
const DERIVABLE = new Set<string>(DERIVABLE_ANGLES);
/** How many settled candidates a brand keeps around for the studio to read back. */
const KEEP_SETTLED_PER_BRAND = 24;

const fail = (message: string, statusCode: number) => Object.assign(new Error(message), { statusCode });

export function getCandidate(id: string): ProductCandidate | undefined {
  const c = candidates.get(id);
  return c ? publicView(c) : undefined;
}

/** The record without the bookkeeping: what a route answers with. */
function publicView(c: Live): ProductCandidate {
  const { bornHere: _born, ...rest } = c;
  return rest;
}

/** Test seam: the module-level registry outlives a test server otherwise. */
export function resetProductCandidates(): void {
  for (const ctrl of running.values()) ctrl.abort();
  running.clear();
  candidates.clear();
}

/** The drawn views this brand kept and has not yet saved or abandoned: what Save may accept as derived. */
export function keptCandidateHashes(brandId: string): Set<string> {
  const out = new Set<string>();
  for (const c of candidates.values()) if (c.brandId === brandId && c.stage === 'kept' && c.hash) out.add(c.hash);
  return out;
}

export function startCandidate(deps: CandidateDeps, input: StartCandidateInput): { jobId: string } {
  const { core } = deps;
  const brand = core.store.getBrand(input.brandId);
  if (!brand) throw fail('brand not found', 404);
  if (!DERIVABLE.has(input.angle)) throw fail(`a ${input.angle} view can only come from a photograph`, 400);
  const valid = (h: string) => /^[a-f0-9]{32}$/.test(h) && core.images.has(h);
  const photos = input.photoHashes.filter(valid);
  if (!photos.length || photos.length !== input.photoHashes.length)
    throw fail('every photograph must already be in the store, and there must be at least one', 400);
  const kept = (input.keptHashes ?? []).filter(valid);
  if (!deps.engine) throw fail('no engine here can draw a view', 400);
  for (const c of candidates.values()) {
    if (c.brandId === brand.id && c.draftId === input.draftId && !c.finished)
      throw fail('a view is already being drawn for this product', 409);
  }

  const caps = deps.engine.capabilities();
  // Photographs first, then the kept views, so a tight engine cap sheds the
  // estimates before any photograph. Never a previous candidate alone.
  const refs = [...photos, ...kept].slice(0, caps.maxReferenceImages || 1).map((h) => core.images.pathFor(h));
  const job: Live = {
    id: `pc-${randomUUID().slice(0, 8)}`,
    brandId: brand.id,
    draftId: String(input.draftId).slice(0, 80),
    angle: input.angle,
    attempt: Math.max(1, Math.floor(input.attempt ?? 1)),
    correction: input.correction ? String(input.correction).slice(0, 200) : null,
    stage: 'queued',
    hash: null,
    error: null,
    startedAt: new Date().toISOString(),
    finished: false,
    bornHere: new Set(),
  };
  candidates.set(job.id, job);
  prune(brand.id);

  const ctrl = new AbortController();
  running.set(job.id, ctrl);
  const prompt = neutralCapturePrompt(input.angle, input.sheet ?? null, job.correction);
  void runDraw(deps, job, refs, prompt, ctrl.signal).finally(() => running.delete(job.id));
  return { jobId: job.id };
}

async function runDraw(deps: CandidateDeps, job: Live, refs: string[], prompt: string, signal: AbortSignal) {
  const { core } = deps;
  try {
    patch(job, { stage: 'drawing' });
    const raw = await draw(deps, {
      prompt,
      brandId: job.brandId,
      referenceImages: refs,
      referenceRoles: refs.map(() => 'product' as const),
      signal,
    });
    // Born here: a hash nothing referenced the moment it landed. Identical
    // bytes to a picture already in use answer with that picture's hash, and
    // that one is never ours to delete.
    if (!core.store.imageReferenced(raw)) job.bornHere.add(raw);
    // A bar left on the frame would be conditioned on and faithfully drawn
    // into every future shot. The trim mints a second blob; the raw one is
    // garbage whatever the decision, so it goes now.
    const offered = await trimEdgeBars(core, raw);
    if (offered !== raw) {
      if (!core.store.imageReferenced(offered)) job.bornHere.add(offered);
      if (job.bornHere.delete(raw)) discardHash(deps, raw);
    }
    if (signal.aborted) throw new Error('cancelled');
    patch(job, { stage: 'ready', hash: offered, finished: true });
  } catch (err: any) {
    discard(deps, job);
    if (signal.aborted) patch(job, { stage: 'cancelled', hash: null, finished: true });
    else patch(job, { stage: 'failed', hash: null, error: String(err?.message ?? err), finished: true });
  }
}

export function keepCandidate(id: string): ProductCandidate {
  const c = candidates.get(id);
  if (!c) throw fail('candidate not found', 404);
  if (c.stage !== 'ready' && c.stage !== 'kept') throw fail('only a drawn view can be kept', 409);
  patch(c, { stage: 'kept' });
  return publicView(c);
}

/** Drop a view nobody wants. Its bytes leave with it. A view still being drawn is cancelled first. */
export function rejectCandidate(deps: CandidateDeps, id: string): ProductCandidate {
  const c = candidates.get(id);
  if (!c) throw fail('candidate not found', 404);
  if (!c.finished) throw fail('cancel the drawing first', 409);
  discard(deps, c);
  patch(c, { stage: 'rejected', hash: null });
  return publicView(c);
}

export function cancelCandidate(id: string): boolean {
  const ctrl = running.get(id);
  if (!ctrl) return false;
  ctrl.abort();
  return true;
}

/**
 * The draft is over without a save: every view it drew and did not hand to a
 * product goes, bytes included. A view a product already holds is referenced
 * by the brand document and survives the sweep by that fact alone.
 */
export function abandonDraft(deps: CandidateDeps, brandId: string, draftId: string): number {
  let removed = 0;
  for (const c of [...candidates.values()]) {
    if (c.brandId !== brandId || c.draftId !== draftId) continue;
    running.get(c.id)?.abort();
    discard(deps, c);
    candidates.delete(c.id);
    removed++;
  }
  return removed;
}

/** The draft was saved: its kept views are the product's now, so forget the candidates without touching a byte. */
export function consumeDraft(brandId: string, draftId: string): void {
  for (const c of [...candidates.values()]) {
    if (c.brandId === brandId && c.draftId === draftId && c.stage === 'kept') candidates.delete(c.id);
  }
}

function discard(deps: CandidateDeps, job: Live): void {
  for (const h of [...job.bornHere]) discardHash(deps, h);
  job.bornHere.clear();
}

/** The unlink, behind the last guard: the store is asked again whether anything references the hash now. */
function discardHash(deps: CandidateDeps, hash: string): void {
  if (deps.core.store.imageReferenced(hash)) return;
  try {
    deps.core.images.remove(hash);
  } catch {
    /* a hash that will not validate was never on disk */
  }
  deps.thumbs?.forget(hash);
}

function prune(brandId: string): void {
  const settled = [...candidates.values()]
    .filter((c) => c.brandId === brandId && (c.stage === 'rejected' || c.stage === 'failed' || c.stage === 'cancelled'))
    .sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
  for (const old of settled.slice(KEEP_SETTLED_PER_BRAND)) candidates.delete(old.id);
}

function patch(job: Live, next: Partial<ProductCandidate>): void {
  Object.assign(job, next);
}

/* ------------------------------------------------------------- the prompt */

const ANGLE_TEXT: Record<string, string> = {
  'three-quarter': 'a three-quarter view, turned about forty-five degrees so its front and one side both read',
  front: 'straight on, squared to the camera',
  side: 'its side, in full profile at ninety degrees',
  'lateral-side': 'its outer side, in full profile',
  'medial-side': 'its inner side, in full profile',
  top: 'directly above, looking straight down at its top and closure',
};

/**
 * Identity capture, not a shot. The same neutral set for every product, the
 * same anti-border discipline as a presenter's studio frames, and the object
 * described from its sheet. Nothing here is art direction: no set, no light
 * with a character, no props, and no mark that the photographs do not show.
 */
export function neutralCapturePrompt(angle: string, sheet: CandidateSheet | null, correction?: string | null): string {
  const subject = [
    sheet?.promptName?.trim() || 'the product in the photographs',
    sheet?.materials?.trim() ? `made of ${sheet.materials.trim()}` : '',
    sheet?.primaryColors?.trim() ? `in ${sheet.primaryColors.trim()}` : '',
  ]
    .filter(Boolean)
    .join(', ');
  const keep = sheet?.preservationNotes?.trim() ? ` ${sheet.preservationNotes.trim().replace(/\.?$/, '.')}` : '';
  const avoid = sheet?.negativeConstraints?.trim()
    ? ` Avoid: ${sheet.negativeConstraints.trim().replace(/\.?$/, '.')}`
    : '';
  const fix = correction?.trim()
    ? ` The last attempt was wrong in this way, and it must be right this time: ${correction.trim().replace(/\.?$/, '.')}`
    : '';
  return (
    'Full-bleed photograph filling the entire frame edge to edge with no border, frame, letterbox band or matte of any kind: ' +
    'a seamless white studio sweep runs past all four edges and is the only thing behind the object. ' +
    `The attached photographs show the exact object: ${subject}. ` +
    `Photograph that same object from ${ANGLE_TEXT[angle] ?? angle}, unchanged in every other respect: the same shape, ` +
    'proportions, colour, finish and materials, and every printed, embossed or stamped mark exactly where and how the photographs show it. ' +
    'Soft, even light from one large source with gentle fill, no hard shadow, no props, no hands, no person, no set dressing, ' +
    'no environment, and nothing else in frame. Do not add, remove, redraw or re-letter any text, logo, mark, seam, closure, ' +
    'hardware or ornament, and do not invent detail on a face the photographs do not show: where you cannot see it, keep it ' +
    `plain and consistent with the visible material.${keep}${avoid}${fix}`
  );
}
