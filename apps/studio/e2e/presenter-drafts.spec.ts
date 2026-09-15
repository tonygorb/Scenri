import { test, expect, type Page, type APIRequestContext } from '@playwright/test';
import { isolate } from './harness.js';

/**
 * More than one unfinished person at a time.
 *
 * Nothing capped drafts and the wall listed them all, but nothing tested that
 * they stay apart, and two things kept them from doing so. A brand-scoped
 * session pointer decided which one "Create presenter" opened, and the answers
 * gathered before a draft exists shared one bucket per brand. Both are gone:
 * a conversation is named by the history entry it is being had in, and takes
 * the draft's id once it has one.
 */
isolate({ env: { SCENRI_DEMO_BUILDS: '1', SCENRI_DEMO_REFS: '5' } });

const log = (p: Page) => p.getByRole('log');
const answer = (p: Page, label: string) => log(p).getByRole('button', { name: label, exact: true });
const turn = (p: Page, key: string) => log(p).locator(`.sc-convo-turn[data-turn="${key}"]`);

async function currentBrand(p: Page): Promise<{ slug: string; id: string }> {
  await p.goto('/');
  await p.waitForURL((u) => {
    const seg = u.pathname.split('/').filter(Boolean);
    return seg.length === 1 && seg[0] !== 'setup';
  });
  const slug = decodeURIComponent(new URL(p.url()).pathname.split('/')[1]);
  const brands = (await (await p.request.get('/api/brands')).json()) as { id: string; slug: string }[];
  return { slug, id: brands.find((b) => b.slug === slug)?.id ?? brands[0].id };
}

async function settled(req: APIRequestContext, brandId: string, draftId: string, view: string, want: string) {
  for (let i = 0; i < 200; i++) {
    const d = await (await req.get(`/api/brands/${brandId}/presenter-drafts/${draftId}`)).json();
    if (d.views[view].status === want && !d.activeView) return d;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`${view} never became ${want}`);
}

/** A draft with a face on it, so the two under test are told apart by their pictures. */
async function seedDraft(req: APIRequestContext, brandId: string, direction: string): Promise<string> {
  const base = `/api/brands/${brandId}/presenter-drafts`;
  const draft = await (await req.post(base, { data: { source: 'synthetic', direction } })).json();
  await req.post(`${base}/${draft.id}/views/portrait/generate`, { data: {} });
  await settled(req, brandId, draft.id, 'portrait', 'candidate');
  return draft.id as string;
}

const faceOf = async (req: APIRequestContext, brandId: string, id: string) =>
  (await (await req.get(`/api/brands/${brandId}/presenter-drafts/${id}`)).json()).views.portrait.hash as string;

test('Create presenter starts a new conversation however many drafts are waiting', async ({ page }) => {
  test.setTimeout(90_000);
  const brand = await currentBrand(page);
  await seedDraft(page.request, brand.id, 'a woman in her 30s with dark curly hair');

  // answer part of one, leave without finishing, and come back for another
  await page.goto(`/${brand.slug}/presenters/new`);
  await answer(page, 'Describe someone').click();
  await answer(page, 'Woman').click();
  await expect(turn(page, 'you:look-who')).toContainText('Woman');

  await page.goto(`/${brand.slug}/presenters`);
  await page.getByRole('button', { name: 'Create presenter' }).click();
  await expect(page).toHaveURL(new RegExp(`/${brand.slug}/presenters/new$`));

  // the first question, and nothing of either the seeded draft or the
  // half-answered conversation
  await expect(answer(page, 'Describe someone')).toBeVisible();
  await expect(turn(page, 'you:look-who')).toHaveCount(0);
  await expect(page.locator('.sc-pstudio-well img')).toHaveCount(0);
});

