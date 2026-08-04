import { test, expect, type Page } from '@playwright/test';

/**
 * The URL is the app's state. Everything here is a thing that was silently
 * broken before the router existed: a refresh always landed on Home, the brand
 * quietly reset to whichever came back first, and Back did nothing at all.
 *
 * Like composer.spec.ts, this runs against a real scenri server, because the
 * behaviour under test is the browser's own: history entries, a cold load of a
 * deep path, and what the address bar says after a click.
 */

const api = async (p: Page, path: string, init?: RequestInit) =>
  p.evaluate(
    async ([u, i]) => {
      const r = await fetch(u as string, i as RequestInit);
      return r.json();
    },
    [path, init ?? undefined],
  );

/**
 * The brand the app resolves "/" to, whatever this machine happens to hold.
 * Both spellings: the path carries the slug, the API still speaks in ids.
 */
async function currentBrand(p: Page): Promise<{ id: string; slug: string }> {
  await p.goto('/');
  await p.waitForURL(/\/b\/[^/]+$/);
  const slug = decodeURIComponent(new URL(p.url()).pathname.split('/')[2]);
  const brands = (await api(p, '/api/brands')) as any[];
  return { id: brands.find((b) => b.slug === slug).id, slug };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A project holding a finished multi-image shot, on the free Demo engine.
 *
 * Several cases here are about the variant the URL names, so one image is not
 * enough — seed.setup.ts asks for a single one, which is right for the composer
 * spec and useless to this one.
 */
async function seedShot(p: Page, brand: string) {
  const projects = (await api(p, `/api/projects?brandId=${brand}`)) as any[];
  const project =
    projects[0] ?? (await api(p, '/api/projects', postJson({ brandId: brand, name: 'Routing spec' }))).project;

  const tree = (await api(p, `/api/projects/${project.id}/tree`)) as any;
  const done = (tree.nodes ?? []).find((n: any) => n.kind !== 'root' && n.status === 'done' && n.images.length > 1);
  if (done) return { projectId: project.id, slug: project.slug, nodeId: done.id, images: done.images.length };

  const root = (tree.nodes ?? []).find((n: any) => n.kind === 'root');
  const made = (await api(
    p,
    '/api/nodes',
    postJson({
      projectId: project.id,
      parentId: root?.id ?? null,
      kind: 'generation',
      prompt: 'routing spec shot',
      engineId: 'demo',
      count: 3,
    }),
  )) as any;

  for (let i = 0; i < 40; i++) {
    const t = (await api(p, `/api/projects/${project.id}/tree`)) as any;
    const n = (t.nodes ?? []).find((x: any) => x.id === made.id);
    if (n?.status === 'done')
      return { projectId: project.id, slug: project.slug, nodeId: n.id, images: n.images.length };
    await p.waitForTimeout(300);
  }
  throw new Error('demo generation never finished');
}

const postJson = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

const activeNav = (p: Page) => p.locator('.sc-nav button[data-active="true"]');

test('every screen cold-loads from its own URL', async ({ page }) => {
  const brand = await currentBrand(page);
  const { slug, nodeId } = await seedShot(page, brand.id);

  await page.goto(`/b/${brand.slug}`);
  await expect(activeNav(page)).toHaveText('Home');

  await page.goto(`/b/${brand.slug}/brand`);
  await expect(activeNav(page)).toHaveText('Brand');

  await page.goto(`/b/${brand.slug}/looks`);
  await expect(activeNav(page)).toHaveText('Looks');
  await expect(page.locator('.sc-lookcard').first()).toBeVisible();

  // the card's own centre is covered by the hover "Use this look" action, which
  // is a different destination: click the collection's name list instead
  const name = page.locator('.sc-coll-names button').first();
  const looked = (await name.innerText()).trim();
  await name.click();
  await page.waitForURL(/\/looks\/[^/]+$/);
  await expect(page.locator('.sc-lookpage h1')).toHaveText(looked);

  await page.goto(`/b/${brand.slug}/p/${slug}`);
  await expect(page.locator('.sc-canvas')).toBeVisible();
  await expect(page.locator('.sc-ovl')).toHaveCount(0);

  await page.goto(`/b/${brand.slug}/p/${slug}/n/${nodeId}`);
  await expect(page.locator('.sc-ovl')).toBeVisible();
});

test('a reloaded shot comes back to the same shot and the same variant', async ({ page }) => {
  const brand = await currentBrand(page);
  const { slug, nodeId, images } = await seedShot(page, brand.id);
  test.skip(images < 2, 'needs a multi-image generation to have a variant to hold');

  await page.goto(`/b/${brand.slug}/p/${slug}/n/${nodeId}?i=${images - 1}`);
  await expect(page.locator('.sc-ovl')).toBeVisible();
  const before = await page.locator('.sc-ovl').innerText();
  expect(before).toContain(`${images} of ${images} variants`);

  await page.reload();
  await expect(page.locator('.sc-ovl')).toBeVisible();
  expect(await page.locator('.sc-ovl').innerText()).toContain(`${images} of ${images} variants`);
});

test('back and forward walk the trail, and escape is one step', async ({ page }) => {
  const brand = await currentBrand(page);
  const { slug, nodeId } = await seedShot(page, brand.id);

  await page.goto(`/b/${brand.slug}/p/${slug}`);
  await page.goto(`/b/${brand.slug}/p/${slug}/n/${nodeId}`);
  await expect(page.locator('.sc-ovl')).toBeVisible();

  await page.keyboard.press('Escape');
  await page.waitForURL((u) => !u.pathname.includes('/n/'));
  await expect(page.locator('.sc-ovl')).toHaveCount(0);

  await page.goBack();
  await expect(page.locator('.sc-ovl')).toBeVisible();

  await page.goForward();
  await expect(page.locator('.sc-ovl')).toHaveCount(0);
});

test('filters live in the URL and survive a reload', async ({ page }) => {
  const brand = await currentBrand(page);

  await page.goto(`/b/${brand.slug}/looks`);
  const vertical = page.locator('.sc-verticals button').nth(1);
  const label = (await vertical.innerText()).split('\n')[0].trim();
  await vertical.click();
  await page.waitForURL(/[?&]vertical=/);

  await page.reload();
  await expect(page.locator('.sc-verticals button[data-on]')).toHaveText(new RegExp(label));

  // a filter is not a destination: Back leaves the screen, it does not undo it
  await page.goto(`/b/${brand.slug}`);
  await expect(activeNav(page)).toHaveText('Home');
});

test('settings is a URL, and Back closes it', async ({ page }) => {
  const brand = await currentBrand(page);

  await page.goto(`/b/${brand.slug}?settings=budget`);
  await expect(page.locator('.sc-set')).toBeVisible();
  await expect(page.locator('.sc-set-head b')).toHaveText('Budget');

  await page.goBack();
  await expect(page.locator('.sc-set')).toHaveCount(0);
});

test('switching project does not carry the last one text layers', async ({ page }) => {
  const brand = await currentBrand(page);
  const { slug, nodeId } = await seedShot(page, brand.id);
  const second = (await api(page, '/api/projects', postJson({ brandId: brand.id, name: 'Routing spec B' }))) as any;

  await page.goto(`/b/${brand.slug}/p/${slug}/n/${nodeId}`);
  await page
    .locator('.sc-ovl')
    .getByRole('button', { name: /^Add text$/ })
    .first()
    .click();
  await expect(page.locator('.sc-lrow')).not.toHaveCount(0);

  // React Router keeps a component mounted across a param change, so the
  // project route is keyed; without that key these drafts follow you over
  await page.goto(`/b/${brand.slug}/p/${second.project.slug}`);
  await expect(page.locator('.sc-ovl')).toHaveCount(0);
  await expect(page.locator('.sc-lrow')).toHaveCount(0);
});

test('the address bar spells names, not uuids', async ({ page }) => {
  const brand = await currentBrand(page);
  const { projectId, slug, nodeId } = await seedShot(page, brand.id);

  // "/" resolves to a brand, and says which one in words
  expect(brand.slug).not.toMatch(UUID);
  expect(slug).not.toMatch(UUID);

  // an id still resolves, and rewrites itself to the readable spelling
  await page.goto(`/b/${brand.id}/looks`);
  await page.waitForURL(`**/b/${brand.slug}/looks`);
  await expect(activeNav(page)).toHaveText('Looks');

  // including deeper in the path, where the rest of it has to survive
  await page.goto(`/b/${brand.id}/p/${projectId}/n/${nodeId}`);
  await page.waitForURL(`**/b/${brand.slug}/p/${slug}/n/${nodeId}`);
  await expect(page.locator('.sc-ovl')).toBeVisible();
});

test('an unknown brand or path lands somewhere real', async ({ page }) => {
  const brand = await currentBrand(page);

  await page.goto('/b/does-not-exist/looks');
  await page.waitForURL(`**/b/${brand.slug}`);

  await page.goto('/total/nonsense/path');
  await page.waitForURL(`**/b/${brand.slug}`);
});

test('a shot URL whose node is gone falls back to the canvas', async ({ page }) => {
  const brand = await currentBrand(page);
  const { slug } = await seedShot(page, brand.id);

  await page.goto(`/b/${brand.slug}/p/${slug}/n/no-such-node`);
  await page.waitForURL(`**/p/${slug}`);
  await expect(page.locator('.sc-canvas')).toBeVisible();
});
