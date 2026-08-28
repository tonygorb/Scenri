import { test, expect, type Page } from '@playwright/test';
import { isolate } from './harness.js';

/**
 * A created asset's own page stays alive.
 *
 * A tester found the app frozen after creating a presenter and opening their
 * page: the page painted, then nothing responded — not the logo, not the nav,
 * not Escape. The cause was an effect on the detail page keyed on an object
 * rebuilt every render, which re-ran and reset state on every commit: an
 * infinite, silent commit loop that starved every router transition. Custom
 * scene pages carried the identical effect.
 *
 * So this file walks the real path — create, build, bell, detail page — and
 * then insists the shell still works, and that React has actually gone quiet.
 * The harness pins the no-engine build fallback (SCENRI_NO_CODEX, blank keys),
 * so a build lands in seconds with the uploaded photos as the shots.
 */

// A Scenri of this file's own, on an empty home, seeded from scratch.
isolate();

/** One valid 1x1 PNG, enough for an upload the server will accept. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

/** The brand the app resolves "/" to, whatever this machine happens to hold. */
async function currentBrand(p: Page): Promise<string> {
  await p.goto('/');
  await p.waitForURL((u) => {
    const seg = u.pathname.split('/').filter(Boolean);
    return seg.length === 1 && seg[0] !== 'setup';
  });
  return decodeURIComponent(new URL(p.url()).pathname.split('/')[1]);
}

/**
 * Count React commits from inside the page, via the devtools hook React
 * checks for at startup. Installed before the app loads; read on demand.
 * A quiet page commits a handful of times a second at most (polling); the
 * frozen page committed thousands.
 */
async function installCommitCounter(p: Page): Promise<void> {
  await p.addInitScript(() => {
    const hook = {
      commits: 0,
      supportsFiber: true,
      inject: () => 1,
      onScheduleFiberRoot: () => {},
      onCommitFiberUnmount: () => {},
      onPostCommitFiberRoot: () => {},
      onCommitFiberRoot() {
        hook.commits++;
      },
      checkDCE: () => {},
      renderers: new Map(),
    };
    Object.defineProperty(window, '__REACT_DEVTOOLS_GLOBAL_HOOK__', { value: hook });
  });
}

/** Commits over roughly a second, once the page has had a moment to settle. */
async function commitRate(p: Page): Promise<number> {
  await p.waitForTimeout(500);
  const before = await p.evaluate(() => (window as any).__REACT_DEVTOOLS_GLOBAL_HOOK__.commits);
  await p.waitForTimeout(1000);
  const after = await p.evaluate(() => (window as any).__REACT_DEVTOOLS_GLOBAL_HOOK__.commits);
  return after - before;
}

/** The interaction locks the shell must not hold once a dialog is gone. */
async function expectShellUnlocked(p: Page): Promise<void> {
  await expect(p.locator('.sc-newdlg')).toHaveCount(0);
  const state = await p.evaluate(() => ({
    pointerEvents: document.body.style.pointerEvents,
    scrollLocked: document.body.getAttribute('data-scroll-locked'),
    rootHidden: document.getElementById('root')?.getAttribute('aria-hidden') ?? null,
  }));
  expect(state.pointerEvents).not.toBe('none');
  expect(state.scrollLocked).toBeNull();
  expect(state.rootHidden).toBeNull();
}

