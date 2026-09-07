import { test, expect, type Page } from '@playwright/test';
import { isolate } from './harness.js';

/**
 * Building a scene, one frame at a time.
 *
 * A scene is a world, not a picture, and the builder shows the person one
 * before asking them to keep it: a direction or a few images becomes a first
 * frame, they say yes to it or ask again, the set grows on a board view by
 * view, and one review screen names it, picks the cover and saves. The job
 * runs on the server and outlives the dialog, so a close, a reload and a
 * server that forgot the job each have a defined answer here.
 *
 * The harness has no Codex. `SCENRI_FAKE_SCENE_BUILD` hands the server a
 * reader and a drawer that finish without one: the record is read off the
 * direction, every frame is a plain tint, and each draw takes a beat so the
 * drawing states are real long enough to be seen.
 *
 * The draft half of the contract survives from the form this replaced: a
 * dismissed attempt is gone, an accidental dismissal can be undone once, a
 * dismissal leaks into no other tab or brand, and what is sent is what is on
 * the board.
 */

isolate({ env: { SCENRI_FAKE_SCENE_BUILD: '1', SCENRI_FAKE_SCENE_BUILD_MS: '350' } });

/** Two 1x1 PNGs that differ, so the content-addressed store keeps them apart. */
const A = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
const B = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);
const file = (name: string, buffer: Buffer) => ({ name, mimeType: 'image/png', buffer });

/** The brand the app resolves "/" to, whatever this machine happens to hold. */
async function currentBrand(p: Page): Promise<string> {
  await p.goto('/');
  await p.waitForURL((u) => {
    const seg = u.pathname.split('/').filter(Boolean);
    return seg.length === 1 && seg[0] !== 'setup';
  });
  return decodeURIComponent(new URL(p.url()).pathname.split('/')[1]);
}

const dlg = (p: Page) => p.locator('.sc-newdlg');
const refs = (p: Page) => p.locator('.sc-assetform-ref');
const direction = (p: Page) => p.getByLabel('Direction', { exact: true });
const nameField = (p: Page) => p.getByLabel('Name', { exact: true });
const picker = (p: Page) => p.locator('.sc-newdlg input[type="file"]').first();
const go = (p: Page) => p.locator('.sc-dlg-go');
const stage = (p: Page) => p.locator('.sc-sb-stage img');
const tiles = (p: Page) => p.locator('.sc-sb-board button.sc-sb-tile');
const drawingTile = (p: Page) => p.locator('.sc-sb-tile[data-drawing]');

const hashOf = (src: string | null) => /\/api\/images\/([a-f0-9]{32})/.exec(src ?? '')?.[1] ?? '';
const tileHashes = async (p: Page) =>
  Promise.all((await tiles(p).all()).map(async (t) => hashOf(await t.locator('img').getAttribute('src'))));

/** The brand document's scene by that name, or null. */
async function sceneNamed(p: Page, name: string): Promise<any | null> {
  const brands = await (await p.request.get('/api/brands')).json();
  for (const b of brands) {
    const s = (b.json?.scenes ?? []).find((sc: any) => sc?.name === name);
    if (s) return s;
  }
  return null;
}

const open = async (p: Page, slug: string) => {
  await p.goto(`/${slug}/scenes?new=scene`);
  await expect(p.getByRole('heading', { name: 'New scene' })).toBeVisible();
  // At the start, not attached to somebody else's job: the Direction is the tell.
  await expect(direction(p)).toBeVisible();
};

/**
 * One scene build per brand at a time, and the builder attaches to whichever
 * is live. A test that leaves its job waiting would hand it to the next test,
 * so every test ends by stopping what it started.
 */
test.afterEach(async ({ request }) => {
  const brands = await (await request.get('/api/brands')).json();
  for (const b of brands) {
    const { builds } = await (await request.get(`/api/brands/${b.id}/asset-builds`)).json();
    for (const j of builds) {
      if (!j.finished) await request.post(`/api/brands/${b.id}/asset-builds/${j.id}/cancel`);
    }
  }
});

