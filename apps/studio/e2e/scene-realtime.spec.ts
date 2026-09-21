import { test, expect } from '@playwright/test';
import { isolate } from './harness.js';
import {
  askSceneMenu,
  currentBrand,
  expectSameSession,
  goCreate,
  goScenes,
  holdNext,
  mainNav,
  markSession,
  menuRow,
  openOwnedScene,
  ownedSceneCard,
  sceneNames,
  buildScene,
  renameScene,
  seedScene,
  switchBrand,
  uploadPng,
} from './realtime.js';

/**
 * A scene mutation reaches every surface in the same commit, or it is not done.
 *
 * Owned scenes live in the brand document the shell holds, the same as owned
 * presenters, so one `applyBrand` is the whole propagation: the wall, the page,
 * the caret menu, the rail and the chips all read that one row. Delete used to
 * answer `{ok:true}` and apply nothing, so the card stayed on the wall until a
 * reload while the server had already let it go.
 *
 * Every test here loads one document at its start and then moves only through
 * the app, and proves at the end that it is still the same document.
 */
// The demo engine draws and the demo analyzer reads: a scene built here goes
// the way a person builds one, through the studio, and neither half waits on
// an account.
isolate({
  env: {
    SCENRI_DEMO_BUILDS: '1',
    SCENRI_DEMO_REFS: '5',
    SCENRI_DEMO_ANALYSIS: 'usable',
    SCENRI_DEMO_READ_MS: '300',
  },
});

test('deleting a scene takes its card off the wall and the scene menu without a reload', async ({ page }) => {
  const brand = await currentBrand(page);
  await seedScene(page.request, brand.id, 'Vanish Loft');
  await seedScene(page.request, brand.id, 'Stays Loft');

  await page.goto(`/${brand.slug}/scenes`);
  await markSession(page);
  await expect(ownedSceneCard(page, 'Vanish Loft')).toBeVisible();
  await expect(ownedSceneCard(page, 'Stays Loft')).toBeVisible();

  await openOwnedScene(page, 'Vanish Loft');
  await page.getByRole('button', { name: 'Delete scene' }).click();
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: /Delete/ })
    .click();

  // The wall it lands on is drawn from the brand the delete answered with.
  await expect(page).toHaveURL(new RegExp(`/${brand.slug}/scenes$`));
  await expect(ownedSceneCard(page, 'Vanish Loft')).toHaveCount(0);
  await expect(ownedSceneCard(page, 'Stays Loft')).toBeVisible();

  // and the record really is gone, not merely hidden
  expect(await sceneNames(page.request, brand.id)).not.toContain('Vanish Loft');

  // the caret menu reads the same row
  await goCreate(page);
  await askSceneMenu(page, 'Vanish');
  await expect(menuRow(page, 'Vanish Loft')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await askSceneMenu(page, 'Stays');
  await expect(menuRow(page, 'Stays Loft')).toBeVisible();

  await expectSameSession(page);
});

test('deleting the last scene of your own leaves the wall without that section', async ({ page }) => {
  const brand = await currentBrand(page);
  // this file's server is shared by its tests: start from none of our own
  for (const name of await sceneNames(page.request, brand.id)) {
    const id = ((await (await page.request.get('/api/brands')).json()) as any[])
      .find((b) => b.id === brand.id)
      .json.scenes.find((s: { name: string }) => s.name === name).id;
    await page.request.delete(`/api/brands/${brand.id}/scenes/${id}`);
  }
  await seedScene(page.request, brand.id, 'Only Loft');

  await page.goto(`/${brand.slug}/scenes`);
  await markSession(page);
  await expect(page.getByRole('heading', { name: 'Your scenes' })).toBeVisible();

  await openOwnedScene(page, 'Only Loft');
  await page.getByRole('button', { name: 'Delete scene' }).click();
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: /Delete/ })
    .click();

  await expect(page).toHaveURL(new RegExp(`/${brand.slug}/scenes$`));
  await expect(page.getByRole('heading', { name: 'Your scenes' })).toHaveCount(0);
  await expect(ownedSceneCard(page, 'Only Loft')).toHaveCount(0);
  // the catalog is still there under it, not a blank page
  await expect(page.locator('.sc-lookcard').first()).toBeVisible();
  await expectSameSession(page);
});

