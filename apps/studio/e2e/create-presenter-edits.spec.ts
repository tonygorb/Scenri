import { test, expect, type Page } from '@playwright/test';
import { isolate } from './harness.js';

/**
 * Changing your mind in the creation conversation: an answer far back opened
 * again, details added and taken away, the door changed, a face already
 * drawn, a reload, a phone. Every case asserts the one truth the flow is
 * built on: an answer changed replaces that answer, takes back only what
 * depended on it, and leaves the conversation reading as one current person.
 */
isolate({ env: { SCENRI_DEMO_BUILDS: '1', SCENRI_DEMO_REFS: '5' } });

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

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

const log = (p: Page) => p.getByRole('log');
const composer = (p: Page) => p.locator('.sc-convo-card textarea');
const send = async (p: Page, text: string) => {
  await composer(p).fill(text);
  await composer(p).press('Enter');
};
const answer = (p: Page, label: string) => log(p).getByRole('button', { name: label, exact: true });
const turn = (p: Page, key: string) => log(p).locator(`.sc-convo-turn[data-turn="${key}"]`);
const pencil = (p: Page, key: string) => turn(p, key).getByRole('button', { name: 'Change this answer' });
const draftOf = async (p: Page, brandId: string) => {
  const { drafts } = (await (await p.request.get(`/api/brands/${brandId}/presenter-drafts`)).json()) as {
    drafts: { id: string }[];
  };
  return (await p.request.get(`/api/brands/${brandId}/presenter-drafts/${drafts[0].id}`)).json();
};

/** The rows, tapped through to the read-back. */
async function tapThrough(p: Page) {
  await answer(p, 'Describe someone').click();
  for (const label of ['Woman', '30s', 'Brown', 'Long', 'Olive', 'Lean']) await answer(p, label).click();
  await expect(log(p)).toContainText('Anything else that is always true of them?');
}