/** Direction in, first frame out, waiting for a yes. */
const seedFrom = async (p: Page, words: string) => {
  await direction(p).fill(words);
  await expect(go(p)).toHaveText('Draw the world');
  await go(p).click();
  await expect(go(p)).toHaveText('Yes, this world', { timeout: 20_000 });
  await expect(stage(p)).toBeVisible();
};

/** Yes, then the set, then the review screen. */
const approveAndWait = async (p: Page) => {
  await go(p).click();
  await expect(go(p)).toHaveText('Save scene', { timeout: 30_000 });
  await expect(tiles(p)).toHaveCount(4);
};

test.describe('a scene is built one frame at a time', () => {
  test('the first frame appears and waits for a yes; the yes builds the set from it', async ({ page }) => {
    const slug = await currentBrand(page);
    await open(page, slug);

    // Nothing to draw from yet: the primary says why.
    await expect(go(page)).toHaveAttribute('aria-disabled', 'true');
    await direction(page).fill('A stone terrace in low evening sun');
    await expect(go(page)).not.toHaveAttribute('aria-disabled', 'true');
    await go(page).click();

    // Reading, then drawing: the stage shimmers with a clock, never a bare spinner.
    await expect(page.locator('.sc-sb-stage[data-drawing]')).toBeVisible();
    await expect(page.locator('.sc-sb-stage .sc-cell-tag')).toBeVisible();
    await expect(go(page)).toHaveText('Yes, this world', { timeout: 20_000 });
    await expect(stage(page)).toBeVisible();
    await expect(tiles(page)).toHaveCount(1);
    await expect(tiles(page).first()).toHaveAttribute('aria-label', 'First frame');
    // The reading, beside the picture.
    await expect(page.locator('.sc-sb-reading')).toContainText('Soft window light');
    await expect(page.locator('.sc-sb-status')).toHaveText('The first frame is ready. Is this the world?');

    // Yes: the set grows, one frame at a time, with a clock on the one drawing.
    await go(page).click();
    await expect(drawingTile(page)).toBeVisible();
    await expect(go(page)).toHaveText(/Drawing view \d of 4/);
    await expect(go(page)).toHaveText('Save scene', { timeout: 30_000 });
    await expect(tiles(page)).toHaveCount(4);
    await expect(drawingTile(page)).toHaveCount(0);
    await expect(page.locator('.sc-sb-status')).toHaveText('4 frames. Name it and save.');
    // The name was suggested from the direction; the cover is the first frame.
    await expect(nameField(page)).toHaveValue('A Stone Terrace');
    await expect(page.locator('.sc-sb-covertag')).toBeVisible();
  });

  test('drawing one view again keeps the others; removing one below the target draws a replacement', async ({
    page,
  }) => {
    const slug = await currentBrand(page);
    await open(page, slug);
    await seedFrom(page, 'A tiled bathhouse under skylights');
    await approveAndWait(page);
    const before = await tileHashes(page);
    expect(new Set(before).size).toBe(4);

    // Put view 1 on the stage, draw it again from there.
    await tiles(page).nth(1).click();
    await page.locator('.sc-sb-row').getByRole('button', { name: 'Draw view 1 again' }).click();
    await expect(drawingTile(page)).toBeVisible();
    await expect(go(page)).toHaveText('Save scene', { timeout: 30_000 });
    await expect(tiles(page)).toHaveCount(4);
    const after = await tileHashes(page);
    expect(after[0]).toBe(before[0]);
    expect(after).toContain(before[2]);
    expect(after).toContain(before[3]);
    expect(after).not.toContain(before[1]);

    // Remove one: below four, another is drawn to take its place.
    await tiles(page).nth(2).click();
    await page.getByRole('button', { name: /^Remove view/ }).click();
    await expect(go(page)).toHaveText('Save scene', { timeout: 30_000 });
    await expect(tiles(page)).toHaveCount(4);
    // And the seed can never be taken off the board.
    await tiles(page).first().click();
    await expect(page.getByRole('button', { name: 'Remove first frame' })).toHaveAttribute('aria-disabled', 'true');
  });

  test('the cover is chosen at review, and the saved scene shows it', async ({ page }) => {
    const slug = await currentBrand(page);
    await open(page, slug);
    await seedFrom(page, 'A chalk cliff path at noon');
    await approveAndWait(page);
    const hashes = await tileHashes(page);

    await tiles(page).nth(2).click();
    await page.getByRole('button', { name: 'Use as cover' }).click();
    await expect(tiles(page).nth(2)).toHaveAttribute('aria-label', /, cover$/);
    await nameField(page).fill('Chalk Path');
    await go(page).click();
    await expect(dlg(page)).toHaveCount(0, { timeout: 30_000 });

    const toast = page.locator('.sc-toast', { hasText: 'Chalk Path saved' });
    await expect(toast).toBeVisible();
    const scene = await sceneNamed(page, 'Chalk Path');
    expect(scene?.preview).toBe(`asset:${hashes[2]}`);
    expect(scene?.refs).toHaveLength(4);
    expect(scene?.refs.every((r: any) => r.drawn === true)).toBe(true);

    // On the wall, and on its own page the frames say what they are.
    await expect(page.getByRole('heading', { name: 'Your scenes' })).toBeVisible();
    await toast.getByRole('button', { name: 'Open' }).click();
    await expect(page).toHaveURL(new RegExp(`/${slug}/scenes/[^/]+$`));
    await expect(page.locator('.sc-lookpage-ref-cap').first()).toHaveText('Drawn view, cover');
  });

  test('closing mid-build keeps the job; the wall card and a reload both come back to it', async ({ page }) => {
    const slug = await currentBrand(page);
    let posts = 0;
    await page.route('**/asset-builds', (route) => {
      if (route.request().method() === 'POST') posts += 1;
      return route.continue();
    });
    await open(page, slug);
    await seedFrom(page, 'A copper foundry floor');
    expect(posts).toBe(1);

    // Close while the first frame waits: the card on the wall says so.
    await page.keyboard.press('Escape');
    await expect(dlg(page)).toHaveCount(0);
    const card = page.locator('.sc-lookcard[data-paused]');
    await expect(card).toBeVisible();
    await expect(card).toContainText('Waiting for you');
    // The hover pill is the card's verb on a desktop; the picture underneath opens it too.
    await card.hover();
    await card.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(go(page)).toHaveText('Yes, this world');
    await expect(page).toHaveURL(/new=scene&build=ab-/);
    expect(posts).toBe(1);

    // A reload on that URL attaches to the same job, no second start.
    await go(page).click();
    await expect(go(page)).toHaveText('Save scene', { timeout: 30_000 });
    await page.reload();
    await expect(go(page)).toHaveText('Save scene', { timeout: 20_000 });
    await expect(tiles(page)).toHaveCount(4);
    expect(posts).toBe(1);
  });

  test('stopping asks once something was approved, and hands the direction back', async ({ page }) => {
    const slug = await currentBrand(page);
    await open(page, slug);
    await seedFrom(page, 'A neon corridor in haze');
    await approveAndWait(page);

    await page.getByRole('button', { name: 'Stop building' }).click();
    const confirm = page.locator('[role="alertdialog"]');
    await expect(confirm).toBeVisible();
    await confirm.getByRole('button', { name: 'Stop building' }).click();
    await expect(confirm).toHaveCount(0);
    // Back at the start, words intact, no frames.
    await expect(go(page)).toHaveText('Draw the world');
    await expect(direction(page)).toHaveValue('A neon corridor in haze');
    await expect(tiles(page)).toHaveCount(0);
  });

  test('the keyboard alone builds and saves a scene', async ({ page }) => {
    const slug = await currentBrand(page);
    await open(page, slug);
    await direction(page).focus();
    await page.keyboard.type('A quiet marble atrium');
    await page.keyboard.press('Control+Enter');
    await expect(go(page)).toHaveText('Yes, this world', { timeout: 20_000 });
    // Focus follows the decision: Enter is the yes.
    await expect(go(page)).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(go(page)).toHaveText('Save scene', { timeout: 30_000 });
    await expect(go(page)).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(dlg(page)).toHaveCount(0, { timeout: 30_000 });
    expect(await sceneNamed(page, 'A Quiet Marble')).toBeTruthy();
  });

  test('a build the server has forgotten goes on from the frames that were approved', async ({ page }) => {
    const slug = await currentBrand(page);
    await open(page, slug);
    await seedFrom(page, 'A basalt shore at dusk');
    await approveAndWait(page);
    const approved = await tileHashes(page);

    // The registry is an in-memory Map: a restart loses the job, the frames
    // stay on disk. Stub the job away and see the same thing from the client.
    let sent: { imageHashes?: string[]; drawnHashes?: string[] } | null = null;
    await page.route('**/asset-builds/ab-*', (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"build not found"}' })
        : route.continue(),
    );
    await page.route('**/asset-builds', (route) => {
      if (route.request().method() === 'POST') {
        sent = route.request().postDataJSON();
        return route.continue();
      }
      if (route.request().method() === 'GET')
        return route.fulfill({ status: 200, contentType: 'application/json', body: '{"builds":[]}' });
      return route.continue();
    });
    await page.reload();
    await expect(go(page)).toHaveText('Continue', { timeout: 20_000 });
    await expect(page.locator('.sc-sb-status')).toContainText('still here');
    await expect(tiles(page)).toHaveCount(4);
    await go(page).click();
    await expect.poll(() => sent).not.toBeNull();
    expect(sent?.imageHashes).toEqual(approved);
    expect(sent?.drawnHashes).toEqual(approved);
  });
});

