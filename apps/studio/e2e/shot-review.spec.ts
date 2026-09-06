import { test, expect, type Page } from '@playwright/test';
import { isolate } from './harness.js';

/**
 * Reviewing a shot: the actions in its header, the picture zooming where it
 * is, the rail of the feed beside it and the strip of its own history under
 * it. Four roots from one Generate, two refinements of B and one of D, so
 * the two axes can be told apart: the rail walks the feed, the strip walks
 * the history of the shot on screen, and neither moves the other.
 */

isolate();

const api = async (p: Page, path: string, init?: RequestInit) =>
  p.evaluate(
    async ([u, i]) => {
      const r = await fetch(u as string, i as RequestInit);
      return r.json();
    },
    [path, init ?? undefined],
  );

const postJson = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

async function currentBrand(p: Page): Promise<{ id: string; slug: string }> {
  await p.goto('/');
  await p.waitForURL((u) => {
    const seg = u.pathname.split('/').filter(Boolean);
    return seg.length === 1 && seg[0] !== 'setup';
  });
  const slug = decodeURIComponent(new URL(p.url()).pathname.split('/')[1]);
  const brands = (await api(p, '/api/brands')) as any[];
  return { id: brands.find((b) => b.slug === slug).id, slug };
}

type Shot = { id: string; hash: string };

/** A, B, C, D from one request; B1 and B2 under B; D1 under D. Seeded once per file. */
let brand: { id: string; slug: string };
let shots: { a: Shot; b: Shot; c: Shot; d: Shot; b1: Shot; b2: Shot; d1: Shot };
let ws: any;

async function settled(p: Page, id: string): Promise<any> {
  for (let i = 0; i < 60; i++) {
    const n = (await api(p, `/api/nodes/${id}`)) as any;
    if (n?.id && n.status !== 'running') return n;
    await p.waitForTimeout(250);
  }
  throw new Error(`${id} never finished`);
}

test.beforeAll(async ({ browser }) => {
  // seven demo renders on a loaded machine are well past the 20s a test gets
  test.setTimeout(120_000);
  const page = await browser.newPage();
  brand = await currentBrand(page);
  ws = await api(page, `/api/brands/${brand.id}/workspace`);
  const root = ws.root ? { id: ws.root as string } : null;
  const made = (await api(
    page,
    '/api/nodes',
    postJson({
      projectId: ws.project.id,
      parentId: root?.id ?? null,
      kind: 'generation',
      prompt: 'review battery',
      engineId: 'demo',
      count: 4,
    }),
  )) as any;
  const [a, b, c, d] = await Promise.all(made.siblings.map((s: any) => settled(page, s.id)));
  const refine = async (parent: any, prompt: string) => {
    const edit = (await api(
      page,
      '/api/nodes',
      postJson({
        projectId: ws.project.id,
        parentId: parent.id,
        kind: 'edit',
        prompt,
        engineId: 'demo',
        sourceImage: parent.images[0],
      }),
    )) as any;
    return settled(page, edit.id);
  };
  const b1 = await refine(b, 'warmer light');
  const b2 = await refine(b, 'tighter crop');
  const d1 = await refine(d, 'cooler light');
  const shot = (n: any): Shot => ({ id: n.id, hash: n.images[0] });
  shots = { a: shot(a), b: shot(b), c: shot(c), d: shot(d), b1: shot(b1), b2: shot(b2), d1: shot(d1) };
  await page.close();
});

const shotUrl = (s: Shot) => `/${brand.slug}/create/shots/${s.id}`;
const thumbOf = (s: Shot) => `/api/images/${s.hash}/thumb?w=160`;
const stripSrcs = (p: Page) =>
  p.locator('.sc-thumbs .sc-thumb').evaluateAll((els) => els.map((e) => e.getAttribute('src')));
const railSrcs = (p: Page) =>
  p.locator('.sc-rail-tile img').evaluateAll((els) => els.map((e) => e.getAttribute('src')));
const pressedIn = (p: Page, scope: string) => p.locator(`${scope} [aria-pressed="true"] img`).getAttribute('src');