test('Back after deleting a scene does not land on the page of a scene that is gone', async ({ page }) => {
  const brand = await currentBrand(page);
  await seedScene(page.request, brand.id, 'Backstep Loft');

  await page.goto(`/${brand.slug}/scenes`);
  await markSession(page);
  await openOwnedScene(page, 'Backstep Loft');
  const deadPath = new URL(page.url()).pathname;
  await page.getByRole('button', { name: 'Delete scene' }).click();
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: /Delete/ })
    .click();
  await expect(page).toHaveURL(new RegExp(`/${brand.slug}/scenes$`));

  await page.goBack();
  await expect(page).not.toHaveURL(new RegExp(`${deadPath}$`));
  await expect(page.getByText("This scene isn't here anymore")).toHaveCount(0);
  await expectSameSession(page);
});

/** Confirm the delete on an open scene page. */
async function deleteOpenScene(page: import('@playwright/test').Page): Promise<void> {
  await page.getByRole('button', { name: 'Delete scene' }).click();
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: /Delete/ })
    .click();
}

test('the first scene you build appears on the wall as it lands, and can be deleted at once', async ({ page }) => {
  test.setTimeout(90_000);
  const brand = await currentBrand(page);
  for (const name of await sceneNames(page.request, brand.id)) {
    const scenes = ((await (await page.request.get('/api/brands')).json()) as any[]).find((b) => b.id === brand.id).json
      .scenes as { id: string; name: string }[];
    const id = scenes.find((s) => s.name === name)?.id;
    if (id) await page.request.delete(`/api/brands/${brand.id}/scenes/${id}`);
  }

  await page.goto(`/${brand.slug}/scenes`);
  await markSession(page);
  await expect(page.getByRole('heading', { name: 'Your scenes' })).toHaveCount(0);

  // built the way a person builds one: the studio, a sentence, one draw
  await buildScene(page, 'A bright loft with pale concrete and one tall window.', 'First Light Loft');

  // the section and the card arrive with the build, not with a reload
  await goScenes(page);
  await expect(ownedSceneCard(page, 'First Light Loft')).toBeVisible({ timeout: 45_000 });
  await expect(page.getByRole('heading', { name: 'Your scenes' })).toBeVisible();

  // and it can be opened and deleted straight away
  await openOwnedScene(page, 'First Light Loft');
  await deleteOpenScene(page);
  await expect(page).toHaveURL(new RegExp(`/${brand.slug}/scenes$`));
  await expect(ownedSceneCard(page, 'First Light Loft')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Your scenes' })).toHaveCount(0);
  await expectSameSession(page);
});

test('a rename reaches the wall and the scene menu without a reload', async ({ page }) => {
  const brand = await currentBrand(page);
  await seedScene(page.request, brand.id, 'Rename Me Loft');

  await page.goto(`/${brand.slug}/scenes`);
  await markSession(page);
  await openOwnedScene(page, 'Rename Me Loft');
  const saved = page.waitForResponse((r) => r.request().method() === 'PATCH' && r.url().includes('/scenes/'));
  await renameScene(page, 'Renamed Loft');
  await saved;

  await page.locator('.sc-lookpage-crumb').getByRole('link', { name: 'Scenes' }).click();
  await expect(ownedSceneCard(page, 'Renamed Loft')).toBeVisible();
  await expect(ownedSceneCard(page, 'Rename Me Loft')).toHaveCount(0);

  await goCreate(page);
  await askSceneMenu(page, 'Renamed');
  await expect(menuRow(page, 'Renamed Loft')).toBeVisible();
  await page.keyboard.press('Escape');
  await askSceneMenu(page, 'Rename Me');
  await expect(menuRow(page, 'Rename Me Loft')).toHaveCount(0);
  await expectSameSession(page);
});

// The sheet writes the name and the filing in one answer; the page has no
// live fields to debounce any more, because a scene's words are the studio's.
test('the name and the filing are saved in one write', async ({ page }) => {
  const brand = await currentBrand(page);
  await seedScene(page.request, brand.id, 'Two Fields Loft');

  await page.goto(`/${brand.slug}/scenes`);
  await markSession(page);
  await openOwnedScene(page, 'Two Fields Loft');
  const saved = page.waitForResponse((r) => r.request().method() === 'PATCH' && r.url().includes('/scenes/'));
  await page.getByRole('button', { name: 'Edit name, filing and ways' }).click();
  const sheet = page.getByRole('dialog');
  await sheet.getByLabel('Name').fill('Both Fields Loft');
  await sheet.getByRole('button', { name: 'Categories' }).click();
  await page.getByRole('menuitem', { name: 'Apparel' }).click();
  await page.keyboard.press('Escape');
  await sheet.getByRole('button', { name: 'Save' }).click();
  await saved;

  const scene = (
    ((await (await page.request.get('/api/brands')).json()) as any[]).find((b) => b.id === brand.id).json.scenes as {
      name: string;
      verticals?: string[];
    }[]
  ).find((s) => s.name === 'Both Fields Loft');
  expect(scene?.verticals).toContain('Apparel');
  await expectSameSession(page);
});

test('a read that lands elsewhere updates the open page', async ({ page }) => {
  test.setTimeout(60_000);
  const brand = await currentBrand(page);
  const ref = await uploadPng(page.request, 1);
  const rereadId = await seedScene(page.request, brand.id, 'Reread Loft', {
    refHashes: [ref],
    instruction: 'A cold slate studio with one north window.',
    description: 'Before the read',
  });

  await page.goto(`/${brand.slug}/scenes`);
  await markSession(page);
  await openOwnedScene(page, 'Reread Loft');
  await expect(page.getByText('Before the read')).toBeVisible();

  // The button that starts this moved into the studio with the rest of the
  // words: a scene's prose is changed by reading the place again, and this
  // page never draws. What is still this page's to keep is the half below,
  // that a read landing anywhere reaches the open page with no reload.
  await page.request.post(`/api/brands/${brand.id}/scenes/${rereadId}/reread`);

  // The read lands through the bell and the page takes the record it wrote.
  // Asserted by what it leaves: the reader writes the description, so what is
  // certain is that the old one goes, not which words replace it.
  await expect(page.getByText('Before the read')).toHaveCount(0, { timeout: 30_000 });
  await expectSameSession(page);
});

test('a scene in the brief that is then deleted leaves the brief with a note, not a broken chip', async ({ page }) => {
  const brand = await currentBrand(page);
  const id = await seedScene(page.request, brand.id, 'Chip Loft');

  await page.goto(`/${brand.slug}/scenes`);
  await markSession(page);
  await ownedSceneCard(page, 'Chip Loft').hover();
  await ownedSceneCard(page, 'Chip Loft').getByRole('button', { name: 'Use in a shot' }).click();
  await expect(page).toHaveURL(/\/create/);
  const chip = page.locator(`.sc-brief [data-tok="t:${id}"]`);
  await expect(chip).toHaveCount(1);
  // A bare scene is not a brief worth keeping (draft.ts); words make it one,
  // so it is still here when the person comes back.
  await page.locator('.sc-brief-line').click();
  await page.keyboard.press('End');
  await page.keyboard.type(' a green bottle on the sill');
  await expect
    .poll(() => page.evaluate(() => Object.keys(localStorage).some((k) => k.startsWith('scenri:draft-'))))
    .toBe(true);

  await goScenes(page);
  await openOwnedScene(page, 'Chip Loft');
  await deleteOpenScene(page);
  await expect(page).toHaveURL(new RegExp(`/${brand.slug}/scenes$`));

  await goCreate(page);
  const note = page.locator('.sc-toast', { hasText: 'That scene is no longer available' });
  await expect(note).toBeVisible();
  await expect(note).toContainText('Removed from the brief.');
  await expect(chip).toHaveCount(0);
  await expect(page.locator('.sc-brief [data-missing]')).toHaveCount(0);
  // the rest of the brief is untouched
  await expect(page.locator('.sc-brief-line')).toContainText('a green bottle on the sill');
  await expectSameSession(page);
});

test('a double press on delete sends one delete and shows no error', async ({ page }) => {
  const brand = await currentBrand(page);
  await seedScene(page.request, brand.id, 'Twice Loft');
  const deletes: string[] = [];
  page.on('request', (r) => {
    if (r.method() === 'DELETE' && r.url().includes('/scenes/')) deletes.push(r.url());
  });

  await page.goto(`/${brand.slug}/scenes`);
  await markSession(page);
  await openOwnedScene(page, 'Twice Loft');
  await page.getByRole('button', { name: 'Delete scene' }).click();
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: /Delete/ })
    .dblclick();

  await expect(page).toHaveURL(new RegExp(`/${brand.slug}/scenes$`));
  await expect(ownedSceneCard(page, 'Twice Loft')).toHaveCount(0);
  await page.waitForTimeout(500);
  expect(deletes).toHaveLength(1);
  await expect(page.locator('.sc-assetform-err')).toHaveCount(0);
  await expectSameSession(page);
});

