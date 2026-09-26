import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { createCore, type Core, type EngineAdapter } from '@scenri/core';
import { headOf } from '../src/assetRecords.js';
import { resetAssetBuilds, type AssetBuildDeps } from '../src/customAssets.js';
import { CORE_VIEWS, type PresenterView } from '../src/presenterPrompts.js';
import {
  approveView,
  createPresenterDraft,
  discardPresenterDraft,
  generateView,
  getPresenterDraft,
  openPresenterEdit,
  presenterDraftRuns,
  redoView,
  resetPresenterDrafts,
  runningDraftJobCount,
  savePresenterDraft,
  settlePresenterDrafts,
  stopPresenterDraft,
  sweepPresenterDrafts,
  updatePresenterDraft,
} from '../src/presenterDrafts.js';
import { brandContext } from '../src/routes/shared.js';
import { listStudioWork } from '../src/studioWork.js';

/**
 * A presenter's draft as a job: a set where some views fail and the rest land,
 * what each draw is told, and a restart, a Stop or a drain that cuts one short.
 * The engine is the spy presenterDrafts.test.ts uses, and it throws the error
 * shapes the real engines throw on the calls a test names.
 */

/** Strings the engines really throw, copied from where they throw them. */
const CODEX_401 = 'codex exited with code 1: ERROR: unexpected status 401 Unauthorized';
const NETWORK = 'fetch failed';

let home: string;
let core: Core;
let brandId: string;
/** The view every draw was for, in order. */
let drawn: string[];
let prompts: string[];
/** The error the nth draw of a view throws, if any. */
let failFor: (view: string, nth: number) => string | null;
/** The next draw throws this, once. */
let failNext: Error | null;
/** The next draw waits here until released or aborted. */
let holdNext: { release?: () => void } | null;
/** The next draw waits here and answers even if it was aborted: a draw that does not hear Stop. */
let lateNext: { release?: () => void } | null;
/** Which read the draft gets: none, one that answers, or one that never answers until aborted. */
let reader: 'none' | 'reads' | 'slow';
let readFails: boolean;
/** What the read says their hair is: the face it is shown decides it. */
let readHair: string;
let analyzed: { imagePaths: string[]; classifyPhotos?: boolean }[];
let photoReads: number;

const png = (n: number) =>
  sharp({
    create: { width: 512, height: 640, channels: 3, background: { r: n % 256, g: (n * 7) % 256, b: (n * 13) % 256 } },
  })
    .png()
    .toBuffer();

/** The view a presenter prompt asks for, read off its own words (presenterPrompts.viewSubject). */
function viewOf(prompt: string): string {
  if (/head-and-shoulders portrait/.test(prompt)) return 'portrait';
  if (/forty-five degrees/.test(prompt)) return 'three-quarter';
  if (/directly away from the camera/.test(prompt)) return 'back';
  if (/their left side faces the camera/.test(prompt)) return 'left';
  if (/their right side faces the camera/.test(prompt)) return 'right';
  return 'front';
}

const engine = (): EngineAdapter => ({
  capabilities: () => ({
    id: 'spy',
    displayName: 'Spy',
    localOnly: false,
    supportsEdit: true,
    supportsMask: false,
    maxReferenceImages: 5,
  }),
  isAvailable: async () => ({ ok: true }),
  costEstimate: async () => 0,
  generate: async (req, signal) => {
    const view = viewOf(req.prompt);
    drawn.push(view);
    prompts.push(req.prompt);
    const n = drawn.length;
    const err = failFor(view, drawn.filter((v) => v === view).length);
    if (err) throw new Error(err);
    if (holdNext) {
      const h = holdNext;
      holdNext = null;
      await new Promise<void>((resolve, reject) => {
        h.release = resolve;
        signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      });
    }
    if (lateNext) {
      const h = lateNext;
      lateNext = null;
      await new Promise<void>((resolve) => {
        h.release = resolve;
      });
    }
    if (failNext) {
      const e = failNext;
      failNext = null;
      throw e;
    }
    return { images: [core.images.save(await png(n))], costUsd: 0 };
  },
  edit: async () => ({ images: [], costUsd: 0 }),
});

