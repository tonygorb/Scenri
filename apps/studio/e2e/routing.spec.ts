import { test, expect, type Page } from '@playwright/test';
import { isolate } from './harness.js';

/**
 * The URL is the app's state. Everything here is a thing that was silently
 * broken before the router existed: a refresh always landed on Home, the brand
 * quietly reset to whichever came back first, and Back did nothing at all.
 *
 * Like composer.spec.ts, this runs against a real Scenri server, because the
 * behaviour under test is the browser's own: history entries, a cold load of a
 * deep path, and what the address bar says after a click.
 */

// A Scenri of this file's own, on an empty home, seeded from scratch.
isolate();

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
 *
 * A brand is the whole first segment now, so "settled" is a one-segment path
 * that is not the setup wizard — the only other thing living at that depth.
 */
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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A finished multi-image shot on the brand's feed, on the free Demo engine.
 *
 * Several cases here are about the variant the URL names, so one image is not
 * enough — seed.setup.ts asks for a single one, which is right for the composer
 * spec and useless to this one.
 */
async function seedShot(p: Page, brand: string) {
  const ws = (await api(p, `/api/brands/${brand}/workspace`)) as any;
  const done = (ws.nodes ?? []).find((n: any) => n.kind !== 'root' && n.status === 'done' && n.images.length > 1);
  if (done) return { nodeId: done.id, images: done.images.length };

  const root = (ws.nodes ?? []).find((n: any) => n.kind === 'root');
  const made = (await api(
    p,
    '/api/nodes',
    postJson({
      projectId: ws.project.id,
      parentId: root?.id ?? null,
      kind: 'generation',
      prompt: 'routing spec shot',
      engineId: 'demo',
      count: 3,
    }),
  )) as any;

  for (let i = 0; i < 40; i++) {
    const t = (await api(p, `/api/brands/${brand}/workspace`)) as any;
    const n = (t.nodes ?? []).find((x: any) => x.id === made.id);
    if (n?.status === 'done') return { nodeId: n.id, images: n.images.length };
    await p.waitForTimeout(300);
  }
  throw new Error('demo generation never finished');
}

/** A second, distinct finished shot — for the cases that need two. */
async function seedAnotherShot(p: Page, brand: string, prompt: string) {
  const ws = (await api(p, `/api/brands/${brand}/workspace`)) as any;
  const root = (ws.nodes ?? []).find((n: any) => n.kind === 'root');
  const made = (await api(
    p,
    '/api/nodes',
    postJson({
      projectId: ws.project.id,
      parentId: root?.id ?? null,
      kind: 'generation',
      prompt,
      engineId: 'demo',
      count: 1,
    }),
  )) as any;

  for (let i = 0; i < 40; i++) {
    const t = (await api(p, `/api/brands/${brand}/workspace`)) as any;
    const n = (t.nodes ?? []).find((x: any) => x.id === made.id);
    if (n?.status === 'done') return { nodeId: n.id as string };
    await p.waitForTimeout(300);
  }
  throw new Error('demo generation never finished');
}

/** A set holding one shot, so the filtered route has something to show. */
async function seedSet(p: Page, brand: string, name: string, nodeIds: string[]) {
  const made = (await api(p, `/api/brands/${brand}/sets`, postJson({ name }))) as any;
  if (nodeIds.length) await api(p, `/api/sets/${made.id}/nodes`, postJson({ nodeIds }));
  return made as { id: string; slug: string; name: string };
}

const postJson = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

const activeNav = (p: Page) => p.locator('.sc-nav a[data-active="true"]');