test('a delete the server refuses keeps the scene and says why', async ({ page }) => {
  const brand = await currentBrand(page);
  await seedScene(page.request, brand.id, 'Refused Loft');
  await page.route(/\/scenes\/us-[a-z0-9]+$/, (route) =>
    route.request().method() === 'DELETE'
      ? route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'disk is full' }) })
      : route.fallback(),
  );

  await page.goto(`/${brand.slug}/scenes`);
  await markSession(page);
  await openOwnedScene(page, 'Refused Loft');
  await deleteOpenScene(page);

  await expect(page.locator('.sc-assetform-err')).toHaveText('disk is full');
  await expect(page).toHaveURL(/\/scenes\/us-/);
  await expect(page.getByRole('button', { name: 'Delete scene' })).toBeEnabled();
  await page.locator('.sc-lookpage-crumb').getByRole('link', { name: 'Scenes' }).click();
  await expect(ownedSceneCard(page, 'Refused Loft')).toBeVisible();
  expect(await sceneNames(page.request, brand.id)).toContain('Refused Loft');
  await expectSameSession(page);
});

test('leaving while a delete is still out is not undone when it answers', async ({ page }) => {
  const brand = await currentBrand(page);
  await seedScene(page.request, brand.id, 'Leaving Loft');

  await page.goto(`/${brand.slug}/scenes`);
  await markSession(page);
  await openOwnedScene(page, 'Leaving Loft');
  const held = await holdNext(page, /\/scenes\/us-[a-z0-9]+$/, 'DELETE');
  await deleteOpenScene(page);
  await held.caught;

  await goCreate(page);
  held.release();
  await expect.poll(() => sceneNames(page.request, brand.id)).not.toContain('Leaving Loft');
  await page.waitForTimeout(500);
  // still where the person went, not pulled back to the wall
  await expect(page).toHaveURL(/\/create/);
  // and the answer still reached every surface
  await askSceneMenu(page, 'Leaving');
  await expect(menuRow(page, 'Leaving Loft')).toHaveCount(0);
  await expectSameSession(page);
});

