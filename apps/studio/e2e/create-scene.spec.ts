import { test, expect, type Page } from '@playwright/test';
import { isolate } from './harness.js';

/**
 * One scene creation attempt owns one draft.
 *
 * The draft lifecycle was rebuilt once already, for presenters, after somebody
 * cast a presenter from the previous presenter's face: it used to sit in
 * localStorage for thirty days and was never spent on success. It is
 * sessionStorage now, keyed by brand and kind, and a landed build clears it.
 *
 * `create-presenter.spec.ts` proves all of that for presenters and
 * `create-product.spec.ts` for products. Nothing proved it for scenes, which is
 * the kind where a leak costs most: a scene's Direction and its references are
 * read as art direction, so last scene's words quietly refilling this one does
 * not just look untidy, it changes what gets built.
 *
 * So this file walks the scene flow on the same terms, and states the contract
 * in both directions — what must survive a dismissal, and what must not survive
 * a creation.
 *
 * With no analyzer behind the harness a scene built from photographs alone
 * fails by design, so every attempt here that is meant to succeed carries a
 * line of Direction too.
 */

// A Scenri of this file's own, on an empty home, seeded from scratch.
isolate();

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
const nameField = (p: Page) => p.getByLabel('Name', { exact: true });
const direction = (p: Page) => p.getByLabel('Direction', { exact: true });
const picker = (p: Page) => p.locator('.sc-newdlg input[type="file"]').first();
/**
 * Whether the brand document holds a scene by that name yet.
 *
 * The brand is the truth about what exists, and asking it by name is exact:
 * these tests share one server, so counting cards would make each of them
 * depend on how far the others had got.
 */
async function sceneLanded(p: Page, name: string): Promise<boolean> {
  const brands = await (await p.request.get('/api/brands')).json();
  return brands.some((b: { json?: { scenes?: { name?: string }[] } }) =>
    (b.json?.scenes ?? []).some((sc) => sc?.name === name),
  );
}

const open = async (p: Page, slug: string) => {
  await p.goto(`/${slug}/scenes?new=scene`);
  await expect(p.getByRole('heading', { name: 'New scene' })).toBeVisible();
};

/** The hash a thumbnail is showing, which is the identity the draft stores. */
/** The hash a reference thumb shows, from either shape of the store's URL: the original or a derivative. */
const refHash = async (p: Page, i: number): Promise<string> => {
  const src = await refs(p).nth(i).locator('img').getAttribute('src');
  return /\/api\/images\/([a-f0-9]{32})/.exec(src ?? '')?.[1] ?? '';
};