test('every screen cold-loads from its own URL', async ({ page }) => {
  const brand = await currentBrand(page);
  const { nodeId } = await seedShot(page, brand.id);
  const set = await seedSet(page, brand.id, 'Cold load', [nodeId]);

  await page.goto(`/${brand.slug}`);
  await expect(activeNav(page)).toHaveText('Home');

  // the kit is a settings pane now, so its own URL lands in the pane
  await page.goto(`/${brand.slug}/kit`);
  await page.waitForURL(/\?settings=brand/);

  await page.goto(`/${brand.slug}/scenes`);
  await expect(activeNav(page)).toHaveText('Scenes');
  await expect(page.locator('.sc-lookcard').first()).toBeVisible();

  // A scene page cold-loads from its own URL, which is what this test is
  // named after. Clicking in is not the contract and no longer reaches it:
  // the card's centre belongs to the hover "Use in a shot" action, and the
  // collection name list it used to click was removed.
  const scene = (await (await page.request.get('/api/scenes')).json()).scenes[0];
  await page.goto(`/${brand.slug}/scenes/${scene.id}`);
  await expect(page.locator('.sc-lookpage h1')).toHaveText(scene.name);

  await page.goto(`/${brand.slug}/sets/${set.slug}`);
  await expect(page.locator('.sc-canvas')).toBeVisible();
  await expect(page.locator('.sc-ovl')).toHaveCount(0);

  // the overlay hangs off the plain feed and off a set alike
  await page.goto(`/${brand.slug}/create/shots/${nodeId}`);
  await expect(page.locator('.sc-ovl')).toBeVisible();

  await page.goto(`/${brand.slug}/sets/${set.slug}/shots/${nodeId}`);
  await expect(page.locator('.sc-ovl')).toBeVisible();
});

test('every segment of the path is a word, not an initial', async ({ page }) => {
  const brand = await currentBrand(page);
  const { nodeId } = await seedShot(page, brand.id);
  const set = await seedSet(page, brand.id, 'Readable path', [nodeId]);

  // the whole point of the scheme: /b/, /s/ and /n/ read as a link shortener,
  // and `n` said node while every label on the screen says shot
  await page.goto(`/${brand.slug}/sets/${set.slug}/shots/${nodeId}`);
  for (const seg of new URL(page.url()).pathname.split('/').filter(Boolean)) {
    expect(seg.length).toBeGreaterThan(1);
  }
  expect(new URL(page.url()).pathname).toContain('/sets/');
  expect(new URL(page.url()).pathname).toContain('/shots/');
});

test('setup keeps its own URL rather than being read as a brand', async ({ page }) => {
  await currentBrand(page);

  // a brand is the whole first segment now, so the one static route sharing
  // that depth has to out-rank it — otherwise /setup opens a brand named setup
  await page.goto('/setup');
  await expect(page).toHaveURL(/\/setup$/);
  await expect(page.locator('.sc-wiz')).toBeVisible();
});

test('a reloaded shot comes back to the same shot and the same variant', async ({ page }) => {
  const brand = await currentBrand(page);
  const { nodeId, images } = await seedShot(page, brand.id);
  test.skip(images < 2, 'needs a multi-image generation to have a variant to hold');

  await page.goto(`/${brand.slug}/create/shots/${nodeId}?i=${images - 1}`);
  await expect(page.locator('.sc-ovl')).toBeVisible();
  // the take strip under the stage is where the current variant is stated
  const current = page.locator('.sc-thumbs button[aria-pressed="true"]');
  await expect(current).toHaveAttribute('aria-label', `Image ${images}`);

  await page.reload();
  await expect(page.locator('.sc-ovl')).toBeVisible();
  await expect(page.locator('.sc-thumbs button[aria-pressed="true"]')).toHaveAttribute(
    'aria-label',
    `Image ${images}`,
  );
});