test("the strip is the root's whole history, whichever version is on the stage", async ({ page }) => {
  await page.goto(shotUrl(shots.b));
  await expect(page.locator('.sc-ovl')).toBeVisible();
  await expect.poll(() => stripSrcs(page)).toEqual([shots.b, shots.b1, shots.b2].map(thumbOf));
  expect(await pressedIn(page, '.sc-thumbs')).toBe(thumbOf(shots.b));

  // a version on the stage: the same strip, a different ring; the rail rings it too
  await page.locator('.sc-thumbs .sc-thumb-btn').nth(1).click();
  await expect(page).toHaveURL(new RegExp(`/shots/${shots.b1.id}$`));
  await expect.poll(() => stripSrcs(page)).toEqual([shots.b, shots.b1, shots.b2].map(thumbOf));
  expect(await pressedIn(page, '.sc-thumbs')).toBe(thumbOf(shots.b1));
  expect(await pressedIn(page, '.sc-rail')).toBe(thumbOf(shots.b1));

  // another root from the rail: its own history, and none of B's
  await page.locator(`.sc-rail-tile img[src="${thumbOf(shots.d)}"]`).click();
  await expect(page).toHaveURL(new RegExp(`/shots/${shots.d.id}$`));
  await expect.poll(() => stripSrcs(page)).toEqual([shots.d, shots.d1].map(thumbOf));

  // a root with no history has no strip at all
  await page.locator(`.sc-rail-tile img[src="${thumbOf(shots.a)}"]`).click();
  await expect(page).toHaveURL(new RegExp(`/shots/${shots.a.id}$`));
  await expect(page.locator('.sc-thumbs')).toHaveCount(0);
});

test('the rail is the feed, and the arrows, the keys and the wheel walk it', async ({ page }) => {
  await page.goto(shotUrl(shots.b));
  await expect(page.locator('.sc-ovl')).toBeVisible();
  const feed = (await api(page, `/api/brands/${brand.id}/feed?limit=60`)) as any;
  const order: string[] = feed.items.map((n: any) => n.id);
  await expect.poll(() => railSrcs(page)).toEqual(feed.items.map((n: any) => `/api/images/${n.images[0]}/thumb?w=160`));

  const at = order.indexOf(shots.b.id);
  const next = order[at + 1];
  const prev = order[at - 1];
  await page.locator('.sc-ovl-bar [aria-label="Next shot"]').click();
  await expect(page).toHaveURL(new RegExp(`/shots/${next}$`));
  await page.keyboard.press('ArrowLeft');
  await expect(page).toHaveURL(new RegExp(`/shots/${shots.b.id}$`));
  await page.keyboard.press('ArrowLeft');
  await expect(page).toHaveURL(new RegExp(`/shots/${prev}$`));

  // a wheel over the picture at fit is nobody's: the shot stays put
  const pic = page.locator('.sc-stage-view');
  const box = (await pic.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, 120);
  await page.waitForTimeout(300);
  await expect(page).toHaveURL(new RegExp(`/shots/${prev}$`));
});

test('refining after a switch lands under the shot on the stage', async ({ page }) => {
  await page.goto(shotUrl(shots.b));
  await expect(page.locator('.sc-ovl')).toBeVisible();
  await page.locator(`.sc-rail-tile img[src="${thumbOf(shots.c)}"]`).click();
  await expect(page).toHaveURL(new RegExp(`/shots/${shots.c.id}$`));
  let posted: any = null;
  await page.route('**/api/nodes', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    posted = route.request().postDataJSON();
    await route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'not today' }) });
  });
  await page.locator('.sc-ovl .sc-brief-line').click();
  await page.keyboard.type('softer shadows');
  await page.locator('.sc-ovl .sc-send').click();
  await expect.poll(() => posted?.kind).toBe('edit');
  expect(posted.parentId).toBe(shots.c.id);
  expect(posted.sourceImage).toBe(shots.c.hash);
});

