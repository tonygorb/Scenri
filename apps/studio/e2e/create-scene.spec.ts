import { expect, type Locator, type Page, test } from '@playwright/test';
import { arrived, isolate } from './harness.js';

/**
 * The scene studio, driven the way a person drives it.
 *
 * A scene is made in the presenter's conversation, asking about a place: two
 * doors (pictures, or a few questions), five rows of cards, the place read back
 * as the words every shot will be told, one Draw, then Use, Try again or a
 * sentence that changes one thing. Every test here presses the controls; the
 * API is only read, to check what was saved.
 *
 * The demo engine draws (SCENRI_DEMO_BUILDS with five reference slots), the
 * demo analyzer reads (SCENRI_DEMO_ANALYSIS), and both take time
 * (SCENRI_DEMO_DELAY_MS, SCENRI_DEMO_READ_MS), because the states a person sits
 * in while a draw runs are where the defects live.
 */
isolate({
  env: {
    SCENRI_DEMO_BUILDS: '1',
    SCENRI_DEMO_REFS: '5',
    SCENRI_DEMO_DELAY_MS: '1500',
    SCENRI_DEMO_ANALYSIS: 'usable',
    SCENRI_DEMO_READ_MS: '300',
  },
});

/** Two small PNGs that differ, so the content-addressed store keeps them apart. */
const A = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
const B = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);
const file = (name: string, buffer: Buffer) => ({ name, mimeType: 'image/png', buffer });

async function brandSlug(p: Page): Promise<string> {
  await p.goto('/');
  await p.waitForURL((u) => {
    const seg = u.pathname.split('/').filter(Boolean);
    return seg.length === 1 && seg[0] !== 'setup';
  });
  return decodeURIComponent(new URL(p.url()).pathname.split('/')[1]);
}

const studio = (p: Page) => p.locator('.sc-pstudio[data-kind="scene"]');
const turn = (p: Page, key: string) => studio(p).locator(`[data-turn="${key}"]`);
/** The question the conversation is on: the last one asked. */
const openQ = (p: Page) => studio(p).locator('[data-turn^="q:"]').last();
const line = (p: Page) => studio(p).locator('.sc-pstudio-foot textarea');

async function say(p: Page, text: string) {
  await line(p).fill(text);
  await line(p).press('Enter');
}

async function tap(q: Locator, name: string) {
  await q.getByRole('button', { name, exact: true }).click();
}

async function scenes(p: Page): Promise<any[]> {
  const brands = await (await p.request.get('/api/brands')).json();
  return brands.flatMap((b: any) => b.json?.scenes ?? []);
}

async function start(p: Page) {
  const slug = await brandSlug(p);
  await p.goto(`/${slug}/scenes/new`);
  await arrived(p, '.sc-pstudio[data-kind="scene"]');
  await expect(turn(p, 'q:source')).toBeVisible();
  return slug;
}

/** The five rows, one tap each, in the order they are asked. */
async function guide(p: Page, picks = ['Interior', 'Golden hour', 'Warm', 'Stone and concrete', 'Just the place']) {
  await tap(turn(p, 'q:source'), 'Guide me');
  for (const [i, id] of ['where', 'light', 'feeling', 'materials', 'figure'].entries()) {
    await expect(turn(p, `q:${id}`)).toBeVisible();
    await tap(turn(p, `q:${id}`), picks[i]);
  }
}

/** The read-back, and the one press that draws. */
async function draw(p: Page) {
  const agree = openQ(p);
  await expect(agree).toContainText('What your shots are told');
  await tap(agree, 'Draw the scene');
}

test('guided: five rows, read back as the words shots are told, drawn on a press, named while it draws, used', async ({
  page,
}) => {
  const slug = await start(page);
  await guide(page);
  const agree = openQ(page);
  await expect(agree).toContainText('Here is the place, in full. Ready to draw?');
  await expect(agree).toContainText(
    'An interior, in low golden-hour light, warm, made of stone and concrete, with nobody in it.',
  );
  // nothing was drawn before the press
  await expect(studio(page).locator('.sc-pstudio-well img')).toHaveCount(0);
  await draw(page);
  // the name is asked while it draws, with the reader's suggestion to tap
  await expect(turn(page, 'q:name')).toBeVisible();
  await say(page, 'Dusk Lobby');
  await expect(openQ(page)).toHaveAttribute('data-turn', /^q:decide-/);
  await expect(openQ(page)).toContainText('Here is Dusk Lobby.');
  await expect(studio(page).locator('.sc-pstudio-well img')).toHaveCount(1);
  await tap(openQ(page), 'Use this scene');
  await page.waitForURL(new RegExp(`/${slug}/scenes/us-`));
  await expect(page.getByRole('heading', { level: 1, name: 'Dusk Lobby' })).toBeVisible();
  const saved = (await scenes(page)).find((s) => s.name === 'Dusk Lobby');
  expect(saved.instruction).toBe(
    'An interior, in low golden-hour light, warm, made of stone and concrete, with nobody in it.',
  );
  expect(saved.preview).toMatch(/^asset:[a-f0-9]{32}$/);
});

