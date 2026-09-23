import { expect, type Page, test } from '@playwright/test';
import { arrived, isolate } from './harness.js';
import { finishSceneSet } from './realtime.js';

/**
 * A scene started from one of the brand's own shots.
 *
 * Add pictures is the upload, with one quiet way to a shot under it. The shots
 * are picked in the conversation: a search that stays put above a box two rows
 * tall that scrolls on its own and reads the next page at its end. Only the
 * place in the shot is read; a shot made in a saved scene offers that scene
 * first, and taking it draws nothing.
 *
 * The brand holds sixty-odd demo shots (the demo engine draws the same words as
 * the same bytes, so each batch of four shares one picture, the case that used
 * to leave stale cards behind a search), one about a harbour, one made in the
 * harness's own scene and a refinement of it.
 */
isolate({
  env: {
    SCENRI_DEMO_BUILDS: '1',
    SCENRI_DEMO_REFS: '5',
    SCENRI_DEMO_DELAY_MS: '600',
    SCENRI_DEMO_ANALYSIS: 'usable',
    // slow enough that Stop and a reload land while the shot is being read
    SCENRI_DEMO_READ_MS: '1500',
  },
  scene: true,
});
test.describe.configure({ mode: 'serial' });

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

let brand = { id: '', slug: '' };
let harbour = { id: '', hash: '' };
let refined = '';

const studio = (p: Page) => p.locator('.sc-pstudio[data-kind="scene"]');
const turn = (p: Page, key: string) => studio(p).locator(`[data-turn="${key}"]`);
const openQ = (p: Page) => studio(p).locator('[data-turn^="q:"]').last();
const line = (p: Page) => studio(p).locator('.sc-pstudio-foot textarea');
const picker = (p: Page) => turn(p, 'q:shot');
const cards = (p: Page) => picker(p).locator('.sc-convo-pick-grid > button');
const field = (p: Page) => picker(p).getByRole('searchbox', { name: 'Find a shot' });
const box = (p: Page) => picker(p).locator('.sc-convo-pick-scroll');
const top = async (p: Page, l: ReturnType<typeof field>) => Math.round((await l.boundingBox())?.y ?? -1);
/** Where the field stands once the conversation has stopped arriving: the same two reads in a row. */
async function standing(p: Page): Promise<number> {
  let last = -2;
  let now = -1;
  await expect
    .poll(
      async () => {
        last = now;
        now = await top(p, field(p));
        return now === last;
      },
      { intervals: [250] },
    )
    .toBe(true);
  return now;
}

async function start(p: Page) {
  await p.goto(`/${brand.slug}/scenes/new`);
  await arrived(p, '.sc-pstudio[data-kind="scene"]');
  await expect(turn(p, 'q:source')).toBeVisible();
}

async function toShots(p: Page) {
  await start(p);
  await turn(p, 'q:source').getByRole('button', { name: 'Add pictures', exact: true }).click();
  await turn(p, 'q:photos').getByRole('button', { name: 'Or start from one of your shots' }).click();
  await expect(cards(p).first()).toBeVisible();
}