test.describe('a scene creation draft lives exactly as long as the attempt', () => {
  test('a dismissed attempt is gone when you come back', async ({ page }) => {
    const slug = await currentBrand(page);

    await open(page, slug);
    await picker(page).setInputFiles([file('yard.png', A), file('wall.png', B)]);
    await expect(refs(page)).toHaveCount(2);
    await nameField(page).fill('Dismissed Terrace');
    await direction(page).fill('A stone terrace in low evening sun.');

    // Categories come from the shipped catalog rather than the brand, so the
    // fieldset is there on a cold home too; guarded anyway, because a catalog
    // with no verticals is a legitimate shape and not this test's subject.
    const chip = page.locator('.sc-assetform-facets .sc-chip').first();
    const hasFacets = (await chip.count()) > 0;
    if (hasFacets) await chip.click();

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
    await expect(nameField(page)).toHaveValue('');
    await expect(direction(page)).toHaveValue('');
    if (hasFacets) await expect(chip).not.toHaveAttribute('aria-pressed', 'true');
  });

  /**
   * Ending the attempt on close is what makes a new scene feel new, and the
   * price of it is the accident: an Escape aimed at something else and four
   * uploaded photographs are gone. That is bought back after the fact rather
   * than with a confirm on every deliberate close.
   */
  test('an accidental dismissal can be undone, once', async ({ page }) => {
    const slug = await currentBrand(page);

    await open(page, slug);
    await picker(page).setInputFiles([file('yard.png', A), file('wall.png', B)]);
    await expect(refs(page)).toHaveCount(2);
    await nameField(page).fill('Undo Me');
    await direction(page).fill('A stone terrace in low evening sun.');
    await page.waitForTimeout(600);
    await page.keyboard.press('Escape');

    const toast = page.locator('.sc-toast', { hasText: 'Scene discarded' });
    await expect(toast).toBeVisible();
    await toast.getByRole('button', { name: 'Undo' }).click();

    // everything, photographs included: re-uploading is the thing this avoids
    await expect(page.getByRole('heading', { name: 'New scene' })).toBeVisible();
    await expect(refs(page)).toHaveCount(2);
    await expect(nameField(page)).toHaveValue('Undo Me');
    await expect(direction(page)).toHaveValue('A stone terrace in low evening sun.');

    // The offer was for that one closing. Leaving again and opening the flow
    // by hand starts from nothing, or this is the old bug wearing a button.
    await page.keyboard.press('Escape');
    await open(page, slug);
    await expect(refs(page)).toHaveCount(0);
    await expect(nameField(page)).toHaveValue('');
    await expect(direction(page)).toHaveValue('');
  });

  test('a scene that was actually created leaves nothing behind', async ({ page }) => {
    test.setTimeout(90_000);
    const slug = await currentBrand(page);

    await open(page, slug);
    await picker(page).setInputFiles([file('yard.png', A), file('wall.png', B)]);
    await expect(refs(page)).toHaveCount(2);
    await nameField(page).fill('Spent Scene');
    await direction(page).fill('A stone terrace in low evening sun.');
    await page.locator('.sc-dlg-go').click();
    await expect(dlg(page)).toHaveCount(0);

    // Success is the build landing, not the job queuing: the scene does not
    // exist until it is written, and that is the moment the draft is spent.
    await expect.poll(() => sceneLanded(page, 'Spent Scene'), { timeout: 45_000 }).toBe(true);

    await open(page, slug);
    await expect(refs(page)).toHaveCount(0);
    await expect(nameField(page)).toHaveValue('');
    await expect(direction(page)).toHaveValue('');
  });

  test('a submit that fails hands the work back', async ({ page }) => {
    const slug = await currentBrand(page);
    await page.route('**/asset-builds', (route) =>
      route.request().method() === 'POST'
        ? route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"engine fell over"}' })
        : route.continue(),
    );

    await open(page, slug);
    await picker(page).setInputFiles([file('yard.png', A)]);
    await expect(refs(page)).toHaveCount(1);
    await nameField(page).fill('Retry This Place');
    await direction(page).fill('A stone terrace in low evening sun.');
    await page.locator('.sc-dlg-go').click();

    // The dialog stays, says what went wrong, and keeps everything. This is the
    // case the draft was built for, and Direction is the expensive half to retype.
    await expect(dlg(page)).toBeVisible();
    await expect(page.locator('.sc-newdlg-err')).toBeVisible();
    await expect(refs(page)).toHaveCount(1);
    await expect(nameField(page)).toHaveValue('Retry This Place');
    await expect(direction(page)).toHaveValue('A stone terrace in low evening sun.');
  });

  test('a dismissal leaves nothing behind in another tab or another brand', async ({ page, context }) => {
    const slug = await currentBrand(page);

    // A second brand of this file's own, so the isolation is actually exercised
    // rather than skipped on a single-brand home.
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
    await nameField(page).fill('Abandoned');
    await direction(page).fill('A stone terrace in low evening sun.');
    await page.waitForTimeout(600);
    await page.keyboard.press('Escape');
    await expect(dlg(page)).toHaveCount(0);

    // not in the brand it was staged for
    await open(page, slug);
    await expect(refs(page)).toHaveCount(0);
    await page.keyboard.press('Escape');

    // not in another brand, which is keyed separately
    await open(page, otherSlug as string);
    await expect(refs(page)).toHaveCount(0);
    await expect(direction(page)).toHaveValue('');
    await page.keyboard.press('Escape');

    // and not in another tab, which has a session of its own
    const other = await context.newPage();
    await open(other, slug);
    await expect(other.locator('.sc-assetform-ref')).toHaveCount(0);
    await expect(other.getByLabel('Name', { exact: true })).toHaveValue('');
    await other.close();
  });

  test('a removed reference is gone from the form and from what gets sent', async ({ page }) => {
    const slug = await currentBrand(page);
    let sent: { imageHashes?: string[] } | null = null;
    await page.route('**/asset-builds', (route) => {
      if (route.request().method() === 'POST') sent = route.request().postDataJSON();
      return route.continue();
    });

    await open(page, slug);
    await picker(page).setInputFiles([file('yard.png', A), file('wall.png', B)]);
    await expect(refs(page)).toHaveCount(2);
    const dropped = await refHash(page, 0);
    const kept = await refHash(page, 1);

    await page.getByRole('button', { name: 'Remove reference 1' }).click();
    await expect(refs(page)).toHaveCount(1);

    await nameField(page).fill('One Reference Only');
    await direction(page).fill('A stone terrace in low evening sun.');
    await page.locator('.sc-dlg-go').click();
    await expect(dlg(page)).toHaveCount(0);

    // What the eye sees and what the build reads have to be the same set.
    expect(sent).not.toBeNull();
    expect(sent?.imageHashes).toEqual([kept]);
    expect(sent?.imageHashes).not.toContain(dropped);
  });

  test('removing a reference while another upload is still in flight sticks', async ({ page }) => {
    const slug = await currentBrand(page);

    await open(page, slug);
    await picker(page).setInputFiles([file('yard.png', A)]);
    await expect(refs(page)).toHaveCount(1);
    const dropped = await refHash(page, 0);

    // A slow upload, so the removal lands in the middle of one rather than
    // between two. Nothing in the dialog is disabled while an upload runs, so
    // this is a window a person can actually hit.
    await page.route('**/api/images', async (route) => {
      await new Promise((r) => setTimeout(r, 1500));
      await route.continue();
    });

    await picker(page).setInputFiles([file('wall.png', B)]);
    await page.getByRole('button', { name: 'Remove reference 1' }).click();
    await expect(refs(page)).toHaveCount(0);

    // The second upload arrives. It must add itself, not restore the set as it
    // stood when it started.
    await expect(refs(page)).toHaveCount(1, { timeout: 15_000 });
    expect(await refHash(page, 0)).not.toBe(dropped);
  });

  test('a scene the server has forgotten still counts as created', async ({ page }) => {
    test.setTimeout(90_000);
    const slug = await currentBrand(page);

    // The build registry is an in-memory Map, so a restart loses it while the
    // scene it already wrote stays on disk. Stubbing the listing to empty is
    // that same view from the client's side, with no restart and no race: the
    // app can never watch this build finish.
    await page.route('**/asset-builds', (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({ status: 200, contentType: 'application/json', body: '{"builds":[]}' })
        : route.continue(),
    );

    await open(page, slug);
    await picker(page).setInputFiles([file('yard.png', A), file('wall.png', B)]);
    await expect(refs(page)).toHaveCount(2);
    await nameField(page).fill('Forgotten Build');
    await direction(page).fill('A stone terrace in low evening sun.');
    await page.locator('.sc-dlg-go').click();
    await expect(dlg(page)).toHaveCount(0);

    // The scene is written even though the app can never watch it happen.
    await expect.poll(() => sceneLanded(page, 'Forgotten Build'), { timeout: 60_000 }).toBe(true);

    // The scene exists. The attempt that made it is over, whatever the build
    // listing can still remember about it.
    await open(page, slug);
    await expect(refs(page)).toHaveCount(0);
    await expect(nameField(page)).toHaveValue('');
    await expect(direction(page)).toHaveValue('');
  });
});