test.describe('changing an answer', () => {
  test('A: an answer three back opens in place, and the run carries on from it', async ({ page }) => {
    const brand = await currentBrand(page);
    await page.goto(`/${brand.slug}/presenters/new`);
    await tapThrough(page);
    await answer(page, 'Nothing else').click();
    await expect(log(page)).toContainText('Shall I draw them?');

    await pencil(page, 'you:look-hair').click();
    const reopened = turn(page, 'q:look-hair');
    await expect(reopened).toHaveAttribute('data-reopened', 'true');
    await expect(reopened.getByRole('button', { name: 'Brown', exact: true })).toHaveAttribute('data-on', 'true');
    // while it is open, that exchange is the conversation and the rest steps back
    await expect(turn(page, 'q:look-hair')).not.toHaveAttribute('data-dim', /.*/);
    await expect(turn(page, 'scenri:asked-look-hair')).not.toHaveAttribute('data-dim', /.*/);
    await expect(turn(page, 'you:look-build')).toHaveAttribute('data-dim', 'true');
    await expect(turn(page, 'you:look-who')).toHaveAttribute('data-dim', 'true');
    // the question the conversation is on still stands, and takes no answer
    await expect(turn(page, 'q:agree')).toHaveAttribute('data-dim', 'true');
    await expect(turn(page, 'q:agree').getByRole('button', { name: 'Draw them' })).toBeDisabled();
    // nothing before it moved, and everything after it is still readable
    await expect(turn(page, 'you:look-age')).toContainText('30s');
    await expect(turn(page, 'you:look-length')).toContainText('Long');

    // answering it takes the rest of the run back, and asks again from there
    await reopened.getByRole('button', { name: 'Blonde', exact: true }).click();
    await expect(turn(page, 'you:look-hair')).toContainText('Blonde');
    await expect(turn(page, 'you:look-length')).toHaveCount(0);
    await expect(turn(page, 'you:traits')).toHaveCount(0);
    await expect(turn(page, 'you:look-age')).toContainText('30s');
    await expect(log(page).locator('.sc-convo-turn[data-dim]')).toHaveCount(0);
    await expect(log(page)).toContainText('And the length?');

    // answered again, the person is whole and is what gets drawn
    await answer(page, 'Short').click();
    await answer(page, 'Fair').click();
    await answer(page, 'Solid').click();
    await answer(page, 'Nothing else').click();
    await expect(log(page)).toContainText('short blonde hair');
    await answer(page, 'Draw them').click();
    await expect(page).toHaveURL(/\/presenters\/new\/pd-/, { timeout: 40_000 });
    await expect.poll(async () => (await draftOf(page, brand.id)).direction, { timeout: 20_000 }).toContain('blonde');
  });

  test('B: three details answered, the choosing changed, the rest asked again', async ({ page }) => {
    test.setTimeout(60_000);
    const brand = await currentBrand(page);
    await page.goto(`/${brand.slug}/presenters/new`);
    await tapThrough(page);
    for (const chip of ['Glasses', 'Tattoo', 'Scar']) await answer(page, chip).click();
    await answer(page, 'Continue').click();
    await answer(page, 'Thin black').click();
    await answer(page, 'On the chin').click();
    await answer(page, 'Floral').click();
    await answer(page, 'Right forearm').click();
    await expect(log(page)).toContainText('Shall I draw them?');
    await expect(turn(page, 'you:traits')).toContainText('Glasses, Scar and Tattoo');

    // the chooser opens again with the three lit; the middle one goes
    await pencil(page, 'you:traits').click();
    const chooser = turn(page, 'q:traits');
    for (const chip of ['Glasses', 'Tattoo', 'Scar'])
      await expect(chooser.getByRole('button', { name: chip })).toHaveAttribute('aria-pressed', 'true');
    await chooser.getByRole('button', { name: 'Tattoo' }).click();
    await chooser.getByRole('button', { name: 'Continue' }).click();
    // the choosing changed, so the details are asked again, in the table order
    await expect(turn(page, 'you:trait-tattoo')).toHaveCount(0);
    await expect(turn(page, 'you:trait-tattoo-where')).toHaveCount(0);
    await expect(log(page)).toContainText('What glasses do they wear?');
    await answer(page, 'Thin black').click();
    await expect(log(page)).toContainText('What scar do they have?');
    await answer(page, 'On the chin').click();
    await expect(answer(page, 'Draw them')).toBeVisible();

    await answer(page, 'Draw them').click();
    await expect(page).toHaveURL(/\/presenters\/new\/pd-/, { timeout: 40_000 });
    await expect
      .poll(async () => (await draftOf(page, brand.id)).keep as string, { timeout: 20_000 })
      .toContain('thin black');
    const d = await draftOf(page, brand.id);
    expect(d.keep).toContain('chin');
    expect(d.keep).not.toContain('floral');
  });

  test('C: from scratch to photos: the rows go with the door, and the photographs are the answer', async ({ page }) => {
    const brand = await currentBrand(page);
    await page.goto(`/${brand.slug}/presenters/new`);
    await answer(page, 'Describe someone').click();
    await answer(page, 'Woman').click();
    await answer(page, '30s').click();
    await pencil(page, 'you:source').click();
    const door = turn(page, 'q:source');
    await expect(door.getByRole('button', { name: 'Describe someone' })).toHaveAttribute('data-on', 'true');
    await door.getByRole('button', { name: 'Add photos' }).click();
    await expect(turn(page, 'you:look-who')).toHaveCount(0);
    await expect(log(page)).toContainText('Add one clear photo of their face.');
    await page.locator('input[type="file"]').setInputFiles({ name: 'noor.png', mimeType: 'image/png', buffer: PNG });
    await expect(page.locator('.sc-assetform-ref')).toHaveCount(1);
    await page.getByRole('checkbox').check();
    await answer(page, 'Continue').click();
    await expect(page).toHaveURL(/\/presenters\/new\/pd-/, { timeout: 40_000 });
    await expect(turn(page, 'you:photos')).toContainText('One photo');
    await expect(turn(page, 'you:look-who')).toHaveCount(0);
    expect((await draftOf(page, brand.id)).source).toBe('photos');
  });

  test('a photograph does not follow the person back through the other door', async ({ page }) => {
    const brand = await currentBrand(page);
    await page.goto(`/${brand.slug}/presenters/new`);
    await answer(page, 'Add photos').click();
    await page.locator('input[type="file"]').setInputFiles({ name: 'noor.png', mimeType: 'image/png', buffer: PNG });
    await expect(page.locator('.sc-assetform-ref')).toHaveCount(1);
    await answer(page, 'Describe someone instead').click();
    await expect(log(page)).toContainText('Who are we making?');
    await answer(page, 'Add photos').click();
    await expect(page.locator('.sc-assetform-ref')).toHaveCount(0);
  });

  test('D: an answer changed under a drawn face is asked about, then redraws the face from the change', async ({
    page,
  }) => {
    // a face, a change, and the run answered again: well past a default budget
    test.setTimeout(60_000);
    const brand = await currentBrand(page);
    await page.goto(`/${brand.slug}/presenters/new`);
    await tapThrough(page);
    await answer(page, 'Nothing else').click();
    await answer(page, 'Draw them').click();
    await expect(answer(page, 'Use this person')).toBeVisible({ timeout: 30_000 });
    const before = await draftOf(page, brand.id);
    expect(before.generations).toBe(1);

    // asked first; declining changes nothing
    await pencil(page, 'you:look-hair').click();
    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toContainText('Change this answer?');
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(turn(page, 'you:look-hair')).toContainText('Brown');
    expect((await draftOf(page, brand.id)).generations).toBe(1);

    // agreed: the answer opens, the run carries on from it, and only once the
    // person is whole again is anything drawn
    await pencil(page, 'you:look-hair').click();
    await dialog.getByRole('button', { name: 'Change it' }).click();
    await turn(page, 'q:look-hair').getByRole('button', { name: 'Blonde', exact: true }).click();
    await expect(log(page)).toContainText('And the length?');
    expect((await draftOf(page, brand.id)).generations).toBe(1);
    await answer(page, 'Short').click();
    await answer(page, 'Fair').click();
    await answer(page, 'Solid').click();
    await answer(page, 'Nothing else').click();
    await expect.poll(async () => (await draftOf(page, brand.id)).direction, { timeout: 20_000 }).toContain('blonde');
    await expect.poll(async () => (await draftOf(page, brand.id)).generations, { timeout: 20_000 }).toBe(2);
    await expect(answer(page, 'Use this person')).toBeVisible({ timeout: 30_000 });
    // the first face stays in the record; the answer reads as it is now
    await expect(log(page).locator('.sc-convo-shot')).toHaveCount(2);
    await expect(turn(page, 'you:look-hair')).toContainText('Blonde');
  });

  test('E: a reload lands where it left off, with nothing said twice', async ({ page }) => {
    const brand = await currentBrand(page);
    await page.goto(`/${brand.slug}/presenters/new`);
    await answer(page, 'Describe someone').click();
    await answer(page, 'Woman').click();
    await answer(page, '30s').click();
    await answer(page, 'Brown').click();
    await expect(log(page)).toContainText('And the length?');
    await page.reload();
    await expect(log(page)).toContainText('And the length?');
    for (const key of ['you:look-who', 'you:look-age', 'you:look-hair', 'q:look-length'])
      await expect(turn(page, key)).toHaveCount(1);
    await expect(turn(page, 'you:look-hair')).toContainText('Brown');
    // and the conversation carries on
    await answer(page, 'Short').click();
    await expect(log(page)).toContainText('And their skin?');
  });
});