test('a brand switch while a delete is out stays on the other brand, and only the first brand changes', async ({
  page,
}) => {
  const brand = await currentBrand(page);
  const other = (
    await (
      await page.request.post('/api/brands', { data: { brand: { specVersion: '0.1', meta: { name: 'Other Brand' } } } })
    ).json()
  ).id as string;
  await seedScene(page.request, brand.id, 'Switch Loft');
  await seedScene(page.request, other, 'Elsewhere Loft');

  await page.goto(`/${brand.slug}/scenes`);
  await markSession(page);
  await openOwnedScene(page, 'Switch Loft');
  const held = await holdNext(page, /\/scenes\/us-[a-z0-9]+$/, 'DELETE');
  await deleteOpenScene(page);
  await held.caught;

  await switchBrand(page, 'Other Brand');
  await expect(page).toHaveURL(/\/other-brand(\/|$)/);
  held.release();
  await expect.poll(() => sceneNames(page.request, brand.id)).not.toContain('Switch Loft');
  await page.waitForTimeout(500);
  await expect(page).toHaveURL(/\/other-brand(\/|$)/);

  await goScenes(page);
  await expect(ownedSceneCard(page, 'Elsewhere Loft')).toBeVisible();
  await expect(ownedSceneCard(page, 'Switch Loft')).toHaveCount(0);
  expect(await sceneNames(page.request, other)).toEqual(['Elsewhere Loft']);

  // back on the first brand, the answer was applied to its row while away
  await switchBrand(page, 'E2E Fixture');
  await expect(page).toHaveURL(new RegExp(`/${brand.slug}(/|$)`));
  await goScenes(page);
  await expect(ownedSceneCard(page, 'Switch Loft')).toHaveCount(0);
  await expectSameSession(page);
});