test('the brand has its shots', async ({ page }) => {
  test.setTimeout(150_000);
  await page.goto('/');
  await page.waitForURL((u) => {
    const seg = u.pathname.split('/').filter(Boolean);
    return seg.length === 1 && seg[0] !== 'setup';
  });
  const slug = decodeURIComponent(new URL(page.url()).pathname.split('/')[1]);
  const brands = (await api(page, '/api/brands')) as any[];
  brand = { id: brands.find((b) => b.slug === slug).id, slug };
  const ws = (await api(page, `/api/brands/${brand.id}/workspace`)) as any;
  const make = async (body: object) =>
    (await api(
      page,
      '/api/nodes',
      postJson({ projectId: ws.project.id, parentId: ws.root, kind: 'generation', engineId: 'demo', ...body }),
    )) as any;
  for (let i = 0; i < 15; i++) await make({ prompt: `window study ${i}`, count: 4 });
  const h = await make({ brief: { tokens: [{ t: 'text', v: ' harbour at dawn ' }] }, count: 1 });
  const made = await make({
    brief: {
      tokens: [
        { t: 'text', v: ' morning light ' },
        { t: 'template', id: 'us-e2efixture' },
      ],
    },
    count: 1,
  });
  const done = async (id: string) => {
    let n: any = null;
    await expect
      .poll(
        async () => {
          n = await api(page, `/api/nodes/${id}`);
          return n.status;
        },
        { timeout: 60_000 },
      )
      .toBe('done');
    return n;
  };
  const hn = await done(h.id);
  harbour = { id: hn.id, hash: hn.images[0] };
  const mn = await done(made.id);
  const edit = (await api(
    page,
    '/api/nodes',
    postJson({
      projectId: ws.project.id,
      parentId: mn.id,
      kind: 'edit',
      prompt: 'warmer quayside',
      engineId: 'demo',
      sourceImage: mn.images[0],
    }),
  )) as any;
  refined = (await done(edit.id)).id;
  await expect
    .poll(async () => ((await api(page, `/api/brands/${brand.id}/feed?limit=100`)) as any).items.length, {
      timeout: 60_000,
    })
    .toBeGreaterThanOrEqual(63);
});

test('Add pictures is the upload, with one quiet way to a shot until a picture is in', async ({ page }) => {
  await start(page);
  await turn(page, 'q:source').getByRole('button', { name: 'Add pictures', exact: true }).click();
  const q = turn(page, 'q:photos');
  await expect(q).toContainText('Add pictures of the place');
  // no scenes offered beside the well any more
  await expect(q).not.toContainText('Or take a scene you already made');
  const other = q.getByRole('button', { name: 'Or start from one of your shots' });
  await expect(other).toBeVisible();
  await q.locator('input[type="file"]').setInputFiles({
    name: 'a.png',
    mimeType: 'image/png',
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    ),
  });
  await expect(q.locator('.sc-assetform-ref img')).toHaveCount(1);
  await expect(other).toHaveCount(0);
});

test('the shots scroll in a box of their own, the search narrows from its first letter, and nothing around them moves', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await toShots(page);
  await expect(line(page)).toHaveAttribute('placeholder', 'Choose a shot above.');
  const first = await cards(page).count();
  expect(first).toBeGreaterThanOrEqual(40);
  // two rows of four, exactly: the third row starts below the box's edge
  const b = await box(page).boundingBox();
  const third = await cards(page).nth(8).boundingBox();
  const second = await cards(page).nth(4).boundingBox();
  expect(Math.round((second?.y ?? 0) + (second?.height ?? 0))).toBeLessThanOrEqual(
    Math.round((b?.y ?? 0) + (b?.height ?? 0)),
  );
  expect(third?.y ?? 0).toBeGreaterThanOrEqual((b?.y ?? 0) + (b?.height ?? 0) - 4.5);
  const at = await standing(page);
  const tall = Math.round(b?.height ?? 0);

  // the next page is read as the box's end comes into view
  await expect
    .poll(
      async () => {
        await box(page).evaluate((el) => {
          el.scrollTop = el.scrollHeight;
        });
        return cards(page).count();
      },
      { timeout: 15_000 },
    )
    .toBeGreaterThan(first);
  expect(await top(page, field(page))).toBe(at);

  // one letter narrows, at the start of a word: "h" is only the harbour's
  await field(page).fill('h');
  await expect(cards(page)).toHaveCount(1);
  await expect(picker(page).locator('.sc-convo-pick-empty')).toHaveCount(0);
  expect(await top(page, field(page))).toBe(at);
  expect(Math.round((await box(page).boundingBox())?.height ?? 0)).toBe(tall);

  // nothing matches: said in the box, which keeps its height
  await field(page).fill('hzz');
  await expect(picker(page).locator('.sc-convo-pick-empty')).toHaveText('No shot matches "hzz".');
  await expect(cards(page)).toHaveCount(0);
  expect(await top(page, field(page))).toBe(at);
  expect(Math.round((await box(page).boundingBox())?.height ?? 0)).toBe(tall);

  // cleared, the whole library again, with no card left behind from before
  await field(page).fill('');
  await expect.poll(() => cards(page).count()).toBeGreaterThanOrEqual(40);
  const ids = await cards(page).evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
  expect(ids.length).toBeLessThanOrEqual(64);
});

