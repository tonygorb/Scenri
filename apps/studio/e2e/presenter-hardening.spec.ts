import zlib from 'node:zlib';
import { type APIRequestContext, expect, type Page, test } from '@playwright/test';
import { isolate } from './harness.js';
import { currentBrand, goNav, holdNext } from './realtime.js';

/**
 * The presenter studio and editor where the behaviour lives in the browser:
 * what Enter answers and where focus sits, Back and in-app navigation while a
 * request is still on its way, pasted and uploaded pictures, and the steps the
 * creation flow takes on its own. The rules behind them are unit tested; these
 * hold the wiring. Every test makes its own drafts and presenters.
 */
isolate({ env: { SCENRI_DEMO_BUILDS: '1', SCENRI_DEMO_REFS: '5', SCENRI_DEMO_DELAY_MS: '400' } });

const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
const SENTENCE = 'Late 30s woman, Mediterranean appearance, dark shoulder-length hair, slim build, elegant.';

const log = (p: Page) => p.getByRole('log');
const composer = (p: Page) => p.locator('.sc-convo-card textarea');
const send = async (p: Page, text: string) => {
  await composer(p).fill(text);
  await composer(p).press('Enter');
};
const answer = (p: Page, label: string) => log(p).getByRole('button', { name: label, exact: true });
const turn = (p: Page, key: string) => log(p).locator(`.sc-convo-turn[data-turn="${key}"]`);
const pencil = (p: Page, key: string) => turn(p, key).getByRole('button', { name: 'Change this answer' });
const here = (p: Page): string => /\/(pd-[a-z0-9]+)/.exec(new URL(p.url()).pathname)?.[1] ?? '';
const draftOf = async (req: APIRequestContext, brandId: string, id: string) =>
  (await req.get(`/api/brands/${brandId}/presenter-drafts/${id}`)).json();

async function settledView(req: APIRequestContext, brandId: string, draftId: string, view: string, want: string) {
  for (let i = 0; i < 200; i++) {
    const d = await draftOf(req, brandId, draftId);
    if (d.views[view].status === want && !d.activeView) return d;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`${view} never became ${want}`);
}

/** The rows of "Describe someone", tapped through to "Anything else that is always true of them?". */
async function tapThrough(p: Page) {
  await answer(p, 'Describe someone').click();
  for (const label of ['Woman', '30s', 'Mediterranean', 'Olive', 'Brown', 'Long', 'Green', 'Lean', 'Average'])
    await answer(p, label).click();
  await expect(log(p)).toContainText('Anything else that is always true of them?');
}

/** Every presenter-draft request the page sends, as "METHOD path". */
function draftCalls(p: Page): string[] {
  const seen: string[] = [];
  p.on('request', (r) => {
    const path = new URL(r.url()).pathname;
    if (path.includes('/presenter-drafts')) seen.push(`${r.method()} ${path}`);
  });
  return seen;
}

/** Every POST the page makes whose path matches, counted from now. */
function posts(p: Page, path: RegExp): () => number {
  let n = 0;
  p.on('request', (r) => {
    if (r.method() === 'POST' && path.test(new URL(r.url()).pathname)) n += 1;
  });
  return () => n;
}

/** A 4 by 5 PNG of one colour, so pictures of different colours are different hashes. */
function png(r: number, g: number, b: number): Buffer {
  const w = 4;
  const h = 5;
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: w }, () => [r, g, b]).flat())]);
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Paste batches of pictures onto the studio, back to back, the way two quick Cmd+V do. */
async function paste(p: Page, batches: Buffer[][]): Promise<void> {
  await p.evaluate(
    (all) => {
      const root = document.querySelector('.sc-pstudio') as HTMLElement;
      all.forEach((batch, i) => {
        const dt = new DataTransfer();
        batch.forEach((b64, j) => {
          const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
          dt.items.add(new File([bin], `paste-${i}-${j}.png`, { type: 'image/png' }));
        });
        root.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
      });
    },
    batches.map((b) => b.map((buf) => buf.toString('base64'))),
  );
}