/**
 * The two session keys that used to decide this, pinned by name.
 *
 * `scenri:presenter-draft:<brandId>` pointed at the last draft this tab made
 * and the bare route silently replaced into it. `scenri:presenter-setup:
 * <brandId>:new` was one pre-draft conversation per brand, read before any
 * request, so answering two questions and coming back handed the next person
 * the last one's answers. Neither is read any more, and writing them by hand
 * is the cheapest way to say so for good.
 */
test('the old brand-scoped session keys are not read', async ({ page }) => {
  test.setTimeout(90_000);
  const brand = await currentBrand(page);
  const seeded = await seedDraft(page.request, brand.id, 'a woman in her 30s with dark curly hair');

  await page.goto(`/${brand.slug}/presenters`);
  await page.evaluate(
    ({ id, brandId }) => {
      sessionStorage.setItem(`scenri:presenter-draft:${brandId}`, id);
      sessionStorage.setItem(
        `scenri:presenter-setup:${brandId}:new`,
        JSON.stringify({
          v: 5,
          answers: { source: { door: 'scratch', via: 'taps' }, 'look-who': 'woman' },
          revision: 3,
          asides: [],
        }),
      );
    },
    { id: seeded, brandId: brand.id },
  );

  await page.getByRole('button', { name: 'Create presenter' }).click();
  // not replaced into the pointed-at draft, and not holding its answers
  await expect(page).toHaveURL(new RegExp(`/${brand.slug}/presenters/new$`));
  await expect(answer(page, 'Describe someone')).toBeVisible();
  await expect(turn(page, 'you:look-who')).toHaveCount(0);
  await expect(page.locator('.sc-pstudio-well img')).toHaveCount(0);
});

test('three drafts keep their own answers and their own pictures', async ({ page }) => {
  test.setTimeout(120_000);
  const brand = await currentBrand(page);
  const a = await seedDraft(page.request, brand.id, 'a woman in her 30s, dark curly hair');
  const b = await seedDraft(page.request, brand.id, 'a man in his 20s, shaved head');
  const c = await seedDraft(page.request, brand.id, 'a person in their 50s, silver hair');
  const faces = {
    [a]: await faceOf(page.request, brand.id, a),
    [b]: await faceOf(page.request, brand.id, b),
    [c]: await faceOf(page.request, brand.id, c),
  };
  expect(new Set(Object.values(faces)).size).toBe(3);

  // opened in turn, and then opened again out of order, each wears its own
  for (const id of [a, b, c, c, a, b]) {
    await page.goto(`/${brand.slug}/presenters/new/${id}`);
    await expect(answer(page, 'Use this person')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('.sc-pstudio-well img')).toHaveAttribute('src', new RegExp(faces[id]));
  }
});

/**
 * Switching drafts faster than the reads come back.
 *
 * The journey, not the rule. Today the studio unmounts on the way through the
 * wall, so a read for the draft you left is dropped by `alive` before the
 * identity check is ever reached, and this passes with or without that check.
 * It is here because it is what a person actually does, and because the day
 * the studio stops unmounting between drafts is the day this would start
 * failing silently.
 *
 * The rule itself is unit tested, where the crossing can be stated directly:
 * see `acceptsDraft` and `test/draftTransport.test.ts`.
 */
test('switching between drafts quickly never shows the one you left', async ({ page }) => {
  test.setTimeout(120_000);
  const brand = await currentBrand(page);
  const a = await seedDraft(page.request, brand.id, 'a woman in her 30s, dark curly hair');
  const b = await seedDraft(page.request, brand.id, 'a man in his 20s, shaved head');
  const faceA = await faceOf(page.request, brand.id, a);
  const faceB = await faceOf(page.request, brand.id, b);

  await page.goto(`/${brand.slug}/presenters/new/${a}`);
  await expect(page.locator('.sc-pstudio-well img')).toHaveAttribute('src', new RegExp(faceA), { timeout: 20_000 });

  // through the wall's own links, with no settling in between
  for (let i = 0; i < 4; i++) {
    await page.goto(`/${brand.slug}/presenters`);
    await page.locator(`a[href$="/presenters/new/${b}"]`).click();
    await page.goto(`/${brand.slug}/presenters`);
    await page.locator(`a[href$="/presenters/new/${a}"]`).click();
  }

  // settled on A: the picture is A's, and stays A's while the reads catch up
  await expect(page).toHaveURL(new RegExp(`/presenters/new/${a}$`));
  await expect(page.locator('.sc-pstudio-well img')).toHaveAttribute('src', new RegExp(faceA), { timeout: 20_000 });
  await page.waitForTimeout(2500);
  await expect(page.locator('.sc-pstudio-well img')).toHaveAttribute('src', new RegExp(faceA));
  await expect(page.locator('.sc-pstudio-well img')).not.toHaveAttribute('src', new RegExp(faceB));
});