test('a name typed while the picture draws is the name, even when the picture lands before Enter', async ({ page }) => {
  await start(page);
  await say(page, 'A bare plaster room with one high window');
  await draw(page);
  await expect(turn(page, 'q:name')).toBeVisible();
  await line(page).fill('High Window');
  // the draw lands under the typed words, and the question on the floor changes
  await expect(openQ(page)).toHaveAttribute('data-turn', /^q:decide-/);
  await line(page).press('Enter');
  await expect(openQ(page)).toContainText('Here is High Window.');
  // it named the scene; it did not change it, and nothing else was drawn
  await expect(studio(page).locator('[data-turn^="you:ask-"]')).toHaveCount(0);
  await expect(studio(page).locator('[data-turn^="scenri:pic-"]')).toHaveCount(1);
});

test('a sentence that names the scene names it, at the name question or after the picture, and draws nothing', async ({
  page,
}) => {
  await start(page);
  await say(page, 'A bare plaster room with one high window');
  await draw(page);
  await expect(turn(page, 'q:name')).toBeVisible();
  // said the way people say it: the name is the name, not the sentence around it
  await say(page, 'call it High Window');
  await expect(openQ(page)).toHaveAttribute('data-turn', /^q:decide-/);
  await expect(openQ(page)).toContainText('Here is High Window.');
  // and once the picture stands, in the line that changes things
  await say(page, 'rename it to Plaster Light');
  await expect(openQ(page)).toContainText('Here is Plaster Light.');
  await expect(studio(page)).toContainText('Called it Plaster Light.');
  await expect(studio(page).locator('[data-turn^="you:ask-"]')).toHaveCount(0);
  await expect(studio(page).locator('[data-turn^="scenri:pic-"]')).toHaveCount(1);
});

test('a sentence at the first question is the place itself, and a scene saved unnamed takes the reader’s name', async ({
  page,
}) => {
  await start(page);
  await say(page, 'White cyclorama with hard flash from the left');
  await expect(openQ(page)).toContainText('White cyclorama with hard flash from the left.');
  await draw(page);
  await expect(openQ(page)).toHaveAttribute('data-turn', /^q:decide-/);
  await tap(openQ(page), 'Use this scene');
  await page.waitForURL(/\/scenes\/us-/);
  expect((await scenes(page)).some((s) => s.name === 'White cyclorama with')).toBe(true);
});

test('the picture door: pictures read into words, the reader’s note said, the pictures kept on the scene', async ({
  page,
}) => {
  await start(page);
  await tap(turn(page, 'q:source'), 'Add pictures');
  const q = turn(page, 'q:photos');
  await expect(q).toContainText('Add pictures of the place');
  await q.locator('input[type="file"]').setInputFiles([file('a.png', A), file('b.png', B)]);
  await expect(q.locator('.sc-assetform-ref img')).toHaveCount(2);
  await tap(q, 'Read them');
  await expect(openQ(page)).toContainText('Here is the place I read in your pictures.');
  await expect(studio(page)).toContainText('These may be two different places.');
  await expect(line(page)).toHaveAttribute('placeholder', 'Anything to keep or ignore in them?');
  await draw(page);
  await say(page, 'Two Shores');
  await expect(openQ(page)).toHaveAttribute('data-turn', /^q:decide-/);
  await tap(openQ(page), 'Use this scene');
  await page.waitForURL(/\/scenes\/us-/);
  const saved = (await scenes(page)).find((s) => s.name === 'Two Shores');
  expect(saved.refs).toHaveLength(2);
});