test.describe('a created presenter, from submit to a living page', () => {
  let slug: string;

  test.beforeEach(async ({ page }) => {
    await installCommitCounter(page);
    slug = await currentBrand(page);
  });

  test('create, wait for the build, open their page from the bell, and everything still works', async ({ page }) => {
    test.setTimeout(90_000);

    // Create through the real flow: chooser, form, photo, submit.
    await page.goto(`/${slug}/presenters`);
    await page.getByRole('button', { name: 'Add to this brand', exact: true }).click();
    await page.locator('[data-kind="presenter"]').click();
    await expect(page.getByRole('heading', { name: 'New presenter' })).toBeVisible();
    await page.locator('.sc-newdlg input[type="file"]').setInputFiles({
      name: 'ofira.png',
      mimeType: 'image/png',
      buffer: PNG,
    });
    await page.getByLabel('Name', { exact: true }).fill('Ofira');
    await page.locator('.sc-dlg-go').click();

    // The dialog leaves cleanly and takes its locks with it.
    await expectShellUnlocked(page);
    await expect(page).toHaveURL(new RegExp(`/${slug}/presenters$`));

    // The build lands (no engine: the photo becomes the shots) and the
    // library refetch shows the new presenter as the brand's own.
    await expect(page.getByRole('heading', { name: 'Your presenters' })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('link', { name: 'Ofira', exact: true })).toBeVisible();

    // Even with no engine, the presenter ships with a real derived avatar and
    // card crop — this path used to run studio-frame geometry over the raw
    // upload and could produce no avatar at all.
    const person = await page.evaluate(async () => {
      const brands = await (await fetch('/api/brands')).json();
      return (brands[0].json.characters ?? []).find((c: any) => c.name === 'Ofira');
    });
    expect(person.avatar).toMatch(/^asset:[a-f0-9]{32}$/);
    expect(person.preview).toMatch(/^asset:[a-f0-9]{32}$/);

    // The tester's route: the bell's task row is how you reach the new page.
    await page.getByRole('button', { name: /Notifications/ }).click();
    await page.getByRole('dialog').getByRole('link', { name: /Ofira/ }).first().click();
    await expect(page).toHaveURL(new RegExp(`/${slug}/presenters/[^/]+$`));
    await expect(page.locator('input[aria-label="Their name"]')).toHaveValue('Ofira');

    // The freeze regression: React goes quiet on this page. The bug committed
    // thousands of times a second here while the page looked perfectly normal.
    expect(await commitRate(page)).toBeLessThan(50);

    // The shell is alive: the logo leaves, Back returns.
    await page.getByRole('link', { name: 'Scenri home' }).click();
    await expect(page).toHaveURL(new RegExp(`/${slug}$`));
    await page.goBack();
    await expect(page.locator('input[aria-label="Their name"]')).toHaveValue('Ofira');

    // The main nav works from here.
    await page.getByRole('link', { name: 'Products', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/${slug}/products$`));
    await page.goBack();

    // Another dialog can open on top of this page, and close again. This was
    // the observed desync: ?new=1 landed in the URL with no dialog behind it.
    await page.getByRole('button', { name: 'Add to this brand', exact: true }).click();
    await expect(page).toHaveURL(/\?new=1$/);
    await expect(page.locator('.sc-newdlg')).toBeVisible();
    await page.keyboard.press('Escape');
    await expectShellUnlocked(page);
    await expect(page).toHaveURL(new RegExp(`/${slug}/presenters/[^/?]+$`));
  });

  test('a created scene page is just as alive', async ({ page }) => {
    test.setTimeout(90_000);

    // Scenes carried the identical effect loop, so the same walk guards them.
    await page.goto(`/${slug}/scenes?new=scene`);
    await expect(page.getByRole('heading', { name: 'New scene' })).toBeVisible();
    await page.locator('.sc-newdlg input[type="file"]').setInputFiles({
      name: 'terrace.png',
      mimeType: 'image/png',
      buffer: PNG,
    });
    await page.getByLabel('Name', { exact: true }).fill('Low Terrace');
    // With no analyzer behind the harness, a scene built from photos alone
    // fails by design; a sentence of the user's own words is the other path.
    await page.getByLabel('Direction', { exact: true }).fill('A stone terrace in low evening sun.');
    await page.locator('.sc-dlg-go').click();
    await expectShellUnlocked(page);

    // The build lands and the library shows the brand's own scene. A scene
    // card is labeled by its description, not its name, so the owned section
    // is the anchor; the keyboard opens it past the hover overlay.
    await expect(page.getByRole('heading', { name: 'Your scenes' })).toBeVisible({ timeout: 30_000 });
    const ownCard = page.locator('.sc-owned .sc-lookcard-open').first();
    await expect(ownCard).toBeVisible({ timeout: 15_000 });
    await ownCard.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`/${slug}/scenes/[^/]+$`));

    // Quiet, and alive.
    expect(await commitRate(page)).toBeLessThan(50);
    await page.getByRole('link', { name: 'Scenri home' }).click();
    await expect(page).toHaveURL(new RegExp(`/${slug}$`));
  });
});

/**
 * One creation attempt owns one draft.
 *
 * The draft exists so the dialog can close without asking, and so Try again
 * after a failed build does not ask for the photographs a second time. It used
 * to live in localStorage for thirty days and was never spent on success, so a
 * finished presenter's photographs, name and categories came back in the next
 * "New presenter" — which is how somebody casts a presenter from the previous
 * presenter's face. It is session-scoped now, and a landed build clears it.
 */
test.describe('the create draft lives exactly as long as the attempt', () => {
  const open = (p: Page, slug: string) => p.goto(`/${slug}/presenters?new=presenter`);
  const refs = (p: Page) => p.locator('.sc-assetform-ref');
  const name = (p: Page) => p.getByLabel('Name', { exact: true });

  const upload = async (p: Page, files: string[]) => {
    await p
      .locator('.sc-newdlg input[type="file"]')
      .setInputFiles(files.map((n) => ({ name: n, mimeType: 'image/png', buffer: PNG })));
    // content-addressed, so identical bytes dedupe to one thumbnail
    await expect(refs(p)).toHaveCount(1);
  };

  test('a presenter that was actually created leaves nothing behind', async ({ page }) => {
    test.setTimeout(90_000);
    const slug = await currentBrand(page);

    await open(page, slug);
    await upload(page, ['a.png']);
    await name(page).fill('Spent Draft');
    await page.locator('.sc-dlg-go').click();

    // success is the build landing, not the job queuing: the presenter does
    // not exist until it is written, and that is when the draft is spent
    await expect(page.getByRole('link', { name: 'Spent Draft', exact: true })).toBeVisible({ timeout: 30_000 });

    await open(page, slug);
    await expect(refs(page)).toHaveCount(0);
    await expect(name(page)).toHaveValue('');
  });

  test('dismissing keeps it in this tab, and only this tab', async ({ page, context }) => {
    const slug = await currentBrand(page);

    await open(page, slug);
    await upload(page, ['d.png']);
    await name(page).fill('Dismissed');
    // past the 400ms debounce, so the write has actually happened
    await page.waitForTimeout(600);
    await page.keyboard.press('Escape');
    await expect(page.locator('.sc-newdlg')).toHaveCount(0);
    // there is no confirm, and adding one is not the answer here
    await expect(page.locator('[role="alertdialog"]')).toHaveCount(0);

    // same tab: your work is where you left it
    await open(page, slug);
    await expect(refs(page)).toHaveCount(1);
    await expect(name(page)).toHaveValue('Dismissed');
    await page.keyboard.press('Escape');

    // another tab of the same browser shares localStorage but not the session,
    // so nothing of this attempt reaches it
    const other = await context.newPage();
    await open(other, slug);
    await expect(other.locator('.sc-newdlg')).toBeVisible();
    await expect(other.locator('.sc-assetform-ref')).toHaveCount(0);
    await expect(other.getByLabel('Name', { exact: true })).toHaveValue('');
    await other.close();
  });

  test('a submit that fails hands the work back', async ({ page }) => {
    const slug = await currentBrand(page);
    await page.route('**/asset-builds', (route) =>
      route.request().method() === 'POST'
        ? route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"engine fell over"}' })
        : route.continue(),
    );

    await open(page, slug);
    await upload(page, ['e.png']);
    await name(page).fill('Retry Me');
    await page.locator('.sc-dlg-go').click();

    // the dialog stays, says what went wrong, and keeps everything: this is
    // the case the draft was built for
    await expect(page.locator('.sc-newdlg')).toBeVisible();
    await expect(refs(page)).toHaveCount(1);
    await expect(name(page)).toHaveValue('Retry Me');
  });

  test('what you upload for one brand never appears in another', async ({ page }) => {
    const slug = await currentBrand(page);
    const other = await page.evaluate(async () => {
      const brands = await (await fetch('/api/brands')).json();
      return brands.length > 1 ? brands[1].slug : null;
    });
    test.skip(!other, 'this home holds a single brand');

    await open(page, slug);
    await upload(page, ['a.png']);
    await page.waitForTimeout(600);
    await page.keyboard.press('Escape');

    await open(page, other as string);
    await expect(refs(page)).toHaveCount(0);
  });
});