const answeringReader = {
  isAvailable: async () => ({ ok: true }),
  analyze: async (req: any) => {
    analyzed.push(req);
    if (readFails) throw new Error('codex: the read did not follow the contract twice');
    return {
      promptName: `a woman in her forties with ${readHair}`,
      presentation: 'woman' as const,
      descriptor: 'Editorial',
      ageRange: 'mid 40s',
      hair: readHair,
      identityNotes: `the ${readHair} must survive every generation`,
      negativeConstraints: [],
      suitableCategories: [],
      coverage: [],
      ...(req.classifyPhotos
        ? {
            photos: req.imagePaths.map((_: string, i: number) => ({
              index: i,
              view: i === 0 ? 'portrait' : 'other',
              usable: true,
              note: 'sharp',
            })),
          }
        : {}),
    };
  },
};

/** A read that never answers until it is aborted, as a Codex read taking its time. */
const slowReader = {
  isAvailable: async () => ({ ok: true }),
  analyze: (req: any, signal?: AbortSignal) => {
    if (req.classifyPhotos) photoReads += 1;
    return new Promise((_resolve, reject) => {
      signal?.addEventListener('abort', () => reject(new Error('Codex CLI run aborted')), { once: true });
    });
  },
};

const deps = (): AssetBuildDeps => ({
  core,
  engine: engine(),
  analyzer: reader === 'reads' ? (answeringReader as any) : reader === 'slow' ? (slowReader as any) : null,
  brandContext: (id: string) => brandContext(core, id),
  vocabulary: { collections: [], verticals: [], categories: ['Beauty'] },
});

const idle = async () => {
  for (let i = 0; i < 400 && runningDraftJobCount() > 0; i++) await new Promise((r) => setTimeout(r, 10));
};

async function step(id: string, view: PresenterView, opts: { adjustment?: string; decide?: 'auto' } = {}) {
  await generateView(deps(), id, view, opts);
  await idle();
  return getPresenterDraft(core, id)!;
}

/** Each view drawn and approved by hand, in order. */
async function build(id: string, views: readonly PresenterView[]) {
  for (const v of views) {
    await step(id, v);
    await approveView(deps(), id, v);
    await idle();
  }
  return getPresenterDraft(core, id)!;
}

const synthetic = (direction = 'confident woman in her 40s') =>
  createPresenterDraft(deps(), { brandId, source: 'synthetic', direction });

/** Face and full body decided by hand, the extras asked for: the three-quarter then carries the set on its own. */
async function extrasAhead() {
  const d = await synthetic('a woman in her 30s');
  await updatePresenterDraft(core, d.id, { extras: true });
  await build(d.id, ['portrait', 'front']);
  return d.id;
}

