import { expect, type APIRequestContext, type Page } from '@playwright/test';

/**
 * Shared by the realtime specs: a mutation reaches every surface in the same
 * commit, with no reload anywhere between the change and the check.
 *
 * "No reload" is asserted, not promised. `markSession` stamps the document the
 * test starts in and `expectSameSession` reads the stamp back at the end: a
 * reload, a `goto` or a hard navigation in between gives a fresh `window` with
 * no stamp, and the test fails for that reason instead of passing on data the
 * new document fetched for itself.
 */
export async function markSession(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as unknown as { __session?: string }).__session = 'live';
  });
}

export async function expectSameSession(page: Page): Promise<void> {
  expect(await page.evaluate(() => (window as unknown as { __session?: string }).__session)).toBe('live');
}

export interface BrandRef {
  slug: string;
  id: string;
}

/** The brand the app resolves "/" to, by slug and id. */
export async function currentBrand(page: Page): Promise<BrandRef> {
  await page.goto('/');
  await page.waitForURL((u) => {
    const seg = u.pathname.split('/').filter(Boolean);
    return seg.length === 1 && seg[0] !== 'setup';
  });
  const slug = decodeURIComponent(new URL(page.url()).pathname.split('/')[1]);
  const brands = (await (await page.request.get('/api/brands')).json()) as BrandRef[];
  return { slug, id: brands.find((b) => b.slug === slug)?.id ?? brands[0].id };
}

/** The brand document as the server holds it now: the truth a surface is checked against. */
export async function brandJson(req: APIRequestContext, brandId: string): Promise<any> {
  const brands = (await (await req.get('/api/brands')).json()) as { id: string; json: any }[];
  return brands.find((b) => b.id === brandId)?.json ?? {};
}

export async function sceneNames(req: APIRequestContext, brandId: string): Promise<string[]> {
  return ((await brandJson(req, brandId)).scenes ?? []).map((s: { name: string }) => s.name);
}

/** A scene written straight into the brand, the way a finished build writes one. */
export async function seedScene(
  req: APIRequestContext,
  brandId: string,
  name: string,
  extra: Record<string, unknown> = {},
): Promise<string> {
  const res = await req.post(`/api/brands/${brandId}/scenes`, {
    data: { name, prompt: `${name}, a quiet room with pale walls`, ...extra },
  });
  expect(res.ok()).toBe(true);
  return ((await res.json()) as { scene: { id: string } }).scene.id;
}

/** An owned scene card on the wall, found by its exact name. */
export const ownedSceneCard = (page: Page, name: string) =>
  page.locator('.sc-owned .sc-lookcard', { has: page.getByText(name, { exact: true }) });

/**
 * Open an owned scene's page from its card, inside the app.
 *
 * Found by the name the card shows (its link is labelled with the scene's
 * description), and clicked where a person aims for the card itself: its
 * corner, since the middle belongs to the "Use in a shot" button.
 */
export async function openOwnedScene(page: Page, name: string): Promise<void> {
  await ownedSceneCard(page, name)
    .locator('a.sc-lookcard-open')
    .click({ position: { x: 12, y: 12 } });
  await page.waitForURL(/\/scenes\/us-/);
}

/** The bar's own navigation: page breadcrumbs carry links with the same names. */
export const mainNav = (page: Page) => page.getByRole('navigation', { name: 'Main' });

/** Through the app's own nav, never `goto`: a document load would refetch everything. */
export async function goCreate(page: Page): Promise<void> {
  await mainNav(page).getByRole('link', { name: 'Create', exact: true }).click();
  await expect(page).toHaveURL(/\/create/);
}

export async function goScenes(page: Page): Promise<void> {
  await mainNav(page).getByRole('link', { name: 'Scenes', exact: true }).click();
  await expect(page).toHaveURL(/\/scenes$/);
}

/**
 * Ask the brief's scene menu for `query`, so an assertion reads a list somebody
 * actually reached rather than a picker nobody opened. Typed the way a person
 * writes a brief: a word, then the sigil.
 */
export async function askSceneMenu(page: Page, query: string): Promise<void> {
  await page.locator('.sc-brief-line').click();
  await page.keyboard.press('End');
  await page.keyboard.type(' in ');
  await page.keyboard.type('/');
  await expect(page.locator('.sc-cmd-group')).toHaveText(/^Scenes\s+\d+$/);
  await page.keyboard.type(query);
}