test('a shot is read for its place, drawn and used, and the scene keeps the shot as what it was read from', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await toShots(page);
  await field(page).fill('harbour');
  await expect(cards(page)).toHaveCount(1);
  const job = page.waitForRequest(
    (r) => r.method() === 'POST' && /\/scene-studio\/jobs$/.test(r.url()) && r.postDataJSON()?.kind === 'make',
  );
  await cards(page).first().click();
  const sent = (await job).postDataJSON();
  expect(sent.shot).toBe(true);
  expect(sent.imageHashes).toEqual([harbour.hash]);
  expect(sent.instruction ?? '').toBe('');

  await expect(turn(page, 'you:source')).toContainText('Start from one of my shots');
  await expect(turn(page, 'you:shot').locator('img')).toHaveCount(1);
  const agree = openQ(page);
  await expect(agree).toContainText('Here is the place I read in your shot. Ready to draw?');
  await expect(line(page)).toHaveAttribute('placeholder', 'Anything to keep or ignore in it?');

  // another shot opens the grid again in place, and Cancel leaves it as it was
  await agree.getByRole('button', { name: 'Choose another shot' }).click();
  await expect(picker(page)).toBeVisible();
  await picker(page).getByRole('button', { name: 'Cancel' }).click();
  await expect(openQ(page)).toContainText('Here is the place I read in your shot.');

  await openQ(page).getByRole('button', { name: 'Draw the scene', exact: true }).click();
  await line(page).fill('Harbour Place');
  await line(page).press('Enter');
  await expect(openQ(page)).toHaveAttribute('data-turn', /^q:decide-/, { timeout: 30_000 });
  await openQ(page).getByRole('button', { name: 'Use this scene', exact: true }).click();
  await finishSceneSet(page);
  await page.waitForURL(/\/scenes\/us-/);
  const saved = ((await api(page, '/api/brands')) as any[])
    .flatMap((b) => b.json?.scenes ?? [])
    .find((s: any) => s.name === 'Harbour Place');
  expect(saved.refs).toEqual([{ file: `asset:${harbour.hash}` }]);
  expect(saved.figure).toBeUndefined();
  await expect(page.locator('.sc-presenterpage-sources-lb')).toHaveText('What it was read from');
});

test('a shot read left mid-way is one read, and the conversation comes back to it', async ({ page }) => {
  test.setTimeout(60_000);
  const makes: string[] = [];
  page.on('request', (r) => {
    if (r.method() === 'POST' && /\/scene-studio\/jobs$/.test(r.url()) && r.postDataJSON()?.kind === 'make')
      makes.push(r.url());
  });
  await toShots(page);
  await field(page).fill('harbour');
  await expect(cards(page)).toHaveCount(1);
  const started = page.waitForResponse((r) => /\/scene-studio\/jobs$/.test(r.url()) && r.request().method() === 'POST');
  await cards(page).first().click();
  await started;
  // gone before the read lands, and back on the same address
  await page.reload();
  await arrived(page, '.sc-pstudio[data-kind="scene"]');
  await expect(openQ(page)).toContainText('Here is the place I read in your shot.', { timeout: 20_000 });
  await expect(turn(page, 'you:shot').locator('img')).toHaveCount(1);
  expect(makes).toHaveLength(1);
});