test.describe('a scene creation draft lives exactly as long as the attempt', () => {
  test('a dismissed attempt is gone when you come back', async ({ page }) => {
    const slug = await currentBrand(page);

    await open(page, slug);
    await picker(page).setInputFiles([file('yard.png', A), file('wall.png', B)]);
    await expect(refs(page)).toHaveCount(2);
    await direction(page).fill('A stone terrace in low evening sun.');

    // Past the 400ms debounce, so anything that wanted to write has written.
    await page.waitForTimeout(600);
    await page.keyboard.press('Escape');
    await expect(dlg(page)).toHaveCount(0);
    // leaving is allowed to just work: no "discard your work?" in the way
    await expect(page.locator('[role="alertdialog"]')).toHaveCount(0);

    // A new scene has to feel new. Nothing of the attempt that was abandoned
    // comes back, least of all the references and the Direction, which are read
    // as art direction and would quietly change what the next scene is built from.
    await open(page, slug);
    await expect(refs(page)).toHaveCount(0);
    await expect(direction(page)).toHaveValue('');
  });

  test('an accidental dismissal can be undone, once', async ({ page }) => {
    const slug = await currentBrand(page);

    await open(page, slug);
    await picker(page).setInputFiles([file('yard.png', A), file('wall.png', B)]);
    await expect(refs(page)).toHaveCount(2);
    await direction(page).fill('A stone terrace in low evening sun.');
    await page.waitForTimeout(600);
    await page.keyboard.press('Escape');

    const toast = page.locator('.sc-toast', { hasText: 'Scene discarded' });
    await expect(toast).toBeVisible();
    await toast.getByRole('button', { name: 'Undo' }).click();

    // everything, photographs included: re-uploading is the thing this avoids
    await expect(page.getByRole('heading', { name: 'New scene' })).toBeVisible();
    await expect(refs(page)).toHaveCount(2);
    await expect(direction(page)).toHaveValue('A stone terrace in low evening sun.');

    // The offer was for that one closing. Leaving again and opening the flow
    // by hand starts from nothing, or this is the old bug wearing a button.
    await page.keyboard.press('Escape');
    await open(page, slug);
    await expect(refs(page)).toHaveCount(0);
    await expect(direction(page)).toHaveValue('');
  });

  test('a start that fails keeps the words and the images', async ({ page }) => {
    const slug = await currentBrand(page);
    await page.route('**/asset-builds', (route) =>
      route.request().method() === 'POST'
        ? route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"engine fell over"}' })
        : route.continue(),
    );

    await open(page, slug);
    await picker(page).setInputFiles([file('yard.png', A)]);
    await expect(refs(page)).toHaveCount(1);
    await direction(page).fill('A stone terrace in low evening sun.');
    await go(page).click();

    await expect(dlg(page)).toBeVisible();
    await expect(page.locator('.sc-newdlg-err')).toContainText('engine fell over');
    await expect(refs(page)).toHaveCount(1);
    await expect(direction(page)).toHaveValue('A stone terrace in low evening sun.');
  });

  test('a dismissal leaves nothing behind in another tab or another brand', async ({ page, context }) => {
    const slug = await currentBrand(page);

    const made = await page.request.post('/api/brands', {
      data: { brand: { specVersion: '0.1', meta: { name: 'Second Brand' } } },
    });
    expect(made.ok(), await made.text()).toBe(true);
    const list = await (await page.request.get('/api/brands')).json();
    const otherSlug = list.find(
      (b: { slug: string; json: { meta?: { name?: string } } }) => b.json?.meta?.name === 'Second Brand',
    )?.slug;
    expect(otherSlug, 'the second brand should have a slug of its own').toBeTruthy();

    await open(page, slug);
    await picker(page).setInputFiles([file('yard.png', A)]);
    await expect(refs(page)).toHaveCount(1);
    await direction(page).fill('A stone terrace in low evening sun.');
    await page.waitForTimeout(600);
    await page.keyboard.press('Escape');
    await expect(dlg(page)).toHaveCount(0);

    await open(page, slug);
    await expect(refs(page)).toHaveCount(0);
    await page.keyboard.press('Escape');

    await open(page, otherSlug as string);
    await expect(refs(page)).toHaveCount(0);
    await expect(direction(page)).toHaveValue('');
    await page.keyboard.press('Escape');

    const other = await context.newPage();
    await open(other, slug);
    await expect(other.locator('.sc-assetform-ref')).toHaveCount(0);
    await expect(other.getByLabel('Direction', { exact: true })).toHaveValue('');
    await other.close();
  });

  test('a removed reference is gone from the well and from what gets sent', async ({ page }) => {
    const slug = await currentBrand(page);
    let sent: { imageHashes?: string[] } | null = null;
    await page.route('**/asset-builds', (route) => {
      if (route.request().method() === 'POST') sent = route.request().postDataJSON();
      return route.continue();
    });

    await open(page, slug);
    await picker(page).setInputFiles([file('yard.png', A), file('wall.png', B)]);
    await expect(refs(page)).toHaveCount(2);
    const dropped = hashOf(await refs(page).nth(0).locator('img').getAttribute('src'));
    const kept = hashOf(await refs(page).nth(1).locator('img').getAttribute('src'));

    await page.getByRole('button', { name: 'Remove reference 1' }).click();
    await expect(refs(page)).toHaveCount(1);

    await direction(page).fill('A stone terrace in low evening sun.');
    await go(page).click();
    await expect(go(page)).toHaveText('Yes, this world', { timeout: 20_000 });

    expect(sent).not.toBeNull();
    expect(sent?.imageHashes).toEqual([kept]);
    expect(sent?.imageHashes).not.toContain(dropped);
    // The one upload is on the board beside the first frame.
    await expect(tiles(page)).toHaveCount(2);
  });

  test('removing a reference while another upload is still in flight sticks', async ({ page }) => {
    const slug = await currentBrand(page);

    await open(page, slug);
    await picker(page).setInputFiles([file('yard.png', A)]);
    await expect(refs(page)).toHaveCount(1);
    const dropped = hashOf(await refs(page).nth(0).locator('img').getAttribute('src'));

    await page.route('**/api/images', async (route) => {
      await new Promise((r) => setTimeout(r, 1500));
      await route.continue();
    });

    await picker(page).setInputFiles([file('wall.png', B)]);
    await page.getByRole('button', { name: 'Remove reference 1' }).click();
    await expect(refs(page)).toHaveCount(0);

    await expect(refs(page)).toHaveCount(1, { timeout: 15_000 });
    expect(hashOf(await refs(page).nth(0).locator('img').getAttribute('src'))).not.toBe(dropped);
  });
});