test('back closes a shot, and escape spends the same single entry', async ({ page }) => {
  const brand = await currentBrand(page);
  await seedShot(page, brand.id);

  // opening pushes, so the browser's Back is the overlay's X
  await page.goto(`/${brand.slug}/create`);
  await page.locator('.sc-cell').first().click();
  await page.waitForURL(/\/shots\//);
  await expect(page.locator('.sc-ovl')).toBeVisible();

  await page.goBack();
  await page.waitForURL((u) => !u.pathname.includes('/shots/'));
  await expect(page.locator('.sc-ovl')).toHaveCount(0);

  await page.goForward();
  await expect(page.locator('.sc-ovl')).toBeVisible();

  // Escape closes by replacing that one entry rather than pushing another, so
  // Back afterwards leaves the feed entirely instead of reopening the shot
  await page.keyboard.press('Escape');
  await page.waitForURL((u) => !u.pathname.includes('/shots/'));
  await expect(page.locator('.sc-ovl')).toHaveCount(0);

  await page.goBack();
  await expect(page.locator('.sc-ovl')).toHaveCount(0);
});

test('filters live in the URL and survive a reload', async ({ page }) => {
  const brand = await currentBrand(page);

  // Products, not Scenes: a library only wears its chrome once you own
  // something in it, and the fixture owns a product but no scenes. The tab
  // rail is the same component either way, so the filter contract is the same
  // one; this just exercises it somewhere it is actually reachable.
  await page.goto(`/${brand.slug}/products`);
  // 0 is "Every product"; a real vertical starts at 1
  const vertical = page.locator('.sc-verticals button').nth(1);
  const label = (await vertical.innerText()).split('\n')[0].trim();
  await vertical.click();
  // Each library names its own facet: Products filters on `category`,
  // Scenes on `vertical`.
  await page.waitForURL(/[?&]category=/);

  await page.reload();
  await expect(page.locator('.sc-verticals button[data-on]')).toHaveText(new RegExp(label));

  // a filter is not a destination: Back leaves the screen, it does not undo it
  await page.goto(`/${brand.slug}`);
  await expect(activeNav(page)).toHaveText('Home');
});

test('settings is a URL, and Back closes it', async ({ page }) => {
  const brand = await currentBrand(page);

  await page.goto(`/${brand.slug}?settings=budget`);
  await expect(page.locator('.sc-set')).toBeVisible();
  await expect(page.locator('.sc-set-head b')).toHaveText('Budget');

  await page.goBack();
  await expect(page.locator('.sc-set')).toHaveCount(0);
});

test('switching set starts the new one clean', async ({ page }) => {
  const brand = await currentBrand(page);
  const { nodeId } = await seedShot(page, brand.id);
  const first = await seedSet(page, brand.id, 'Keyed A', [nodeId]);
  const second = await seedSet(page, brand.id, 'Keyed B', []);

  // open a shot inside the first set, and point the brief at it
  await page.goto(`/${brand.slug}/sets/${first.slug}/shots/${nodeId}`);
  await expect(page.locator('.sc-ovl')).toBeVisible();

  // React Router keeps a component mounted across a param change, so the set
  // route is keyed; without that key the last set's open shot and its refine
  // target follow you into the next one
  await page.goto(`/${brand.slug}/sets/${second.slug}?branch=${nodeId}`);
  await expect(page.locator('.sc-ovl')).toHaveCount(0);
  await expect(page.locator('.sc-canvas')).toBeVisible();
});

/**
 * A lens narrows the place you are in; it is not itself a place.
 *
 * Asking for keepers while inside a set used to navigate you out to the whole
 * brand — the feed's filter short-circuited on the set and the row answered by
 * leaving. Worse, while inside a set no tab read as selected at all, so the
 * row could not say what you were looking at. They compose now.
 */
test('a lens narrows the set you are in rather than throwing you out of it', async ({ page }) => {
  const brand = await currentBrand(page);
  const stamp = String(process.hrtime.bigint()).slice(-8);
  const { nodeId: kept } = await seedShot(page, brand.id);
  const { nodeId: plain } = await seedAnotherShot(page, brand.id, `lens spec ${stamp}`);
  const set = await seedSet(page, brand.id, `Lens ${stamp}`, [kept, plain]);
  await api(page, `/api/nodes/${kept}/keep`, postJson({ kept: true }));

  // cold, straight off the URL: the set keeps its address and the lens applies
  // inside it
  await page.goto(`/${brand.slug}/sets/${set.slug}?tab=keepers`);
  await expect(page.locator('.sc-toolbar')).toBeVisible();
  expect(new URL(page.url()).pathname).toBe(`/${brand.slug}/sets/${set.slug}`);
  await expect(page.locator('.sc-toolbar .sc-verticals button[data-on] .sc-vlabel')).toHaveText('Keepers');
  await expect(page.locator('.sc-cell')).toHaveCount(1);

  // and the counts describe this set rather than the whole brand
  const all = page.locator('.sc-toolbar .sc-verticals button', { hasText: 'All' });
  await expect(all.locator('.sc-vcount')).toHaveText('2');

  // clicking back to All stays in the set too
  await all.click();
  await page.waitForURL((u) => u.pathname === `/${brand.slug}/sets/${set.slug}` && !u.search.includes('tab='));
  await expect(page.locator('.sc-cell')).toHaveCount(2);
});

/**
 * The shots no set has claimed are a pile you can stand in, not a lens: they
 * answer "which shots", the same question a set answers. They used to be a
 * fourth tab beside the two lenses people look through all day.
 */
test('the shots outside every set are reachable, and a lens still narrows them', async ({ page }) => {
  const brand = await currentBrand(page);
  const stamp = String(process.hrtime.bigint()).slice(-8);
  const { nodeId: filed } = await seedShot(page, brand.id);
  await seedSet(page, brand.id, `Filed ${stamp}`, [filed]);

  await page.goto(`/${brand.slug}/create?in=ungrouped`);
  await expect(page.locator('.sc-toolbar')).toBeVisible();
  await expect(page.locator('.sc-toolbar-place')).toHaveAttribute('data-on', 'true');

  // the filed shot is the one thing this pile must not contain
  const ids = await page
    .locator('.sc-cell[data-fb-node]')
    .evaluateAll((els) => els.map((el) => (el as HTMLElement).dataset.fbNode));
  expect(ids).not.toContain(filed);

  // and the address it rode in on survives a reload, like every other filter
  await page.reload();
  await expect(page.locator('.sc-toolbar-place')).toHaveAttribute('data-on', 'true');
});

test('a set can be renamed and deleted from the place menu, and the shots survive', async ({ page }) => {
  const brand = await currentBrand(page);
  const { nodeId } = await seedShot(page, brand.id);
  // the e2e home persists between runs, so the names have to be this run's own
  const stamp = String(process.hrtime.bigint()).slice(-8);
  const set = await seedSet(page, brand.id, `Crumb ${stamp}`, [nodeId]);

  await page.goto(`/${brand.slug}/sets/${set.slug}`);
  await expect(page.locator('.sc-toolbar-place-t')).toHaveText(`Crumb ${stamp}`);

  await page.locator('.sc-toolbar-place').click();
  await page.getByRole('menuitem', { name: 'Rename', exact: true }).click();
  // the place title stays put — rename is a dialog, not a swap in the row
  await expect(page.locator('.sc-toolbar-place-t')).toHaveText(`Crumb ${stamp}`);
  await expect(page.getByRole('dialog', { name: 'Rename set' })).toBeVisible();
  await page.getByLabel('Set name').fill(`Renamed ${stamp}`);
  await page.keyboard.press('Enter');

  // the slug is the address: renaming has to move the path with it. On the
  // pathname alone, because the lens and the branch target ride in the query
  // and are nothing to do with which set this is.
  await page.waitForURL((u) => u.pathname === `/${brand.slug}/sets/renamed-${stamp}`);
  await expect(page.locator('.sc-toolbar-place-t')).toHaveText(`Renamed ${stamp}`);

  await page.locator('.sc-toolbar-place').click();
  await page.getByRole('menuitem', { name: 'Delete set', exact: true }).click();
  await expect(page.getByRole('alertdialog', { name: 'Delete this set?' })).toBeVisible();
  await page.getByRole('button', { name: 'Delete set', exact: true }).click();
  await page.waitForURL((u) => u.pathname === `/${brand.slug}/create`);

  // deleting a set is a label coming off, never a shot going away
  const ws = (await api(page, `/api/brands/${brand.id}/workspace`)) as any;
  expect(ws.nodes.some((n: any) => n.id === nodeId)).toBe(true);
  expect(ws.sets.some((s: any) => s.id === set.id)).toBe(false);
});

test('cancelling a new set does not leave an untitled one behind', async ({ page }) => {
  const brand = await currentBrand(page);
  await seedShot(page, brand.id);
  await page.goto(`/${brand.slug}/create`);
  await expect(page.locator('.sc-toolbar')).toBeVisible();

  const before = (await api(page, `/api/brands/${brand.id}/workspace`)) as any;
  const ids = new Set((before.sets ?? []).map((s: { id: string }) => s.id));

  await page.locator('.sc-toolbar-place').click();
  await page.getByRole('menuitem', { name: 'New set', exact: true }).click();
  const nameDlg = page.getByRole('dialog', { name: 'Name this set' });
  await expect(nameDlg).toBeVisible();
  await nameDlg.getByRole('button', { name: 'Cancel' }).click();
  await expect(nameDlg).toBeHidden();

  const after = (await api(page, `/api/brands/${brand.id}/workspace`)) as any;
  const afterIds = (after.sets ?? []).map((s: { id: string }) => s.id);
  expect(afterIds).toHaveLength(ids.size);
  expect(afterIds.every((id: string) => ids.has(id))).toBe(true);
});

test('Create is never inert, wherever it is pressed from', async ({ page }) => {
  const brand = await currentBrand(page);
  await seedShot(page, brand.id);

  // it used to do nothing at all whenever a project was already open, and to
  // open a picker otherwise. It now lands the caret in the brief either way.
  await page.goto(`/${brand.slug}/scenes`);
  await page.locator('.sc-nav a', { hasText: 'Create' }).click();
  await page.waitForURL(new RegExp(`/${brand.slug}/create`));
  await expect(activeNav(page)).toHaveText('Create');
  await expect(page.locator('.sc-canvas-dock [contenteditable="true"]')).toBeFocused();

  // and again from the hub itself, where there is no journey left to make
  await page.locator('.sc-canvas').click({ position: { x: 5, y: 5 } });
  await page.locator('.sc-nav a', { hasText: 'Create' }).click();
  await expect(page.locator('.sc-canvas-dock [contenteditable="true"]')).toBeFocused();
});

test('every shape the old /b/ scheme could spell still lands', async ({ page }) => {
  const brand = await currentBrand(page);
  const { nodeId } = await seedShot(page, brand.id);
  const set = await seedSet(page, brand.id, 'Legacy', [nodeId]);

  // the prefix itself
  await page.goto(`/b/${brand.slug}`);
  await page.waitForURL(`**/${brand.slug}`);
  await expect(activeNav(page)).toHaveText('Home');

  // the page whose URL used to stutter: /b/<brand>/brand. It lands in /kit,
  // which is itself a redirect into the settings pane the kit lives in now.
  await page.goto(`/b/${brand.slug}/brand`);
  await page.waitForURL(/\?settings=brand/);

  await page.goto(`/b/${brand.slug}/scenes`);
  await page.waitForURL(`**/${brand.slug}/scenes`);

  await page.goto(`/b/${brand.slug}/create/n/${nodeId}`);
  await page.waitForURL(`**/${brand.slug}/create/shots/${nodeId}`);
  await expect(page.locator('.sc-ovl')).toBeVisible();

  await page.goto(`/b/${brand.slug}/s/${set.slug}/n/${nodeId}`);
  await page.waitForURL(`**/${brand.slug}/sets/${set.slug}/shots/${nodeId}`);
  await expect(page.locator('.sc-ovl')).toBeVisible();

  // and the two that were already legacy before the prefix went: a project,
  // from when sets were projects, and a shot at the brand root
  await page.goto(`/b/${brand.slug}/p/anything-at-all`);
  await page.waitForURL(`**/${brand.slug}/create`);
  await expect(activeNav(page)).toHaveText('Create');

  await page.goto(`/b/${brand.slug}/n/${nodeId}`);
  await page.waitForURL(`**/${brand.slug}/create/shots/${nodeId}`);
});

test('the address bar spells names, not uuids', async ({ page }) => {
  const brand = await currentBrand(page);
  const { nodeId } = await seedShot(page, brand.id);
  const set = await seedSet(page, brand.id, 'Readable', [nodeId]);

  // "/" resolves to a brand, and says which one in words
  expect(brand.slug).not.toMatch(UUID);
  expect(set.slug).not.toMatch(UUID);

  // an id still resolves, and rewrites itself to the readable spelling
  await page.goto(`/${brand.id}/scenes`);
  await page.waitForURL(`**/${brand.slug}/scenes`);
  await expect(activeNav(page)).toHaveText('Scenes');

  // including deeper in the path, where the rest of it has to survive
  await page.goto(`/${brand.id}/sets/${set.id}/shots/${nodeId}`);
  await page.waitForURL(`**/${brand.slug}/sets/${set.slug}/shots/${nodeId}`);
  await expect(page.locator('.sc-ovl')).toBeVisible();
});

test('an unknown brand or path lands somewhere real', async ({ page }) => {
  const brand = await currentBrand(page);

  // the brand is not one this machine holds, but /scenes is still a real page —
  // so the tail rides along rather than being dropped at the brand root
  await page.goto('/does-not-exist/scenes');
  await page.waitForURL(`**/${brand.slug}/scenes`);
  await expect(activeNav(page)).toHaveText('Scenes');

  await page.goto('/total/nonsense/path');
  await page.waitForURL(`**/${brand.slug}`);
});

test('a shot URL whose node is gone falls back to the feed', async ({ page }) => {
  const brand = await currentBrand(page);
  await seedShot(page, brand.id);

  await page.goto(`/${brand.slug}/create/shots/no-such-node`);
  await page.waitForURL(`**/${brand.slug}/create`);
  await expect(page.locator('.sc-canvas')).toBeVisible();
});

/**
 * The ingredients under a shot are a record of what went into it, and the
 * natural next question about any of them is "show me that thing". They are
 * links to the pages that already exist rather than a hover surface invented
 * for the purpose, so the answer costs no new UI and Back returns to the exact
 * shot you were reading.
 */
test('an ingredient chip previews in place, and its card is the door to the page', async ({ page }) => {
  const brand = await currentBrand(page);

  // a shot whose brief names a product, a presenter, a scene and a colour, so
  // every kind of chip is on the panel at once
  const ws = (await api(page, `/api/brands/${brand.id}/workspace`)) as any;
  const root = (ws.nodes ?? []).find((n: any) => n.kind === 'root');
  const scenes = ((await api(page, '/api/scenes')) as any).scenes ?? [];
  const presenters = ((await api(page, '/api/presenters')) as any).presenters ?? [];
  const made = (await api(
    page,
    '/api/nodes',
    postJson({
      projectId: ws.project.id,
      parentId: root?.id ?? null,
      kind: 'generation',
      prompt: 'ingredient chip shot',
      engineId: 'demo',
      count: 1,
      brief: {
        prose: 'ingredient chip shot',
        tokens: [
          { t: 'product', id: 'cold-brew-can' },
          { t: 'character', id: presenters[0].id },
          { t: 'template', id: scenes[0].id },
          { t: 'color', hex: '#c8442a', name: 'Signal red' },
        ],
      },
    }),
  )) as any;

  await page.goto(`/${brand.slug}/create/shots/${made.id}`);
  await expect(page.locator('.sc-ovl')).toBeVisible();
  await expect(page.locator('.sc-ingredient').first()).toBeVisible();

  // a colour has no picture and no page, so it is the one chip that stays inert
  await expect(page.locator('button.sc-ingredient')).toHaveCount(3);
  await expect(page.locator('span.sc-ingredient[data-kind="color"]')).toHaveCount(1);

  for (const kind of ['scene', 'presenter', 'product']) {
    await page.goto(`/${brand.slug}/create/shots/${made.id}`);
    // clicking a chip never leaves the shot: it pins the preview card
    await page.locator(`.sc-ingredient[data-kind="${kind}"]`).click();
    await expect(page.locator('.sc-ovl')).toBeVisible();
    await expect(page.locator('.sc-chip-preview')).toBeVisible();
    // the card itself is the door to the catalog page
    await page.locator('.sc-chip-preview-hit').click();
    await expect(page.locator('.sc-ovl')).toHaveCount(0);
    expect(new URL(page.url()).pathname).not.toContain('/shots/');

    await page.goBack();
    await page.waitForURL(`**/${brand.slug}/create/shots/${made.id}`);
    await expect(page.locator('.sc-ovl')).toBeVisible();
  }
});

/**
 * A scene is tinted with its own preview colour on both surfaces that name it,
 * and bordered on neither. The overlay used to add a grey hairline the brief
 * line does not, which made one idea read as two.
 */
test('a scene chip says "scene" the same way in the brief line and on the shot', async ({ page }) => {
  const brand = await currentBrand(page);
  const scenes = ((await api(page, '/api/scenes')) as any).scenes ?? [];
  const scene = scenes[0];

  const ws = (await api(page, `/api/brands/${brand.id}/workspace`)) as any;
  const root = (ws.nodes ?? []).find((n: any) => n.kind === 'root');
  const made = (await api(
    page,
    '/api/nodes',
    postJson({
      projectId: ws.project.id,
      parentId: root?.id ?? null,
      kind: 'generation',
      prompt: 'scene chip shot',
      engineId: 'demo',
      count: 1,
      brief: { prose: 'scene chip shot', tokens: [{ t: 'template', id: scene.id }] },
    }),
  )) as any;

  const chipStyle = (sel: string) =>
    page
      .locator(sel)
      .first()
      .evaluate((el) => {
        const cs = getComputedStyle(el);
        return {
          bg: cs.backgroundColor,
          shadow: cs.boxShadow,
          weight: cs.fontWeight,
          radius: cs.borderRadius,
          border: cs.borderWidth,
        };
      });

  await page.goto(`/${brand.slug}/create?scene=${scene.id}`);
  await expect(page.locator('.sc-token[data-tinted]')).toBeVisible();
  const composer = await chipStyle('.sc-token[data-tinted]');

  await page.goto(`/${brand.slug}/create/shots/${made.id}`);
  await expect(page.locator('.sc-ingredient[data-kind="scene"]')).toBeVisible();
  const overlay = await chipStyle('.sc-ingredient[data-kind="scene"]');

  expect(overlay).toEqual(composer);
  // said twice on purpose: the regression was a ring, not a colour
  expect(overlay.shadow).toBe('none');
  expect(overlay.border).toBe('0px');
});

/**
 * Route navigation is real anchors now: a middle click, a Cmd click and "Copy
 * link address" have to work anywhere a click means "go somewhere". These four
 * are the representatives - the nav, a catalog card, a crumb, a feed tile -
 * asserted by href, because the href IS the feature.
 */
test('navigation surfaces are real anchors with canonical hrefs', async ({ page }) => {
  const brand = await currentBrand(page);
  const { nodeId } = await seedShot(page, brand.id);

  await page.goto(`/${brand.slug}/products`);
  await expect(page.locator('.sc-nav a', { hasText: 'Products' })).toHaveAttribute('href', `/${brand.slug}/products`);
  await expect(page.locator('a.sc-lookcard-open').first()).toHaveAttribute(
    'href',
    `/${brand.slug}/products/cold-brew-can`,
  );

  await page.goto(`/${brand.slug}/products/cold-brew-can`);
  await expect(page.locator('.sc-lookpage-crumb a')).toHaveAttribute('href', `/${brand.slug}/products`);

  await page.goto(`/${brand.slug}/create`);
  await expect(page.locator(`.sc-cell[data-fb-node="${nodeId}"] a.sc-cell-open`)).toHaveAttribute(
    'href',
    `/${brand.slug}/create/shots/${nodeId}`,
  );
});

// The popup cold-boots the whole app on its own, and the waits below allow 30s
// for it. The default 20s test budget could never cover them, so this only ever
// passed when the boot happened to be fast: it timed out at 20s in a loaded
// suite and passed in 657ms alone. The test timeout has to exceed the waits it
// contains.
test('a modified click opens the shot in its own tab, leaving this one in place', { timeout: 90_000 }, async ({
  page,
}) => {
  const brand = await currentBrand(page);
  const { nodeId } = await seedShot(page, brand.id);

  await page.goto(`/${brand.slug}/create`);
  const tile = page.locator(`.sc-cell[data-fb-node="${nodeId}"] a.sc-cell-open`);
  await expect(tile).toBeVisible();
  const [popup] = await Promise.all([
    page.context().waitForEvent('page'),
    tile.click({ modifiers: ['ControlOrMeta'] }),
  ]);
  // the new tab cold-loads the deep link on its own. A popup boot is a full
  // app cold start, and under the suite's four parallel servers it can take
  // well past the default expect window.
  await popup.waitForURL(`**/${brand.slug}/create/shots/${nodeId}`, { timeout: 30_000 });
  await expect(popup.locator('.sc-ovl')).toBeVisible({ timeout: 30_000 });
  // and the original page went nowhere
  expect(new URL(page.url()).pathname).toBe(`/${brand.slug}/create`);
  await popup.close();
});