/** What generateView writes before its job starts, and all a kill -9 leaves behind. */
const diesDrawing = (id: string, v: PresenterView) => {
  const row = core.store.getPresenterDraft(id)!.json as any;
  row.views[v].status = 'generating';
  row.views[v].error = undefined;
  row.views[v].startedAt = new Date().toISOString();
  row.activeView = v;
  row.stage = 'drawing';
  core.store.putPresenterDraft({ id, brandId, json: row });
};

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'sc-pdjobs-'));
  core = createCore(home);
  drawn = [];
  prompts = [];
  failFor = () => null;
  failNext = null;
  holdNext = null;
  lateNext = null;
  reader = 'none';
  readFails = false;
  readHair = 'short silver crop';
  analyzed = [];
  photoReads = 0;
  brandId = core.store.createBrand({ specVersion: '0.1', meta: { name: 'Acme' } } as any).id;
});
afterEach(async () => {
  holdNext?.release?.();
  lateNext?.release?.();
  resetPresenterDrafts();
  await idle();
  resetAssetBuilds();
  core.close();
  rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

describe('a set that only partly lands', () => {
  it('is reported as failed, not done, when one extra view failed and the others landed (FAIL-X1)', async () => {
    const id = await extrasAhead();
    failFor = (view) => (view === 'back' ? NETWORK : null);
    const after = await step(id, 'three-quarter', { decide: 'auto' });

    // the work itself is right: the failed view destroyed nothing, and what landed stands
    expect(after.views.back).toMatchObject({ status: 'empty', error: NETWORK });
    for (const v of ['portrait', 'front', 'three-quarter', 'left', 'right'] as const)
      expect(after.views[v].status).toBe('approved');

    // what Activity, and the toast a person who left is given, says about it
    const run = presenterDraftRuns(brandId).find((r) => r.draftId === id)!;
    const row = listStudioWork(core, brandId).find((w) => w.draftId === id)!;
    expect({ run: run.status, row: row.status, error: row.error }).toEqual({
      run: 'failed',
      row: 'failed',
      error: NETWORK,
    });
  });

  it('reads the same whichever view failed (FAIL-X1)', async () => {
    const last = await extrasAhead();
    failFor = (view) => (view === 'right' ? NETWORK : null);
    await step(last, 'three-quarter', { decide: 'auto' });
    const lastFailed = presenterDraftRuns(brandId).find((r) => r.draftId === last)!.status;

    const first = await extrasAhead();
    failFor = (view) => (view === 'back' ? NETWORK : null);
    await step(first, 'three-quarter', { decide: 'auto' });
    const firstFailed = presenterDraftRuns(brandId).find((r) => r.draftId === first)!.status;

    expect(lastFailed).toBe('failed');
    expect(firstFailed).toBe(lastFailed);
  });

  it('finishes with one Retry once the engine is back, not only the view the Retry names (FAIL-X2)', async () => {
    const id = await extrasAhead();
    // signed out mid-set: every extra fails the same way
    failFor = (view) => (['back', 'left', 'right'].includes(view) ? CODEX_401 : null);
    const failed = await step(id, 'three-quarter', { decide: 'auto' });
    for (const v of ['back', 'left', 'right'] as const) expect(failed.views[v].error).toBe(CODEX_401);

    // signed back in; the conversation offers one Retry, for the first failed view
    failFor = () => null;
    const retried = await step(id, 'back', { decide: 'auto' });
    for (const v of ['back', 'left', 'right'] as const) expect(retried.views[v].status).toBe('approved');
  });

  it('draws a view whose redraw once failed again with the set when it goes stale (PS-H19)', async () => {
    const d = await synthetic();
    await updatePresenterDraft(core, d.id, { extras: true });
    await build(d.id, ['portrait', 'front']);
    let r = await step(d.id, 'three-quarter', { decide: 'auto' });
    expect(['three-quarter', 'back', 'left', 'right'].map((v) => r.views[v as PresenterView].status)).toEqual([
      'approved',
      'approved',
      'approved',
      'approved',
    ]);
    // a redraw of the back view fails: it keeps its picture, and the reason
    failNext = new Error('quota hiccup');
    r = await step(d.id, 'back', { decide: 'auto' });
    expect(r.views.back).toMatchObject({ status: 'approved', error: 'quota hiccup' });
    // the full body is redrawn and used: everything built on it is out of date
    await step(d.id, 'front');
    await approveView(deps(), d.id, 'front');
    // the studio asks for the first stale view; the set goes on by itself from there
    r = await step(d.id, 'three-quarter', { decide: 'auto' });
    expect(r.views.left.status).toBe('approved');
    expect(r.views.right.status).toBe('approved');
    expect(r.views.back.status).toBe('approved');
  });
});

describe('what a draw is told', () => {
  it('a new face stales the full body drawn from the old one, however long the results log (PS-H5)', async () => {
    const d = await synthetic('a man in his thirties');
    const cast = await build(d.id, ['portrait', 'front', 'three-quarter']);
    const oldFace = cast.views.portrait.hash as string;
    expect(cast.views.front.conditionedOn).toContain(oldFace);
    // sixty-one more three-quarter draws roll the old face out of the capped log
    for (let i = 0; i < 61; i++) await step(d.id, 'three-quarter');
    expect(getPresenterDraft(core, d.id)!.results.some((r) => r.hash === oldFace)).toBe(false);

    await redoView(deps(), d.id, 'portrait');
    await step(d.id, 'portrait');
    const after = await approveView(deps(), d.id, 'portrait');
    expect(after.views.portrait.hash).not.toBe(oldFace);
    expect(after.views.front.status).toBe('stale');
  });

  it('a face changed after the set was built is not described by the read of the old face (PS2-X1)', async () => {
    reader = 'reads';
    const d = await synthetic();
    await build(d.id, ['portrait']);
    // the read of the approved face is taken on the way to the full body
    await step(d.id, 'front');
    expect(prompts.at(-1)).toContain('short silver crop');
    await approveView(deps(), d.id, 'front');
    // the face is changed and used, so the full body is drawn again from the new one
    readHair = 'long copper waves';
    await step(d.id, 'portrait', { adjustment: 'give her long copper waves' });
    await approveView(deps(), d.id, 'portrait');
    expect(getPresenterDraft(core, d.id)!.views.front.status).toBe('stale');
    await step(d.id, 'front');
    expect(prompts.at(-1)).not.toContain('short silver crop');
  });

  it('a read of the approved face that fails does not stop the full body from being drawn (PS-H12)', async () => {
    reader = 'reads';
    readFails = true;
    const d = await synthetic();
    await build(d.id, ['portrait']);
    const r = await step(d.id, 'front');
    expect(r.views.front.error).toBeUndefined();
    expect(r.views.front.status).toBe('candidate');
  });

  it('a draft keeps no more source photos than a saved presenter can, and the read is sent no more (PS-H11, SEC-H7)', async () => {
    reader = 'reads';
    const hashes: string[] = [];
    for (let i = 0; i < 12; i++) hashes.push(core.images.save(await png(200 + i)));
    const d = await createPresenterDraft(deps(), { brandId, source: 'photos', imageHashes: hashes, attestation: true });
    await idle();
    // presenterRecordFrom keeps at most 8 at save; the studio itself offers 4
    expect(getPresenterDraft(core, d.id)!.sources.length).toBeLessThanOrEqual(8);
    expect(analyzed[0].imagePaths.length).toBeLessThanOrEqual(8);
  });
});

describe('a restart, a Stop or a drain in the middle', () => {
  it('an approved view that died mid-revision comes back approved, as a failed draw would leave it (PS-H7)', async () => {
    const d = await synthetic('a man in his thirties');
    const cast = await build(d.id, ['portrait', 'front', 'three-quarter']);
    diesDrawing(d.id, 'front');
    expect(sweepPresenterDrafts(core)).toBe(1);
    const after = getPresenterDraft(core, d.id)!;
    expect(after.views.front.hash).toBe(cast.views.front.hash);
    expect(after.views.front.status).toBe('approved');
    expect(after.views['three-quarter'].status).toBe('approved');
  });

  it('a redo that died mid-draw wears its prior picture again (PS-H7)', async () => {
    const d = await synthetic('a man in his thirties');
    const cast = await build(d.id, ['portrait', 'front', 'three-quarter']);
    await redoView(deps(), d.id, 'front');
    diesDrawing(d.id, 'front');
    sweepPresenterDrafts(core);
    const after = getPresenterDraft(core, d.id)!;
    expect(after.views.front.hash).toBe(cast.views.front.hash);
    expect(after.views.front.status).toBe('approved');
  });

  it('a stale view cut short by a restart stays stale and cannot be approved (PC2-X2)', async () => {
    const d = await synthetic('a woman in her 40s');
    await build(d.id, ['portrait', 'front']);
    const oldFace = getPresenterDraft(core, d.id)!.views.portrait.hash;

    // the face changes: the full body drawn from the old one no longer stands
    await step(d.id, 'portrait', { adjustment: 'with a short beard' });
    const locked = await approveView(deps(), d.id, 'portrait');
    expect(locked.views.portrait.hash).not.toBe(oldFace);
    expect(locked.views.front.status).toBe('stale');
    const stalePicture = locked.views.front.hash;

    // its redraw starts, and the server goes away before it lands
    holdNext = {};
    await generateView(deps(), d.id, 'front', {});
    expect(getPresenterDraft(core, d.id)!.views.front.status).toBe('generating');
    sweepPresenterDrafts(core);

    const after = getPresenterDraft(core, d.id)!;
    expect(after.views.front.hash).toBe(stalePicture);
    expect(after.views.front.error).toMatch(/restart/);
    expect(after.views.front.status).toBe('stale');
    await expect(approveView(deps(), d.id, 'front')).rejects.toThrow(/redo the/);
  });

  /** A photos draft whose read is under way. */
  const reading = async () => {
    reader = 'slow';
    const a = core.images.save(await png(150));
    const b = core.images.save(await png(160));
    const d = await createPresenterDraft(deps(), { brandId, source: 'photos', imageHashes: [a, b], attestation: true });
    for (let i = 0; i < 200 && getPresenterDraft(core, d.id)!.stage !== 'analyzing'; i++)
      await new Promise((r) => setTimeout(r, 5));
    expect(getPresenterDraft(core, d.id)!.stage).toBe('analyzing');
    return d.id;
  };

  it('Stop during the photo read leaves a reason on the row, or reads again (PS-H6)', async () => {
    const id = await reading();
    const stopped = await stopPresenterDraft(deps(), id);
    expect(runningDraftJobCount()).toBe(0);
    expect(stopped.stage).toBe('idle');
    const told = Boolean(stopped.readError) || Boolean(stopped.analysis?.photos) || photoReads > 1;
    expect(told, `readError=${stopped.readError} reads=${photoReads}`).toBe(true);
  });

  it('a restart during the photo read leaves a reason on the row (PS-H6)', async () => {
    const id = await reading();
    // the process dies here: the row still says analyzing, and nothing is running
    resetPresenterDrafts();
    const row = core.store.getPresenterDraft(id)!.json as any;
    row.stage = 'analyzing';
    core.store.putPresenterDraft({ id, brandId, json: row });
    expect(sweepPresenterDrafts(core)).toBe(1);
    const swept = getPresenterDraft(core, id)!;
    expect(swept.stage).toBe('idle');
    expect(swept.readError).toBeTruthy();
  });

  it('refuses a new draw once the server is draining, instead of starting it past the abort (PS-H13)', async () => {
    const a = await synthetic();
    const b = await synthetic();
    const held: { release?: () => void } = {};
    holdNext = held;
    await generateView(deps(), a.id, 'portrait');
    // the first draw is really with the engine before the drain begins
    for (let i = 0; i < 200 && !held.release; i++) await new Promise((r) => setTimeout(r, 5));
    const settling = settlePresenterDrafts();
    let refused = false;
    try {
      await generateView(deps(), b.id, 'portrait');
    } catch {
      refused = true;
    }
    await settling;
    expect(refused).toBe(true);
  });

  it('counts a discarded draft as busy until its draw has actually let go (PS-H14)', async () => {
    const d = await synthetic();
    const held: { release?: () => void } = {};
    lateNext = held;
    await generateView(deps(), d.id, 'portrait');
    for (let i = 0; i < 200 && !held.release; i++) await new Promise((r) => setTimeout(r, 5));
    await discardPresenterDraft(deps(), d.id);
    // the engine has not answered yet: the update gate must still see work in flight
    const busyWhileHeld = runningDraftJobCount();
    held.release?.();
    await idle();
    expect(busyWhileHeld).toBe(1);
    expect(runningDraftJobCount()).toBe(0);
  });

  it('an edit save that dies after writing the record never leaves a session that can only 409 (PS-H16)', async () => {
    const d = await synthetic();
    await build(d.id, CORE_VIEWS);
    await updatePresenterDraft(core, d.id, { name: 'Ilse' });
    const { presenter } = await savePresenterDraft(deps(), d.id);
    const e = openPresenterEdit(core, brandId, presenter.id);
    // a words change to the identity mints a revision
    await updatePresenterDraft(core, e.id, { direction: 'a woman in her fifties with a long grey braid' });
    const store = core.store as any;
    const real = store.deletePresenterDraft;
    let trip = true;
    store.deletePresenterDraft = function (this: unknown, id: string) {
      if (trip) {
        trip = false;
        throw new Error('SQLITE_IOERR: disk I/O error');
      }
      return real.call(this, id);
    };
    // the fault lands between the record write and the session drop
    await savePresenterDraft(deps(), e.id).catch(() => {});
    store.deletePresenterDraft = real;
    const recordMoved = headOf(core.store.getBrand(brandId)!.json, presenter.id) !== presenter.id;
    const sessionLeft = !!getPresenterDraft(core, e.id);
    // all or nothing: a moved record with its session still open is the dead end
    expect({ recordMoved, sessionLeft }).not.toEqual({ recordMoved: true, sessionLeft: true });
    if (sessionLeft) await expect(savePresenterDraft(deps(), e.id)).resolves.toBeTruthy();
  });
});