// The resurrection: a list read that started before the delete lands after it.
test('a slow read of the brands that started before a delete cannot bring the scene back', async ({ page }) => {
  test.setTimeout(90_000);
  const brand = await currentBrand(page);
  await seedScene(page.request, brand.id, 'Doomed Loft');

  await page.goto(`/${brand.slug}/scenes`);
  await markSession(page);
  // a scene landing is what makes the bell read the brands again
  const held = await holdNext(page, /\/api\/brands$/);
  await buildScene(page, 'A long gallery with timber floors.', 'Arrival Loft');
  await held.caught;

  // the read is out, carrying Doomed Loft; delete it now
  await goScenes(page);
  await openOwnedScene(page, 'Doomed Loft');
  await deleteOpenScene(page);
  await expect(page).toHaveURL(new RegExp(`/${brand.slug}/scenes$`));
  await expect(ownedSceneCard(page, 'Doomed Loft')).toHaveCount(0);

  held.release();
  await page.waitForTimeout(1_000);
  await expect(ownedSceneCard(page, 'Doomed Loft')).toHaveCount(0);
  await expect(ownedSceneCard(page, 'Arrival Loft')).toBeVisible();
  await expectSameSession(page);
});

// Two mutation answers that crossed: the rename's lands after the delete's.
test('a rename answer that lands after the delete cannot bring the scene back', async ({ page }) => {
  const brand = await currentBrand(page);
  await seedScene(page.request, brand.id, 'Crossed Loft');

  await page.goto(`/${brand.slug}/scenes`);
  await markSession(page);
  await openOwnedScene(page, 'Crossed Loft');
  const held = await holdNext(page, /\/scenes\/us-[a-z0-9]+$/, 'PATCH');
  await renameScene(page, 'Crossed Again Loft');
  await held.caught;
  // the sheet is still open on a save that has not answered; it is closed so
  // the delete is pressed on the page under it, which a write still out does
  // not block
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await deleteOpenScene(page);
  await expect(page).toHaveURL(new RegExp(`/${brand.slug}/scenes$`));

  held.release();
  await page.waitForTimeout(1_000);
  await expect(ownedSceneCard(page, 'Crossed Again Loft')).toHaveCount(0);
  await expect(ownedSceneCard(page, 'Crossed Loft')).toHaveCount(0);
  expect(await sceneNames(page.request, brand.id)).not.toContain('Crossed Again Loft');
  await expectSameSession(page);
});