/** A draft with the three core views approved, made through the API the way the studio makes one. */
async function coreDraft(req: APIRequestContext, brandId: string, name: string): Promise<string> {
  const base = `/api/brands/${brandId}/presenter-drafts`;
  const draft = await (
    await req.post(base, { data: { source: 'synthetic', direction: 'a man in his 30s', name } })
  ).json();
  for (const view of ['portrait', 'front']) {
    await req.post(`${base}/${draft.id}/views/${view}/generate`, { data: {} });
    await settledView(req, brandId, draft.id, view, 'candidate');
    await req.post(`${base}/${draft.id}/views/${view}/approve`);
  }
  await req.post(`${base}/${draft.id}/views/three-quarter/generate`, { data: { decide: 'auto' } });
  await settledView(req, brandId, draft.id, 'three-quarter', 'approved');
  return draft.id as string;
}

/** A saved three-view presenter. */
async function seedPresenter(req: APIRequestContext, brandId: string, name: string): Promise<string> {
  const draftId = await coreDraft(req, brandId, name);
  return (await (await req.post(`/api/brands/${brandId}/presenter-drafts/${draftId}/save`)).json()).presenter
    .id as string;
}

test.describe('the creation flow on its own', () => {
  test('a sentence after Start over, before any draft, still starts the draft (PC-H1)', async ({ page }) => {
    test.setTimeout(40_000);
    const brand = await currentBrand(page);
    await page.goto(`/${brand.slug}/presenters/new`);
    await answer(page, 'Describe someone').click();
    await expect(log(page)).toContainText('Who are they?');
    // no draft yet: the head's Start over is a plain button, no dialog
    await page.getByRole('button', { name: 'Start over', exact: true }).click();
    await expect(answer(page, 'Describe someone')).toBeVisible();
    await send(page, SENTENCE);
    await answer(page, 'Nothing else').click();
    await expect(page).toHaveURL(/\/presenters\/new\/pd-/, { timeout: 20_000 });
  });

  test('tapped rows after Start over, before any draft, draw the face (PC-H1)', async ({ page }) => {
    test.setTimeout(60_000);
    const brand = await currentBrand(page);
    await page.goto(`/${brand.slug}/presenters/new`);
    await answer(page, 'Describe someone').click();
    await expect(log(page)).toContainText('Who are they?');
    await page.getByRole('button', { name: 'Start over', exact: true }).click();
    await tapThrough(page);
    await answer(page, 'Nothing else').click();
    await answer(page, 'Draw the presenter').click();
    await expect(page).toHaveURL(/\/presenters\/new\/pd-/, { timeout: 20_000 });
    await expect(answer(page, 'Use this person')).toBeVisible({ timeout: 20_000 });
  });

  /**
   * A kept guard: a sync whose patch fails is sent again before the face is
   * drawn again, so the face is never redrawn over words the draft does not hold.
   */
  test('sends a failed sync again before the face is redrawn (PC-H6)', async ({ page }) => {
    test.setTimeout(90_000);
    const brand = await currentBrand(page);
    await page.goto(`/${brand.slug}/presenters/new`);
    await tapThrough(page);
    await answer(page, 'Nothing else').click();
    await answer(page, 'Draw the presenter').click();
    await expect(answer(page, 'Use this person')).toBeVisible({ timeout: 30_000 });
    const id = here(page);
    // in order: each direction patch with its status, and each draw of the face
    const events: string[] = [];
    page.on('response', (r) => {
      const req = r.request();
      const path = new URL(r.url()).pathname;
      if (req.method() === 'PATCH' && path.endsWith(id) && (req.postData() ?? '').includes('"direction"'))
        events.push(`patch ${r.status()} ${(req.postData() ?? '').includes('blonde') ? 'blonde' : 'other'}`);
      if (req.method() === 'POST' && path.endsWith('/views/portrait/generate')) events.push('draw');
    });
    let failed = false;
    await page.route(`**/presenter-drafts/${id}`, async (route) => {
      const req = route.request();
      if (!failed && req.method() === 'PATCH' && (req.postData() ?? '').includes('"direction"')) {
        failed = true;
        await route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"database is locked"}' });
        return;
      }
      await route.fallback();
    });
    await pencil(page, 'you:look-hair').click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Change it' }).click();
    await turn(page, 'q:look-hair').getByRole('button', { name: 'Blonde', exact: true }).click();
    for (const label of ['Short', 'Green', 'Solid', 'Average']) await answer(page, label).click();
    await answer(page, 'Nothing else').click();
    await expect.poll(() => events.includes('draw'), { timeout: 20_000 }).toBe(true);
    await settledView(page.request, brand.id, id, 'portrait', 'candidate');
    // the face that was drawn again was drawn after the new words landed
    expect(events.indexOf('patch 200 blonde'), events.join(', ')).toBeGreaterThan(-1);
    expect(events.indexOf('patch 200 blonde'), events.join(', ')).toBeLessThan(events.lastIndexOf('draw'));
    expect((await draftOf(page.request, brand.id, id)).direction).toContain('blonde');
  });

  test('Retry after an unrelated failure does not send a stepped-over sync again (PC-H7)', async ({ page }) => {
    test.setTimeout(90_000);
    const brand = await currentBrand(page);
    const calls = draftCalls(page);
    await page.goto(`/${brand.slug}/presenters/new`);
    await tapThrough(page);
    // a last detail whose 200-character cut lands on a space: the client keeps the space, the server trims it
    const keep = `${'a small silver hoop in the left ear '.repeat(6).slice(0, 199)} and more words after the cut here`;
    expect(keep[199]).toBe(' ');
    await send(page, keep);
    await expect(log(page)).toContainText('Here is the presenter, in full. Ready to draw?');
    await answer(page, 'Draw the presenter').click();
    await expect(page).toHaveURL(/\/presenters\/new\/pd-/, { timeout: 20_000 });
    const id = here(page);
    await settledView(page.request, brand.id, id, 'portrait', 'candidate');
    // the full body's first draw fails once, so a Retry is offered after the face is used
    let blocked = false;
    await page.route(`**/presenter-drafts/${id}/views/front/generate`, async (route) => {
      if (!blocked && route.request().method() === 'POST') {
        blocked = true;
        await route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"the engine fell over"}' });
        return;
      }
      await route.fallback();
    });
    await answer(page, 'Use this person').or(answer(page, 'Use this')).click();
    await settledView(page.request, brand.id, id, 'portrait', 'approved');
    await expect(answer(page, 'Retry')).toBeVisible({ timeout: 20_000 });
    const mark = calls.length;
    await answer(page, 'Retry').click();
    await expect(log(page)).toContainText('Here is the full body', { timeout: 30_000 });
    const after = calls.slice(mark);
    // the approved face is not taken back and drawn again
    expect(
      after.filter((c) => c.endsWith('/views/portrait/redo')),
      after.join('\n'),
    ).toHaveLength(0);
  });
});

