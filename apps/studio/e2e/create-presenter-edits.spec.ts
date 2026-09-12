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
/**
 * The draft this page is on, read off its own address.
 *
 * It used to read the first draft the brand had, which is the oldest: every
 * test after the first one in this file then asserted about a draft an earlier
 * test had made, and the assertion passed or failed on the wrong person.
 */
const draftOf = async (p: Page, brandId: string) => {
  const here = /\/(pd-[a-z0-9]+)/.exec(new URL(p.url()).pathname)?.[1];
  const id =
    here ??
    (
      (await (await p.request.get(`/api/brands/${brandId}/presenter-drafts`)).json()) as { drafts: { id: string }[] }
    ).drafts.at(-1)?.id;
  return (await p.request.get(`/api/brands/${brandId}/presenter-drafts/${id}`)).json();
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
    await expect(log(page)).toContainText('Here is the presenter, in full. Ready to draw?');

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
    await expect(turn(page, 'q:agree').getByRole('button', { name: 'Draw the presenter' })).toBeDisabled();
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
    await answer(page, 'Draw the presenter').click();
    await expect(page).toHaveURL(/\/presenters\/new\/pd-/, { timeout: 40_000 });
    await expect.poll(async () => (await draftOf(page, brand.id)).direction, { timeout: 20_000 }).toContain('blonde');
  });

  test('B: three details answered, one taken away, and the others left alone', async ({ page }) => {
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
    await expect(log(page)).toContainText('Here is the presenter, in full. Ready to draw?');
    await expect(turn(page, 'you:traits')).toContainText('Glasses, Scar and Tattoo');

    // the chooser opens again with the three lit; the middle one goes
    await pencil(page, 'you:traits').click();
    const chooser = turn(page, 'q:traits');
    for (const chip of ['Glasses', 'Tattoo', 'Scar'])
      await expect(chooser.getByRole('button', { name: chip })).toHaveAttribute('aria-pressed', 'true');
    await chooser.getByRole('button', { name: 'Tattoo' }).click();
    await chooser.getByRole('button', { name: 'Continue' }).click();
    // the one taken away goes, with its placement and its pictures
    await expect(turn(page, 'you:trait-tattoo')).toHaveCount(0);
    await expect(turn(page, 'you:trait-tattoo-where')).toHaveCount(0);
    // and the two nobody touched are still answered: a detail is answered
    // about itself, so taking another one away says nothing about it
    await expect(turn(page, 'you:trait-glasses')).toContainText('Thin black');
    await expect(turn(page, 'you:trait-scar')).toContainText('On the chin');
    await expect(answer(page, 'Draw the presenter')).toBeVisible();
    // one taken in is the only thing asked
    await pencil(page, 'you:traits').click();
    await turn(page, 'q:traits').getByRole('button', { name: 'Piercing' }).click();
    await turn(page, 'q:traits').getByRole('button', { name: 'Continue' }).click();
    await expect(log(page)).toContainText('What piercing do they wear?');
    await expect(turn(page, 'you:trait-glasses')).toContainText('Thin black');
    await answer(page, 'Nose stud').click();
    await expect(answer(page, 'Draw the presenter')).toBeVisible();

    await answer(page, 'Draw the presenter').click();
    await expect(page).toHaveURL(/\/presenters\/new\/pd-/, { timeout: 40_000 });
    await expect
      .poll(async () => (await draftOf(page, brand.id)).keep as string, { timeout: 20_000 })
      .toContain('thin black');
    const d = await draftOf(page, brand.id);
    expect(d.keep).toContain('chin');
    expect(d.keep).toContain('nose stud');
    expect(d.keep).not.toContain('floral');
  });

  test('a description over a tapped answer replaces it, and words that carry on do not', async ({ page }) => {
    const brand = await currentBrand(page);
    await page.goto(`/${brand.slug}/presenters/new`);
    await answer(page, 'Describe someone').click();
    for (const label of ['Woman', '30s', 'Brown']) await answer(page, label).click();
    await answer(page, 'Long').click();
    await expect(log(page)).toContainText('And their skin?');

    // a phrase that stands on its own is the answer: the card it replaces goes
    // out, and the change closes
    await pencil(page, 'you:look-length').click();
    await expect(turn(page, 'q:look-length')).toHaveAttribute('data-reopened', 'true');
    await expect(turn(page, 'q:look-length').getByRole('button', { name: 'Long', exact: true })).toHaveAttribute(
      'data-on',
      'true',
    );
    await send(page, 'a shaggy shoulder-length cut');
    await expect(turn(page, 'q:look-length')).toHaveCount(0);
    await expect(turn(page, 'you:look-length')).toContainText('A shaggy shoulder-length cut');
    await expect(turn(page, 'you:look-length')).not.toContainText('Long');

    // a phrase that carries on from the chip keeps it, and reads as one answer
    await answer(page, 'Olive').click();
    await answer(page, 'Lean').click();
    await pencil(page, 'you:look-build').click();
    await send(page, 'but with narrower shoulders');
    await expect(turn(page, 'q:look-build')).toHaveCount(0);
    await expect(turn(page, 'you:look-build')).toContainText('Lean, with narrower shoulders');
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
    await answer(page, 'Draw the presenter').click();
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
    // the face it replaced is kept rather than thrown away, so the new one is
    // offered as a revision with the old one still on hand
    await expect(answer(page, 'Use this')).toBeVisible({ timeout: 30_000 });
    await expect(answer(page, 'Keep previous')).toBeVisible();
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

    // the question takes words, so it takes a picture too: the way in is live
    // from the moment the question is, with no button to press first
    const plus = page.getByRole('button', { name: 'Add the picture of the glasses' });
    await expect(plus).toBeVisible();
    await expect(plus).not.toHaveAttribute('aria-disabled', /.*/);
    // the picture goes in the line, in the chip the rest of the app uses for one
    await plus.click();
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
    await answer(page, 'Draw the presenter').click();
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
    const plus = page.getByRole('button', { name: 'Add the picture of the glasses' });
    await expect(plus).toBeVisible();

    // an answer opened again elsewhere: the way in belongs to that change, and
    // a detail's picture has nowhere to go
    await pencil(page, 'you:look-hair').click();
    await expect(page.getByRole('button', { name: /picture of the/ })).toHaveCount(0);
    await expect(page.locator('.sc-convo-attach')).toHaveCount(0);

    // left as it was, the conversation is back on the glasses: the way in is
    // there again, and saying it in words makes it usable
    await turn(page, 'q:look-hair').getByRole('button', { name: 'Cancel' }).click();
    await expect(plus).not.toHaveAttribute('aria-disabled', /.*/);
  });

  test('comes off again from its own chip', async ({ page }) => {
    const brand = await currentBrand(page);
    await page.goto(`/${brand.slug}/presenters/new`);
    await tapThrough(page);
    await answer(page, 'Glasses').click();
    await answer(page, 'Continue').click();
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

test.describe('an answer written again', () => {
  const toLength = async (page: Page) => {
    const brand = await currentBrand(page);
    await page.goto(`/${brand.slug}/presenters/new`);
    await answer(page, 'Describe someone').click();
    for (const label of ['Woman', '30s', 'Black']) {
      await log(page).getByRole('button', { name: label, exact: true }).click();
    }
    await expect(log(page)).toContainText('And the length?');
    await send(page, 'Lungo');
    await log(page).getByRole('button', { name: 'Olive', exact: true }).click();
    await expect(log(page)).toContainText('And their build?');
    return log(page).locator('.sc-convo-turn[data-turn="you:look-length"]');
  };

  test('words that would be refused under the question are refused over it, and nothing below is taken back', async ({
    page,
  }) => {
    const bubble = await toLength(page);
    await bubble.getByRole('button', { name: 'Change this answer' }).click();
    await bubble.locator('textarea').fill('Lungo1234');
    await bubble.locator('textarea').press('Enter');

    // the answer stands as it was, and what was said is answered where it was said
    await expect(bubble).toContainText('Lungo');
    await expect(bubble).not.toContainText('Lungo1234');
    await expect(log(page)).toContainText('Lungo1234');
    await expect(log(page)).toContainText('That is not a length.');
    // nothing under it moved: the skin still stands and the build is still the ask
    await expect(log(page).locator('.sc-convo-turn[data-turn="you:look-skin"]')).toContainText('Olive');
    await expect(log(page)).toContainText('And their build?');
  });

  test('a refusal stands after the answer it failed to change, and becomes the answer when it is fixed', async ({
    page,
  }) => {
    const bubble = await toLength(page);
    // two attempts that say nothing, one after the other
    for (const junk of ['Lungo1', 'Lungo123']) {
      await bubble.getByRole('button', { name: 'Change this answer' }).click();
      await bubble.locator('textarea').fill(junk);
      await bubble.locator('textarea').press('Enter');
      await expect(log(page)).toContainText(junk);
    }
    // they stand where they were said: after the answer, in the order they were
    // made, not filed above the answer they failed to change
    const said = await log(page).locator('.sc-convo-turn[data-who="you"]').allInnerTexts();
    const order = said.map((t) => t.replace(/\s+/g, ' ').trim());
    expect(order.findIndex((t) => t.includes('Lungo1'))).toBeGreaterThan(order.findIndex((t) => t.endsWith('Lungo')));

    // fixed, it is no longer a stray sentence: it answers the question it was
    // said at, so the run goes back there and these words are the answer
    const stray = log(page).locator('.sc-convo-turn[data-turn^="you:aside-said-"]').first();
    await stray.getByRole('button', { name: 'Change this answer' }).click();
    await stray.locator('textarea').fill('a chin-length bob');
    await stray.locator('textarea').press('Enter');

    await expect(log(page).locator('.sc-convo-turn[data-turn="you:look-length"]')).toContainText('chin-length bob');
    await expect(log(page).locator('.sc-convo-turn[data-turn^="you:aside-said-"]')).toHaveCount(0);
    await expect(log(page)).not.toContainText('Lungo123');
  });

  test('words that answer it take back what was asked after it, and that question is asked again', async ({ page }) => {
    const bubble = await toLength(page);
    await bubble.getByRole('button', { name: 'Change this answer' }).click();
    await bubble.locator('textarea').fill('a long braid');
    await bubble.locator('textarea').press('Enter');

    await expect(bubble).toContainText('long braid');
    // the skin was answered after it, so it is asked again and its answer is gone
    await expect(log(page).locator('.sc-convo-turn[data-turn="you:look-skin"]')).toHaveCount(0);
    await expect(log(page).locator('.sc-convo-turn[data-turn="q:look-skin"]')).toHaveCount(1);
    await expect(log(page)).not.toContainText('And their build?');
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
    await send(page, 'a messy bob');
    await expect(turn(page, 'you:look-length')).toContainText('A messy bob');
    await expect(log(page)).toContainText('And their skin?');
    // nothing scrolls sideways
    const wide = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    expect(wide).toBe(false);
  });

  test('the composer stands down where it is, and never leaves the screen', async ({ page }) => {
    const brand = await currentBrand(page);
    await page.goto(`/${brand.slug}/presenters/new`);
    const card = page.locator('.sc-convo-card');
    const foot = page.locator('.sc-pstudio-foot');
    await expect(card).toBeVisible();
    const room = async () => (await foot.boundingBox())?.height ?? 0;
    const atDoor = await room();

    // a question with things to tap: the card can still be written in, because
    // words are an answer to it too, and it holds exactly the room it held a
    // moment ago
    await answer(page, 'Describe someone').click();
    await expect(log(page)).toContainText('Who are they?');
    await expect(card).not.toHaveAttribute('data-quiet', 'true');
    await expect(card.locator('textarea')).toBeEnabled();
    expect(await room()).toBe(atDoor);
    await answer(page, 'Woman').click();
    await expect(log(page)).toContainText('Roughly how old?');
    expect(await room()).toBe(atDoor);

    // and a time nobody can hover for is not put on the screen at all
    await expect(page.locator('.sc-convo-time').first()).toBeHidden();
  });
});