test.describe('a picture of the thing itself', () => {
  test('lands in the line as a chip the moment it is chosen, and rides with the answer', async ({ page }) => {
    const brand = await currentBrand(page);
    await page.goto(`/${brand.slug}/presenters/new`);
    await tapThrough(page);
    await answer(page, 'Glasses').click();
    await answer(page, 'Continue').click();
    await expect(log(page)).toContainText('What glasses do they wear?');

    // a question with things to tap owns the answer: the card stands down, and
    // the way in for a picture stands down with it
    await expect(page.locator('.sc-convo-attach')).toHaveCount(0);
    await answer(page, 'Describe the glasses').click();
    // the picture goes in the line, in the chip the rest of the app uses for one
    await page.getByRole('button', { name: 'Add the picture of the glasses' }).click();
    await page
      .locator('.sc-convo-card input[type="file"]')
      .setInputFiles({ name: 'thin-black.png', mimeType: 'image/png', buffer: PNG });
    const chip = page.locator('.sc-convo-field .sc-token[data-kind="image"]');
    await expect(chip).toHaveCount(1);
    // a chip is named for what it is a picture of, never for the file it came from
    await expect(chip).toContainText('Glasses');
    // the line takes the answer from here, so words can go beside the picture
    await expect(composer(page)).toBeEnabled();

    // tapping a card answers, and the picture stays with the answer
    await answer(page, 'Thin black').click();
    await expect(turn(page, 'you:trait-glasses')).toContainText('Thin black');
    await expect(turn(page, 'you:trait-glasses').locator('img')).toHaveCount(1);
    await expect(page.locator('.sc-convo-field .sc-token[data-kind="image"]')).toHaveCount(0);

    // and it reaches the draft as a picture of the detail, not of a person
    await answer(page, 'Draw them').click();
    await expect(page).toHaveURL(/\/presenters\/new\/pd-/, { timeout: 40_000 });
    await expect
      .poll(async () => Object.keys((await draftOf(page, brand.id)).detailRefs ?? {}), { timeout: 20_000 })
      .toEqual(['glasses']);
  });

  test('is added from the composer too, and answers on its own', async ({ page }) => {
    const brand = await currentBrand(page);
    await page.goto(`/${brand.slug}/presenters/new`);
    await tapThrough(page);
    await answer(page, 'Glasses').click();
    await answer(page, 'Continue').click();

    // the way in is where it is everywhere: beside the pill, once the line has
    // the answer
    await answer(page, 'Describe the glasses').click();
    const plus = page.getByRole('button', { name: 'Add the picture of the glasses' });
    await expect(plus).toBeVisible();
    await plus.click();
    await page
      .locator('.sc-convo-card input[type="file"]')
      .setInputFiles({ name: 'frames.png', mimeType: 'image/png', buffer: PNG });
    await expect(page.locator('.sc-convo-field .sc-token[data-kind="image"]')).toHaveCount(1);
    // the field asks for words, and the picture alone is enough to send
    await expect(composer(page)).toHaveAttribute('placeholder', 'Describe the glasses');
    await page.getByRole('button', { name: 'Send' }).click();
    await expect(turn(page, 'you:trait-glasses')).toContainText('The glasses in the attached picture');
    await expect(turn(page, 'you:trait-glasses').locator('img')).toHaveCount(1);
    await expect(page.locator('.sc-convo-field .sc-token[data-kind="image"]')).toHaveCount(0);
  });

  test('belongs to whatever the conversation is on, and to nothing while an answer is being changed', async ({
    page,
  }) => {
    const brand = await currentBrand(page);
    await page.goto(`/${brand.slug}/presenters/new`);
    await tapThrough(page);
    await answer(page, 'Glasses').click();
    await answer(page, 'Continue').click();
    await answer(page, 'Describe the glasses').click();
    const plus = page.getByRole('button', { name: 'Add the picture of the glasses' });
    await expect(plus).toBeVisible();

    // an answer opened again elsewhere: the way in belongs to that change, and
    // a detail's picture has nowhere to go
    await pencil(page, 'you:look-hair').click();
    await expect(page.getByRole('button', { name: /picture of the/ })).toHaveCount(0);
    await expect(page.locator('.sc-convo-attach')).toHaveCount(0);

    // left as it was, the conversation is back on the glasses; saying it in
    // words is a fresh start, and the way in comes with it
    await turn(page, 'q:look-hair').getByRole('button', { name: 'Cancel' }).click();
    await expect(page.locator('.sc-convo-attach')).toHaveCount(0);
    await answer(page, 'Describe the glasses').click();
    await expect(plus).toBeVisible();
  });

  test('comes off again from its own chip', async ({ page }) => {
    const brand = await currentBrand(page);
    await page.goto(`/${brand.slug}/presenters/new`);
    await tapThrough(page);
    await answer(page, 'Glasses').click();
    await answer(page, 'Continue').click();
    await answer(page, 'Describe the glasses').click();
    await page.getByRole('button', { name: 'Add the picture of the glasses' }).click();
    await page
      .locator('.sc-convo-card input[type="file"]')
      .setInputFiles({ name: 'thin-black.png', mimeType: 'image/png', buffer: PNG });
    const chip = page.locator('.sc-convo-field .sc-token[data-kind="image"]');
    await expect(chip).toHaveCount(1);
    await chip.getByRole('button').click();
    await expect(page.locator('.sc-convo-field .sc-token[data-kind="image"]')).toHaveCount(0);
    await answer(page, 'Thin black').click();
    await expect(turn(page, 'you:trait-glasses').locator('img')).toHaveCount(0);
  });
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test('F: an old answer opens again from its pencil, and a step is answered in words', async ({ page }) => {
    const brand = await currentBrand(page);
    await page.goto(`/${brand.slug}/presenters/new`);
    await answer(page, 'Describe someone').click();
    await answer(page, 'Woman').click();
    await answer(page, '30s').click();
    await answer(page, 'Brown').click();
    await expect(log(page)).toContainText('And the length?');
    await pencil(page, 'you:look-age').click();
    const reopened = turn(page, 'q:look-age');
    await expect(reopened).toHaveAttribute('data-reopened', 'true');
    await reopened.getByRole('button', { name: '40s' }).click();
    await expect(turn(page, 'you:look-age')).toContainText('40s');
    // the run carries on from the change: the colour is asked again
    await expect(turn(page, 'you:look-hair')).toHaveCount(0);
    await expect(log(page)).toContainText('What colour is their hair?');
    await answer(page, 'Black').click();
    await expect(log(page)).toContainText('And the length?');
    await log(page).getByRole('button', { name: 'Describe the cut' }).click();
    await send(page, 'a messy bob');
    await expect(turn(page, 'you:look-length')).toContainText('A messy bob');
    await expect(log(page)).toContainText('And their skin?');
    // nothing scrolls sideways
    const wide = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    expect(wide).toBe(false);
  });
});