test('a rename and a delete reach the Home shelf too', async ({ page }) => {
  const brand = await currentBrand(page);
  await seedScene(page.request, brand.id, 'Shelf Loft');
  await page.goto(`/${brand.slug}`);
  await markSession(page);
  const shelf = (name: string) => page.locator('.sc-lookcard', { has: page.getByText(name, { exact: true }) });
  await expect(shelf('Shelf Loft')).toBeVisible();

  await goScenes(page);
  await openOwnedScene(page, 'Shelf Loft');
  const saved = page.waitForResponse((r) => r.request().method() === 'PATCH' && r.url().includes('/scenes/'));
  await renameScene(page, 'Shelf Loft Renamed');
  await saved;
  await mainNav(page).getByRole('link', { name: 'Home', exact: true }).click();
  await expect(shelf('Shelf Loft Renamed')).toBeVisible();
  await expect(shelf('Shelf Loft')).toHaveCount(0);

  await goScenes(page);
  await openOwnedScene(page, 'Shelf Loft Renamed');
  await deleteOpenScene(page);
  await expect(page).toHaveURL(new RegExp(`/${brand.slug}/scenes$`));
  await mainNav(page).getByRole('link', { name: 'Home', exact: true }).click();
  await expect(shelf('Shelf Loft Renamed')).toHaveCount(0);
  await expectSameSession(page);
});

test('Forward after Back stays off the dead page, and a reload afterwards still agrees', async ({ page }) => {
  const brand = await currentBrand(page);
  await seedScene(page.request, brand.id, 'Forward Loft');
  await page.goto(`/${brand.slug}/scenes`);
  await markSession(page);
  await openOwnedScene(page, 'Forward Loft');
  const dead = new URL(page.url()).pathname;
  await deleteOpenScene(page);
  await expect(page).toHaveURL(new RegExp(`/${brand.slug}/scenes$`));
  await page.goBack();
  await page.goForward();
  await expect(page).not.toHaveURL(new RegExp(`${dead}$`));
  await expect(ownedSceneCard(page, 'Forward Loft')).toHaveCount(0);
  await expectSameSession(page);

  // A reload is a test of what was stored, never the way the screen caught up:
  // everything above passed in one document first.
  await page.reload();
  await expect(page.locator('.sc-lookcard').first()).toBeVisible();
  await expect(ownedSceneCard(page, 'Forward Loft')).toHaveCount(0);
});

test('an edit the server refuses keeps what was typed and says why', async ({ page }) => {
  const brand = await currentBrand(page);
  await seedScene(page.request, brand.id, 'Refused Edit Loft');
  await page.route(/\/scenes\/us-[a-z0-9]+$/, (route) =>
    route.request().method() === 'PATCH'
      ? route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'disk is full' }) })
      : route.fallback(),
  );
  await page.goto(`/${brand.slug}/scenes`);
  await markSession(page);
  await openOwnedScene(page, 'Refused Edit Loft');
  await page.getByRole('button', { name: 'Edit name, filing and ways' }).click();
  const refused = page.getByRole('dialog');
  await refused.getByLabel('Name').fill('Never Saved Loft');
  await refused.getByRole('button', { name: 'Save' }).click();
  // the sheet stays open on what was typed, with the reason under it
  await expect(refused.locator('.sc-assetform-err')).toHaveText('disk is full');
  await expect(refused.getByLabel('Name')).toHaveValue('Never Saved Loft');
  expect(await sceneNames(page.request, brand.id)).toContain('Refused Edit Loft');
  await expectSameSession(page);
});

// A background read of the brands that fails used to replace the whole studio
// with an error screen.
test('a background read of the brands that fails leaves the studio on screen', async ({ page }) => {
  test.setTimeout(90_000);
  const brand = await currentBrand(page);
  await page.goto(`/${brand.slug}/scenes`);
  await markSession(page);
  await page.route(/\/api\/brands$/, (route) =>
    route.request().method() === 'GET'
      ? route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'busy' }) })
      : route.fallback(),
  );
  const failed = page.waitForResponse((r) => /\/api\/brands$/.test(r.url()) && r.status() === 500, { timeout: 60_000 });
  // a build landing is what makes the bell read the brands again
  await buildScene(page, 'A small studio with a single lamp.', 'Background Loft');
  await failed;
  await page.waitForTimeout(500);
  // the shell stays up: no error screen took the app over
  await expect(mainNav(page)).toBeVisible();
  await expect(page.getByText(/Couldn't load|went wrong/)).toHaveCount(0);
  await expectSameSession(page);
});