test('the picture is a loupe: a click shows actual size about the point, a click again fits it', async ({ page }) => {
  await page.goto(shotUrl(shots.a));
  await expect(page.locator('.sc-ovl')).toBeVisible();
  const pic = page.locator('.sc-stage-view');
  const frame = page.locator('.sc-stage-view .sc-frame');
  const img = page.locator('.sc-stage-img');
  await expect(pic).not.toHaveAttribute('data-zoomed', '');
  // nothing to read: the loupe carries no chrome
  await expect(page.locator('.sc-ovl-zoom')).toHaveCount(0);

  const box = (await img.boundingBox())!;
  await img.click({ position: { x: box.width * 0.25, y: box.height * 0.25 } });
  await expect(pic).toHaveAttribute('data-zoomed', '');
  // the picture at its own pixel size: the frame's width times its transform over the pixels
  const scale = await frame.evaluate((el) => {
    const m = /scale\(([\d.]+)\)/.exec((el as HTMLElement).style.transform);
    const i = el.querySelector('img') as HTMLImageElement;
    return m ? (Number(m[1]) * (el as HTMLElement).offsetWidth) / i.naturalWidth : null;
  });
  expect(scale).toBeCloseTo(1, 2);
  // the shot did not move: a look is not a step
  await expect(page).toHaveURL(new RegExp(`/shots/${shots.a.id}$`));

  // close up, a wheel pans and never steps
  const view = (await pic.boundingBox())!;
  await page.mouse.move(view.x + view.width / 2, view.y + view.height / 2);
  await page.mouse.wheel(0, 120);
  await expect(page).toHaveURL(new RegExp(`/shots/${shots.a.id}$`));
  await expect(pic).toHaveAttribute('data-zoomed', '');

  // a click takes it back
  await pic.click({ position: { x: view.width / 2, y: view.height / 2 } });
  await expect(pic).not.toHaveAttribute('data-zoomed', '');
  await expect(frame).toHaveAttribute('style', /^((?!scale).)*$/);

  // Enter is the click from the keyboard
  await pic.focus();
  await page.keyboard.press('Enter');
  await expect(pic).toHaveAttribute('data-zoomed', '');
  await page.keyboard.press('Enter');
  await expect(pic).not.toHaveAttribute('data-zoomed', '');

  // at fit the wheel is not the picture's: nothing zooms, nothing steps
  await page.mouse.wheel(0, -120);
  await page.waitForTimeout(300);
  await expect(pic).not.toHaveAttribute('data-zoomed', '');
  await expect(page).toHaveURL(new RegExp(`/shots/${shots.a.id}$`));
});

test('every icon in the header says its name on hover and on focus', async ({ page }) => {
  await page.goto(shotUrl(shots.a));
  await expect(page.locator('.sc-ovl')).toBeVisible();
  await page.locator('.sc-ovl-acts [aria-label="Keep"]').hover();
  await expect(page.getByRole('tooltip')).toHaveText('Keep');
  await page.locator('.sc-ovl-bar [aria-label="Close"]').focus();
  await expect(page.getByRole('tooltip')).toHaveText('Close (esc)');
  // no native title doubles the tooltip
  expect(await page.locator('.sc-ovl-bar button[title]').count()).toBe(0);
});

test('keep is a pressed toggle that survives a reload', async ({ page }) => {
  await page.goto(shotUrl(shots.c));
  await expect(page.locator('.sc-ovl')).toBeVisible();
  const keep = page.locator('.sc-ovl-acts [aria-label="Keep"]');
  await expect(keep).toHaveAttribute('aria-pressed', 'false');
  await keep.click();
  const kept = page.locator('.sc-ovl-acts [aria-label="Remove from keepers"]');
  await expect(kept).toHaveAttribute('aria-pressed', 'true');
  await expect(kept).toHaveAttribute('data-on', 'true');
  await expect.poll(async () => ((await api(page, `/api/nodes/${shots.c.id}`)) as any).kept).toBe(true);
  await page.reload();
  await expect(page.locator('.sc-ovl-acts [aria-label="Remove from keepers"]')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('.sc-ovl-acts [aria-label="Remove from keepers"]').click();
  await expect(page.locator('.sc-ovl-acts [aria-label="Keep"]')).toHaveAttribute('aria-pressed', 'false');
});

test('copy says Copied on the control itself', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto(shotUrl(shots.a));
  await expect(page.locator('.sc-ovl')).toBeVisible();
  await page.locator('.sc-ovl-acts [aria-label="Copy image"]').click();
  await expect(page.getByRole('tooltip')).toHaveText('Copied');
  await expect(page.locator('.sc-toast')).toHaveCount(0);
  const kind = await page.evaluate(async () => {
    const items = await navigator.clipboard.read();
    return items[0]?.types.join(',');
  });
  expect(kind).toContain('image/png');
});

test('archive closes the shot with an undo, and restore keeps it open', async ({ page }) => {
  await page.goto(shotUrl(shots.d1));
  await expect(page.locator('.sc-ovl')).toBeVisible();
  await page.locator('.sc-ovl-acts [aria-label="Archive"]').click();
  await expect(page.locator('.sc-ovl')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Undo' })).toBeVisible();
  await expect.poll(async () => ((await api(page, `/api/nodes/${shots.d1.id}`)) as any).archived).toBe(true);

  await page.goto(`${shotUrl(shots.d1)}?tab=archived`);
  await expect(page.locator('.sc-ovl')).toBeVisible();
  const restore = page.locator('.sc-ovl-acts [aria-label="Restore"]');
  await expect(restore).toBeVisible();
  await restore.click();
  await expect(page.locator('.sc-ovl-acts [aria-label="Archive"]')).toBeVisible();
  await expect(page.locator('.sc-ovl')).toBeVisible();
  await expect.poll(async () => ((await api(page, `/api/nodes/${shots.d1.id}`)) as any).archived).toBe(false);
});