test('Stop during a shot read says so, and Try again reads the same shot for its place', async ({ page }) => {
  test.setTimeout(60_000);
  const makes: any[] = [];
  page.on('request', (r) => {
    if (r.method() === 'POST' && /\/scene-studio\/jobs$/.test(r.url()) && r.postDataJSON()?.kind === 'make')
      makes.push(r.postDataJSON());
  });
  await toShots(page);
  await field(page).fill('harbour');
  await expect(cards(page)).toHaveCount(1);
  await cards(page).first().click();
  await studio(page).getByRole('button', { name: 'Stop', exact: true }).click();
  const retry = turn(page, 'q:retry');
  await expect(retry).toContainText('Stopped before the place was read');
  await retry.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(openQ(page)).toContainText('Here is the place I read in your shot.', { timeout: 20_000 });
  expect(makes).toHaveLength(2);
  for (const m of makes) {
    expect(m.shot).toBe(true);
    expect(m.imageHashes).toEqual([harbour.hash]);
  }
});

test('Escape empties a search first, and only then leaves', async ({ page }) => {
  await toShots(page);
  await field(page).fill('h');
  await expect(cards(page)).toHaveCount(1);
  await expect(picker(page).getByRole('status')).toHaveText('1 shot');
  await field(page).press('Escape');
  await expect(field(page)).toHaveValue('');
  await expect.poll(() => cards(page).count()).toBeGreaterThan(1);
  await expect(studio(page)).toBeVisible();
  // an empty field lets Escape through: something was answered, so leaving asks first
  await field(page).press('Escape');
  await expect(page.getByText('Leave this scene?')).toBeVisible();
});

test('a shot made in a saved scene offers that scene, and taking it opens the scene with nothing drawn', async ({
  page,
}) => {
  test.setTimeout(60_000);
  const jobs: string[] = [];
  page.on('request', (r) => {
    if (r.method() === 'POST' && /\/scene-studio\/jobs$/.test(r.url())) jobs.push(r.url());
  });
  await toShots(page);
  // a refinement carries no scene of its own: the first shot of its line does
  await field(page).fill('warmer');
  await expect(cards(page)).toHaveCount(1);
  await cards(page).first().click();
  const reuse = turn(page, 'q:reuse');
  await expect(reuse).toContainText('This shot was made in Fixture studio.');
  await expect(line(page)).toHaveAttribute('placeholder', 'Choose above.');
  await reuse.getByRole('button', { name: 'Use Fixture studio', exact: true }).click();
  await page.waitForURL(/\/scenes\/us-e2efixture$/);
  // nothing was saved here, so nothing says it was
  await expect(page.getByText('Fixture studio saved')).toHaveCount(0);
  expect(jobs).toEqual([]);
  expect(refined).toBeTruthy();
});

test('a new scene can still be read from a shot made in one, and Back returns to an empty upload', async ({ page }) => {
  await toShots(page);
  await field(page).fill('morning');
  await expect(cards(page)).toHaveCount(1);
  await cards(page).first().click();
  await turn(page, 'q:reuse').getByRole('button', { name: 'Read a new scene from it', exact: true }).click();
  await expect(openQ(page)).toContainText('Here is the place I read in your shot.', { timeout: 20_000 });
  await expect(turn(page, 'you:reuse')).toContainText('Read a new scene from it');

  await start(page);
  await turn(page, 'q:source').getByRole('button', { name: 'Add pictures', exact: true }).click();
  await turn(page, 'q:photos').getByRole('button', { name: 'Or start from one of your shots' }).click();
  await picker(page).getByRole('button', { name: 'Back to pictures' }).click();
  const q = turn(page, 'q:photos');
  await expect(q).toContainText('Add pictures of the place');
  await expect(q.locator('.sc-assetform-ref img')).toHaveCount(0);
  await expect(q.getByRole('button', { name: 'Or start from one of your shots' })).toBeVisible();
});