/** The rows the open caret menu offers under that exact name. */
export const menuRow = (page: Page, name: string) =>
  page.locator('.sc-cmd-row', { has: page.getByText(name, { exact: true }) });

/** A 1x1 PNG in the image store; `seed` keeps two apart in the content-addressed store. */
export async function uploadPng(req: APIRequestContext, seed = 0): Promise<string> {
  const png = Buffer.from(
    seed % 2
      ? 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
      : 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  );
  const res = await req.post('/api/images', {
    multipart: { file: { name: 'ref.png', mimeType: 'image/png', buffer: png } },
  });
  expect(res.ok()).toBe(true);
  return ((await res.json()) as { hash: string }).hash;
}

/** Switch brand the way a person does: the brand menu in the bar. */
export async function switchBrand(page: Page, name: string): Promise<void> {
  await page.locator('.sc-org-btn').click();
  await page.locator('.sc-menu-item', { hasText: name }).first().click();
}

/**
 * Hold the next answer to a request until the test lets it go.
 *
 * The request reaches the server at once, so the answer is the server's truth
 * at that moment; only its arrival is late. That is exactly a slow read that
 * started before a mutation and lands after it.
 */
export async function holdNext(
  page: Page,
  url: string | RegExp,
  method = 'GET',
): Promise<{ caught: Promise<void>; release: () => void }> {
  let release = () => {};
  const gate = new Promise<void>((r) => {
    release = r;
  });
  let caught = () => {};
  const seen = new Promise<void>((r) => {
    caught = r;
  });
  let used = false;
  await page.route(url, async (route) => {
    if (used || route.request().method() !== method) return route.fallback();
    used = true;
    const response = await route.fetch();
    caught();
    await gate;
    await route.fulfill({ response });
  });
  return { caught: seen, release: () => release() };
}

/** A manual product made through the same route the studio's form uses, with `count` distinct pictures. */
export async function seedProduct(req: APIRequestContext, brandId: string, name: string, count = 1): Promise<string> {
  const hashes: string[] = [];
  for (let i = 0; i < count; i++) hashes.push(await uploadPng(req, i));
  const res = await req.post(`/api/brands/${brandId}/products`, { data: { name, imageHashes: hashes } });
  expect(res.ok()).toBe(true);
  return ((await res.json()) as { productId: string }).productId;
}

/** The product library as the server answers it now. */
export async function productNames(req: APIRequestContext, brandId: string): Promise<string[]> {
  const r = (await (await req.get(`/api/brands/${brandId}/products-library`)).json()) as {
    products: { name: string }[];
  };
  return r.products.map((p) => p.name);
}

/**
 * A product card in the wall's own section, found by the name it shows. Scoped
 * to the section because a product page has a strip of other products' cards,
 * and it can still be painted for a moment after the address has moved on.
 */
export const productCard = (page: Page, name: string) =>
  page.locator('.sc-owned .sc-lookcard', {
    has: page.locator('.sc-lookcard-cap', { hasText: new RegExp(`^${name}$`) }),
  });

/** Open a product's page from its card, inside the app. */
export async function openProduct(page: Page, name: string): Promise<void> {
  await productCard(page, name)
    .locator('a.sc-lookcard-open')
    .click({ position: { x: 12, y: 12 } });
  await page.waitForURL(/\/products\/[^/]+$/);
}

/** Ask the brief's product menu for `query`, typed the way a brief is written. */
export async function askProductMenu(page: Page, query: string): Promise<void> {
  await page.locator('.sc-brief-line').click();
  await page.keyboard.press('End');
  await page.keyboard.type(' put the ');
  await page.keyboard.type('$');
  await expect(page.locator('.sc-cmd-group')).toHaveText(/^Products\s+\d+$/);
  await page.keyboard.type(query);
}

export async function goNav(page: Page, name: 'Home' | 'Products' | 'Presenters'): Promise<void> {
  await mainNav(page).getByRole('link', { name, exact: true }).click();
  await expect(page).toHaveURL(name === 'Home' ? /^[^?]*\/[^/]+$/ : new RegExp(`/${name.toLowerCase()}$`));
}