/**
 * Throwing drawn work away asks; throwing away an empty conversation does not.
 *
 * The puck on a card went straight to the delete, so a face somebody had
 * waited on went with one press and no word, and nothing offers it back.
 */
test('discarding a drawn draft asks first, and cancelling keeps it', async ({ page }) => {
  test.setTimeout(120_000);
  const brand = await currentBrand(page);
  const drawn = await seedDraft(page.request, brand.id, 'a woman in her 30s, dark curly hair');
  const bare = await (
    await page.request.post(`/api/brands/${brand.id}/presenter-drafts`, {
      data: { source: 'synthetic', direction: 'a man in his 20s' },
    })
  ).json();

  await page.goto(`/${brand.slug}/presenters`);
  const puck = (id: string) => page.locator(`a[href$="/presenters/new/${id}"]`).locator('..').getByRole('button');

  // the drawn one asks, and Cancel leaves it where it was
  await puck(drawn).click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toContainText('The views drawn so far are thrown away');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.locator(`a[href$="/presenters/new/${drawn}"]`)).toHaveCount(1);

  // a conversation with nothing drawn on it costs only the answering, so it goes at once
  await puck(bare.id).click();
  await expect(page.locator(`a[href$="/presenters/new/${bare.id}"]`)).toHaveCount(0);
  await expect(page.getByRole('alertdialog')).toHaveCount(0);

  // and agreeing really does throw the drawn one away
  await puck(drawn).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Discard' }).click();
  await expect(page.locator(`a[href$="/presenters/new/${drawn}"]`)).toHaveCount(0);
  const left = (await (await page.request.get(`/api/brands/${brand.id}/presenter-drafts`)).json()) as {
    drafts: { id: string }[];
  };
  expect(left.drafts.map((d) => d.id)).not.toContain(drawn);
});

test('Start over throws away the draft it is on and leaves the others reachable', async ({ page }) => {
  test.setTimeout(120_000);
  const brand = await currentBrand(page);
  const a = await seedDraft(page.request, brand.id, 'a woman in her 30s, dark curly hair');
  const b = await seedDraft(page.request, brand.id, 'a man in his 20s, shaved head');

  await page.goto(`/${brand.slug}/presenters/new/${a}`);
  await expect(answer(page, 'Use this person')).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Start over' }).click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toContainText('Start over?');
  await dialog.getByRole('button', { name: 'Start over' }).click();

  // that one is gone, and only that one
  await expect(page).toHaveURL(new RegExp(`/${brand.slug}/presenters/new$`));
  const left = (await (await page.request.get(`/api/brands/${brand.id}/presenter-drafts`)).json()) as {
    drafts: { id: string }[];
  };
  expect(left.drafts.map((d) => d.id)).not.toContain(a);
  expect(left.drafts.map((d) => d.id)).toContain(b);

  // and the other is still reachable from the wall, at its own stage
  await page.goto(`/${brand.slug}/presenters`);
  await page.locator(`a[href$="/presenters/new/${b}"]`).click();
  await expect(answer(page, 'Use this person')).toBeVisible({ timeout: 20_000 });
});