test.describe('navigation while a request is on its way', () => {
  test('Back while the draft is being created does not pull the studio back open (PC-H3)', async ({ page }) => {
    const brand = await currentBrand(page);
    await page.goto(`/${brand.slug}/presenters`);
    // the bar's New opens the studio whether or not the wall is empty
    await page.locator('.sc-new-go').click();
    await expect(page).toHaveURL(/\/presenters\/new$/);
    await expect(answer(page, 'Describe someone')).toBeVisible();
    await send(page, SENTENCE);
    const held = await holdNext(page, /\/presenter-drafts$/, 'POST');
    await answer(page, 'Nothing else').click();
    await held.caught;
    // the person leaves before the draft answers
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`/${brand.slug}/presenters$`));
    await expect(page.locator('.sc-pstudio')).toHaveCount(0);
    held.release();
    // the late answer must not reopen the studio the person just left
    await page.waitForTimeout(2500);
    await expect(page).toHaveURL(new RegExp(`/${brand.slug}/presenters$`));
    await expect(page.locator('.sc-pstudio')).toHaveCount(0);
  });

  test('Open on another draft from a toast does not carry this conversation onto it (PC-H2)', async ({ page }) => {
    test.setTimeout(90_000);
    const brand = await currentBrand(page);
    const base = `/api/brands/${brand.id}/presenter-drafts`;
    await page.goto(`/${brand.slug}/presenters/new`);
    // conversation A: the rows, tapped to the read-back, nothing drawn yet
    await tapThrough(page);
    await answer(page, 'Nothing else').click();
    await expect(log(page)).toContainText('Here is the presenter, in full. Ready to draw?');

    // draft B finishes its face in the background
    const b = await (
      await page.request.post(base, { data: { source: 'synthetic', direction: 'a man in his 30s', name: 'Bram' } })
    ).json();
    await page.request.post(`${base}/${b.id}/views/portrait/generate`, { data: {} });
    const toast = page.locator('.sc-toast', { hasText: 'Bram' });
    await expect(toast).toBeVisible({ timeout: 45_000 });
    expect((await draftOf(page.request, brand.id, b.id)).views.portrait.status).toBe('candidate');

    const toB: string[] = [];
    page.on('request', (r) => {
      const path = new URL(r.url()).pathname;
      if (path.includes(`/presenter-drafts/${b.id}`) && r.method() !== 'GET')
        toB.push(`${r.method()} ${path.split(b.id)[1] || '/'} ${r.postData() ?? ''}`.slice(0, 160));
    });
    await toast.getByRole('button', { name: 'Open' }).click();
    await expect(page).toHaveURL(new RegExp(`/presenters/new/${b.id}$`));
    await page.waitForTimeout(4000);

    const after = await draftOf(page.request, brand.id, b.id);
    // B is still the person B was: its words, its face, nothing redrawn
    expect(after.direction, toB.join('\n')).toBe('a man in his 30s');
    expect(after.generations, toB.join('\n')).toBe(1);
    expect(
      toB.filter((c) => /redo|generate|Mediterranean/.test(c)),
      toB.join('\n'),
    ).toHaveLength(0);
  });

  test('closing the editor untouched leaves "Edit presenter", not "Continue editing" (PC-H11)', async ({ page }) => {
    test.setTimeout(60_000);
    const brand = await currentBrand(page);
    const id = await seedPresenter(page.request, brand.id, 'Maren');
    await page.goto(`/${brand.slug}/presenters/${id}`);
    await page.getByRole('link', { name: 'Edit presenter' }).click();
    await expect(page).toHaveURL(new RegExp(`/presenters/${id}/edit$`));
    await expect(page.locator('.sc-pstudio-slot')).toHaveCount(3, { timeout: 20_000 });
    const reread = page.waitForResponse((r) => /\/presenter-drafts$/.test(new URL(r.url()).pathname));
    await page.keyboard.press('Escape');
    await expect(page).toHaveURL(new RegExp(`/presenters/${id}$`));
    await reread;
    await expect(page.getByRole('link', { name: 'Continue editing' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Edit presenter' })).toBeVisible();
  });

  test('a save that lands after the editor was closed does not pull the person back (PC-H11)', async ({ page }) => {
    test.setTimeout(90_000);
    const brand = await currentBrand(page);
    const id = await seedPresenter(page.request, brand.id, 'Noa');
    await page.goto(`/${brand.slug}/presenters/${id}/edit`);
    await page.locator('.sc-pstudio-slot[data-view="front"]').click();
    await send(page, 'turn slightly more to camera');
    await expect(log(page)).toContainText('Redrew the full body.', { timeout: 20_000 });
    await answer(page, 'Use it').click();
    await expect(log(page)).toContainText('Save changes when you are done.', { timeout: 20_000 });

    const held = await holdNext(page, /\/presenter-drafts\/[^/]+\/save$/, 'POST');
    await answer(page, 'Save changes').click();
    await held.caught;
    await page.keyboard.press('Escape');
    await expect(page).toHaveURL(new RegExp(`/presenters/${id}$`));
    await goNav(page, 'Products');
    held.release();
    await page.waitForTimeout(1500);
    await expect(page).toHaveURL(/\/products$/);
  });

  test('moving from one editor to another inside the app opens the second one (PC-H12)', async ({ page }) => {
    test.setTimeout(90_000);
    const brand = await currentBrand(page);
    const one = await seedPresenter(page.request, brand.id, 'Lior');
    const two = await seedPresenter(page.request, brand.id, 'Dana');
    await page.goto(`/${brand.slug}/presenters/${one}/edit`);
    await expect(page.locator('.sc-pstudio-slot')).toHaveCount(3, { timeout: 20_000 });
    // what a task toast's Open does: an in-app navigation, the same mount
    const opened = page.waitForRequest(
      (r) => r.method() === 'POST' && new URL(r.url()).pathname.endsWith(`/presenters/${two}/edit`),
      { timeout: 5000 },
    );
    await page.evaluate((to) => {
      history.pushState(null, '', to);
      window.dispatchEvent(new PopStateEvent('popstate', { state: null }));
    }, `/${brand.slug}/presenters/${two}/edit`);
    await opened;
    await page.waitForTimeout(1000);
    await expect(page).toHaveURL(new RegExp(`/presenters/${two}/edit$`));
  });
});

test.describe('what Enter answers', () => {
  test('Enter with focus on the words at "Add back and profile views?" orders nothing (PC-H9)', async ({ page }) => {
    test.setTimeout(60_000);
    const brand = await currentBrand(page);
    const draftId = await coreDraft(page.request, brand.id, 'Ari');
    await page.goto(`/${brand.slug}/presenters/new/${draftId}`);
    await expect(answer(page, 'Add them')).toBeVisible({ timeout: 20_000 });
    await log(page).getByText('Add back and profile views?').click();
    await page.keyboard.press('Enter');
    await page.waitForTimeout(1500);
    const d = await draftOf(page.request, brand.id, draftId);
    expect(d.extras ?? false).toBe(false);
    expect(d.views.back.status).toBe('empty');
  });

  test('Enter inside the Start over dialog does not answer the question under it (PC2-X3)', async ({ page }) => {
    test.setTimeout(60_000);
    const brand = await currentBrand(page);
    const base = `/api/brands/${brand.id}/presenter-drafts`;
    const draft = await (
      await page.request.post(base, { data: { source: 'synthetic', direction: 'a man in his 30s', name: 'Omer' } })
    ).json();
    await page.request.post(`${base}/${draft.id}/views/portrait/generate`, { data: {} });
    await settledView(page.request, brand.id, draft.id, 'portrait', 'candidate');
    await page.goto(`/${brand.slug}/presenters/new/${draft.id}`);
    await expect(answer(page, 'Use this person')).toBeVisible({ timeout: 20_000 });

    await page.getByRole('button', { name: 'Start over', exact: true }).click();
    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toBeVisible();
    // a click on the dialog's own words, then Enter: meant for the dialog
    await dialog.getByText('This conversation begins again from the first question.').click();
    await page.keyboard.press('Enter');
    await page.waitForTimeout(1500);
    expect((await draftOf(page.request, brand.id, draft.id)).views.portrait.status).toBe('candidate');
  });
});

test.describe('pictures on their way in', () => {
  test('a photo pasted at a describe-someone question is never uploaded (PC-H10)', async ({ page }) => {
    const brand = await currentBrand(page);
    await page.goto(`/${brand.slug}/presenters/new`);
    await answer(page, 'Describe someone').click();
    await expect(log(page)).toContainText('Who are they?');
    const uploads = posts(page, /^\/api\/images$/);
    await paste(page, [[png(10, 200, 30)]]);
    await page.waitForTimeout(1500);
    expect(uploads()).toBe(0);
  });

  test('two quick paste batches past four photos keep four and say what was not added (PC-H10)', async ({ page }) => {
    const brand = await currentBrand(page);
    await page.goto(`/${brand.slug}/presenters/new`);
    await answer(page, 'Add photos').click();
    await expect(page.locator('input[type="file"]')).toBeAttached();
    const uploads = posts(page, /^\/api\/images$/);
    await paste(page, [
      [png(11, 90, 120), png(22, 90, 120), png(33, 90, 120)],
      [png(44, 90, 120), png(55, 90, 120), png(66, 90, 120)],
    ]);
    await expect(page.locator('.sc-assetform-ref')).toHaveCount(4, { timeout: 15_000 });
    await expect.poll(uploads).toBeGreaterThanOrEqual(4);
    await expect(page.locator('[role="alert"]')).toContainText(/not added/);
  });

  test('a detail picture taken off while it uploads does not come back (PC-H4)', async ({ page }) => {
    const brand = await currentBrand(page);
    await page.goto(`/${brand.slug}/presenters/new`);
    await tapThrough(page);
    await answer(page, 'Glasses').click();
    await answer(page, 'Continue').click();
    await expect(log(page)).toContainText('What glasses do they wear?');
    const held = await holdNext(page, /\/api\/images$/, 'POST');
    await page.getByRole('button', { name: 'Add the picture of the glasses' }).click();
    await page
      .locator('.sc-convo-card input[type="file"]')
      .setInputFiles({ name: 'thin-black.png', mimeType: 'image/png', buffer: PIXEL });
    await held.caught;
    const chip = page.locator('.sc-convo-field .sc-token[data-kind="image"]');
    await expect(chip).toHaveCount(1);
    await chip.getByRole('button').click();
    await expect(chip).toHaveCount(0);
    const landed = page.waitForResponse((r) => /\/api\/images$/.test(r.url()) && r.request().method() === 'POST');
    held.release();
    await landed;
    await page.waitForTimeout(500);
    // taken off means taken off: nothing rides with the answer
    await expect(chip).toHaveCount(0);
    await answer(page, 'Thin black').click();
    await expect(turn(page, 'you:trait-glasses')).toContainText('Thin black');
    await expect(turn(page, 'you:trait-glasses').locator('img')).toHaveCount(0);
  });

  test('a detail upload that fails after the draft exists does not stall the face (PC-H4)', async ({ page }) => {
    test.setTimeout(90_000);
    const brand = await currentBrand(page);
    await page.goto(`/${brand.slug}/presenters/new`);
    await tapThrough(page);
    await answer(page, 'Glasses').click();
    await answer(page, 'Continue').click();
    await expect(log(page)).toContainText('What glasses do they wear?');
    // the picture's upload is slow, and then fails
    let release = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    let caught = () => {};
    const seen = new Promise<void>((r) => {
      caught = r;
    });
    await page.route(/\/api\/images$/, async (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      caught();
      await gate;
      await route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"disk full"}' });
    });
    await page.getByRole('button', { name: 'Add the picture of the glasses' }).click();
    await page
      .locator('.sc-convo-card input[type="file"]')
      .setInputFiles({ name: 'thin-black.png', mimeType: 'image/png', buffer: PIXEL });
    await seen;
    await answer(page, 'Thin black').click();
    // the draft's first read is held, so the failure lands before the face is asked for
    const read = await holdNext(page, /\/presenter-drafts\/pd-[a-z0-9]+$/, 'GET');
    await answer(page, 'Draw the presenter').click();
    await expect(page).toHaveURL(/\/presenters\/new\/pd-/, { timeout: 20_000 });
    await read.caught;
    const failedUpload = page.waitForResponse((r) => /\/api\/images$/.test(r.url()) && r.status() === 500);
    release();
    await failedUpload;
    read.release();
    // the draft exists and is whole: its face is drawn, or a way on is offered (a loaded machine draws slowly)
    await expect(answer(page, 'Use this person').or(answer(page, 'Retry'))).toBeVisible({ timeout: 45_000 });
  });

  test('every picture made for a detail chip is let go when the studio closes (PC-H14)', async ({ page }) => {
    test.setTimeout(60_000);
    await page.addInitScript(() => {
      const made: string[] = [];
      const revoked: string[] = [];
      const create = URL.createObjectURL.bind(URL);
      const revoke = URL.revokeObjectURL.bind(URL);
      URL.createObjectURL = (o: Blob | MediaSource) => {
        const u = create(o);
        made.push(u);
        return u;
      };
      URL.revokeObjectURL = (u: string) => {
        revoked.push(u);
        revoke(u);
      };
      (window as unknown as { __urls: unknown }).__urls = { made, revoked };
    });
    const urls = () =>
      page.evaluate(() => (window as unknown as { __urls: { made: string[]; revoked: string[] } }).__urls);
    const brand = await currentBrand(page);
    await page.goto(`/${brand.slug}/presenters/new`);
    await tapThrough(page);
    await answer(page, 'Glasses').click();
    await answer(page, 'Continue').click();
    const q = turn(page, 'q:trait-glasses');
    await expect(q).toBeVisible();
    const before = (await urls()).made.length;
    const frames = { name: 'frames.png', mimeType: 'image/png', buffer: png(200, 10, 10) };
    // the same picture chosen twice, the second time from the line under the conversation
    const first = page.waitForResponse((r) => r.request().method() === 'POST' && r.url().endsWith('/api/images'));
    await q.locator('input[type="file"]').setInputFiles(frames);
    await first;
    const second = page.waitForResponse((r) => r.request().method() === 'POST' && r.url().endsWith('/api/images'));
    await page.locator('.sc-convo-card input[type="file"]').setInputFiles(frames);
    await second;
    await page.waitForTimeout(300);
    const mine = (await urls()).made.slice(before);
    expect(mine.length).toBeGreaterThan(0);
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Leave', exact: true }).click();
    await expect(page.locator('.sc-pstudio')).toHaveCount(0);
    const { revoked } = await urls();
    expect(mine.filter((u) => !revoked.includes(u))).toEqual([]);
  });
});

// Opened from the bar's New with the keyboard and closed with Escape, focus
// used to fall to the page body, which sent a keyboard or screen-reader user
// back to the top of the page. It comes back to the control that opened it.
test('closing the studio gives the keyboard back to what opened it', async ({ page }) => {
  const brand = await currentBrand(page);
  await page.goto(`/${brand.slug}/presenters`);
  const opener = page.locator('.sc-new-go').first();
  await opener.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.sc-pstudio')).toBeVisible();
  await expect(log(page)).toContainText('Who are we making?');
  await page.keyboard.press('Escape');
  await expect(page.locator('.sc-pstudio')).toHaveCount(0);
  await expect
    .poll(() => page.evaluate(() => document.activeElement?.classList.contains('sc-new-go') ?? false))
    .toBe(true);
});