test('pictures opened again and changed, then left, are as they were, and the picture drawn from them stays', async ({
  page,
}) => {
  await start(page);
  await tap(turn(page, 'q:source'), 'Add pictures');
  const q = turn(page, 'q:photos');
  await q.locator('input[type="file"]').setInputFiles([file('a.png', A), file('b.png', B)]);
  await expect(q.locator('.sc-assetform-ref img')).toHaveCount(2);
  await tap(q, 'Read them');
  await draw(page);
  await say(page, 'Two Shores');
  await expect(openQ(page)).toHaveAttribute('data-turn', /^q:decide-/);
  await turn(page, 'you:photos').hover();
  await turn(page, 'you:photos').getByRole('button', { name: 'Change this answer' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Change it' }).click();
  const reopened = turn(page, 'q:photos');
  await expect(reopened).toHaveAttribute('data-reopened', 'true');
  await reopened.getByRole('button', { name: 'Remove reference 1' }).click();
  // it stays where it was asked while it changes
  await expect(reopened.locator('.sc-assetform-ref img')).toHaveCount(1);
  await expect(reopened).toHaveAttribute('data-reopened', 'true');
  await reopened.getByRole('button', { name: 'Cancel' }).click();
  await expect(turn(page, 'you:photos').locator('img')).toHaveCount(2);
  await expect(studio(page).locator('[data-turn^="scenri:pic-"]')).toHaveCount(1);
  await expect(openQ(page)).toHaveAttribute('data-turn', /^q:decide-/);
});

test('a change keeps the rest, and Put back restores a whole version, words and picture', async ({ page }) => {
  await start(page);
  await say(page, 'A quiet concrete gallery at dusk');
  await draw(page);
  await say(page, 'Gallery');
  await expect(openQ(page)).toHaveAttribute('data-turn', 'q:decide-1');
  const first = await studio(page).locator('[data-turn="scenri:pic-1"] img').getAttribute('src');
  await say(page, 'make the walls darker');
  await expect(studio(page).locator('[data-turn="you:ask-2"]')).toContainText('make the walls darker');
  await expect(openQ(page)).toHaveAttribute('data-turn', 'q:decide-2');
  // the words carry the change, and the rest of them stand
  await expect(openQ(page)).toContainText('A quiet concrete gallery at dusk.');
  await expect(openQ(page)).toContainText('make the walls darker');
  // the line is empty again once the sentence is taken
  await expect(line(page)).toHaveValue('');
  // the first picture goes back on, with its own words
  await studio(page).locator('[data-turn="scenri:pic-1"]').hover();
  await studio(page).locator('[data-turn="scenri:pic-1"]').getByRole('button', { name: 'Put back' }).click();
  await expect(openQ(page)).toHaveAttribute('data-turn', 'q:decide-1');
  await expect(openQ(page)).not.toContainText('make the walls darker');
  await tap(openQ(page), 'Use this scene');
  await page.waitForURL(/\/scenes\/us-/);
  const saved = (await scenes(page)).find((s) => s.name === 'Gallery');
  expect(first).toContain(saved.preview.slice('asset:'.length));
});

test('the pencil takes an answer back and asks again from there', async ({ page }) => {
  await start(page);
  await tap(turn(page, 'q:source'), 'Guide me');
  await tap(turn(page, 'q:where'), 'Interior');
  await tap(turn(page, 'q:light'), 'Golden hour');
  await tap(turn(page, 'q:feeling'), 'Warm');
  // change the place: everything asked after it is asked again
  await turn(page, 'you:where').hover();
  await turn(page, 'you:where').getByRole('button', { name: 'Change this answer' }).click();
  await expect(turn(page, 'q:where')).toHaveAttribute('data-reopened', 'true');
  await tap(turn(page, 'q:where'), 'Nature');
  await expect(turn(page, 'you:where')).toContainText('Nature');
  await expect(openQ(page)).toHaveAttribute('data-turn', 'q:light');
  await expect(turn(page, 'you:feeling')).toHaveCount(0);
});

test('an answer the picture was drawn from asks before it opens, and changing it asks again from there without the old picture', async ({
  page,
}) => {
  await start(page);
  await guide(page);
  await draw(page);
  await say(page, 'Stone Hall');
  await expect(openQ(page)).toHaveAttribute('data-turn', /^q:decide-/);
  const pics = studio(page).locator('[data-turn^="scenri:pic-"]');
  const pencil = async () => {
    await turn(page, 'you:feeling').hover();
    await turn(page, 'you:feeling').getByRole('button', { name: 'Change this answer' }).click();
  };
  // asked first, and keeping it changes nothing
  await pencil();
  const confirm = page.getByRole('alertdialog');
  await expect(confirm).toContainText('Change this answer?');
  await confirm.getByRole('button', { name: 'Cancel' }).click();
  await expect(turn(page, 'q:feeling')).toHaveCount(0);
  await expect(pics).toHaveCount(1);
  // agreed: the row opens, and a new answer asks again from there
  await pencil();
  await confirm.getByRole('button', { name: 'Change it' }).click();
  await tap(turn(page, 'q:feeling'), 'Cool');
  await expect(openQ(page)).toHaveAttribute('data-turn', 'q:materials');
  // the picture drawn from the old answers is not left standing under the new one
  await expect(pics).toHaveCount(0);
  await expect(studio(page).locator('.sc-pstudio-well img')).toHaveCount(0);
  await tap(openQ(page), 'Wood');
  await tap(openQ(page), 'Just the place');
  await expect(openQ(page)).toContainText('cool, made of wood');
  // the name given stays with the place
  await draw(page);
  await expect(openQ(page)).toContainText('Here is Stone Hall.');
  await expect(pics).toHaveCount(1);
});

test('a sentence that answers nothing gets a line, and a request to cast someone is sent to Create', async ({
  page,
}) => {
  await start(page);
  await say(page, 'hi');
  await expect(studio(page)).toContainText('Hello. Describe the place, or choose above.');
  await expect(openQ(page)).toHaveAttribute('data-turn', 'q:source');
  await say(page, 'A sunlit loft with brick walls');
  await draw(page);
  await say(page, 'Loft');
  await expect(openQ(page)).toHaveAttribute('data-turn', /^q:decide-/);
  await say(page, 'add a model in a red coat');
  await expect(studio(page)).toContainText('Add presenters and products in Create.');
  // refused words stay in the line, to be put another way; nothing was drawn
  await expect(line(page)).toHaveValue('add a model in a red coat');
  await expect(studio(page).locator('[data-turn^="scenri:pic-"]')).toHaveCount(1);
});

test('a reload comes back to the same conversation, the same question on the floor', async ({ page }) => {
  await start(page);
  await tap(turn(page, 'q:source'), 'Guide me');
  await tap(turn(page, 'q:where'), 'Studio');
  await expect(openQ(page)).toHaveAttribute('data-turn', 'q:light');
  await page.reload();
  await arrived(page, '.sc-pstudio[data-kind="scene"]');
  await expect(turn(page, 'you:where')).toContainText('Studio');
  await expect(openQ(page)).toHaveAttribute('data-turn', 'q:light');
});

test('leaving with anything said asks first, staying hands the keyboard back, and leaving saves nothing', async ({
  page,
}) => {
  const slug = await start(page);
  const before = (await scenes(page)).length;
  await say(page, 'A misty pine forest at dawn');
  await expect(openQ(page)).toHaveAttribute('data-turn', /^q:agree-/);
  await line(page).focus();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('alertdialog')).toContainText('Leave this scene?');
  // staying puts the keyboard back where it was, not on the page behind
  await page.getByRole('alertdialog').getByRole('button', { name: 'Cancel' }).click();
  await expect(line(page)).toBeFocused();
  await page.keyboard.press('Escape');
  await page.getByRole('alertdialog').getByRole('button', { name: 'Leave' }).click();
  await page.waitForURL(new RegExp(`/${slug}/scenes$`));
  expect((await scenes(page)).length).toBe(before);
});

test('a saved scene opens in the studio at its record, spending nothing, and saves in place', async ({ page }) => {
  await start(page);
  await say(page, 'A tiled bathroom counter in soft morning light');
  await draw(page);
  await say(page, 'Morning Counter');
  await expect(openQ(page)).toHaveAttribute('data-turn', /^q:decide-/);
  await tap(openQ(page), 'Use this scene');
  await page.waitForURL(/\/scenes\/us-/);
  const id = new URL(page.url()).pathname.split('/').pop();
  await page.getByRole('link', { name: 'Edit scene' }).click();
  await page.waitForURL(new RegExp(`/scenes/${id}/edit$`));
  await arrived(page, '.sc-pstudio[data-kind="scene"]');
  await expect(studio(page)).toContainText('Here is Morning Counter, as it is saved.');
  await expect(openQ(page)).toHaveAttribute('data-turn', 'q:decide-0');
  await tap(openQ(page), 'Try again');
  await expect(openQ(page)).toHaveAttribute('data-turn', 'q:decide-1');
  await tap(openQ(page), 'Save changes');
  await page.waitForURL(new RegExp(`/scenes/${id}$`));
  const all = (await scenes(page)).filter((s) => s.name === 'Morning Counter');
  expect(all).toHaveLength(1);
});

test('the old address forwards to the studio', async ({ page }) => {
  const slug = await brandSlug(page);
  await page.goto(`/${slug}/scenes?new=scene`);
  await page.waitForURL(new RegExp(`/${slug}/scenes/new$`));
  await expect(turn(page, 'q:source')).toBeVisible();
});
