import { expect, type Locator, type Page, test } from '@playwright/test';
import { arrived, isolate } from './harness.js';

/**
 * The scene studio, driven the way a person drives it.
 *
 * A scene is made in the presenter's conversation, asking about a place: two
 * doors (pictures, or a few questions), the world then light then staging,
 * the place read back
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

/**
 * A place said in a sentence, with whatever it left open passed over: the
 * follow-ups ask only what the sentence did not decide, and these specs are
 * about what comes after the place.
 */
async function place(p: Page, sentence: string) {
  await say(p, sentence);
  // the live question, never the ghost of the one just answered (it stays, inert, for a beat)
  const live = () => studio(p).locator('[data-turn^="q:"]:not([data-picked])').last();
  let passed = '';
  for (let i = 0; i < 3; i++) {
    const q = live();
    if (passed) await expect(q).not.toHaveAttribute('data-turn', passed);
    await expect(q).toHaveAttribute('data-turn', /^q:(world|light|stage|agree-)/);
    const id = (await q.getAttribute('data-turn')) ?? '';
    if (id.startsWith('q:agree-')) return;
    await tap(q, 'Leave it to the reading');
    passed = id;
  }
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

/** The rows a person is asked, one tap each, in the order they are asked. */
async function guide(p: Page, picks = ['Sunlit stone', 'Golden hour', 'On a plinth']) {
  await tap(turn(p, 'q:source'), 'Guide me');
  for (const [i, id] of ['world', 'light', 'stage'].entries()) {
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

test('guided: the rows, read back as the words shots are told, drawn on a press, named while it draws, used', async ({
  page,
}) => {
  const slug = await start(page);
  await guide(page);
  const agree = openQ(page);
  await expect(agree).toContainText('Here is the place, in full. Ready to draw?');
  await expect(agree).toContainText(
    'A niche of warm limestone and rough plaster, in low golden-hour sun, long warm shadows, the subject standing on a simple plinth or ledge in the space.',
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
    'A niche of warm limestone and rough plaster, in low golden-hour sun, long warm shadows, the subject standing on a simple plinth or ledge in the space.',
  );
  expect(saved.preview).toMatch(/^asset:[a-f0-9]{32}$/);
});

test('a name typed while the picture draws is the name, even when the picture lands before Enter', async ({ page }) => {
  await start(page);
  await place(page, 'A bare plaster room with one high window');
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
  await place(page, 'A bare plaster room with one high window');
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
  await place(page, 'White cyclorama with hard flash from the left');
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
  await place(page, 'A quiet concrete gallery at dusk');
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
  await tap(turn(page, 'q:world'), 'Sunlit stone');
  await tap(turn(page, 'q:light'), 'Golden hour');
  await tap(turn(page, 'q:stage'), 'On a plinth');
  // change the world: everything asked after it is asked again
  await turn(page, 'you:world').hover();
  await turn(page, 'you:world').getByRole('button', { name: 'Change this answer' }).click();
  await expect(turn(page, 'q:world')).toHaveAttribute('data-reopened', 'true');
  await tap(turn(page, 'q:world'), 'Volcanic haze');
  await expect(turn(page, 'you:world')).toContainText('Volcanic haze');
  await expect(openQ(page)).toHaveAttribute('data-turn', 'q:light');
  await expect(turn(page, 'you:light')).toHaveCount(0);
  await expect(turn(page, 'you:shot')).toHaveCount(0);
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
    await turn(page, 'you:world').hover();
    await turn(page, 'you:world').getByRole('button', { name: 'Change this answer' }).click();
  };
  // asked first, and keeping it changes nothing
  await pencil();
  const confirm = page.getByRole('alertdialog');
  await expect(confirm).toContainText('Change this answer?');
  await confirm.getByRole('button', { name: 'Cancel' }).click();
  // nothing moved: the answer stands and so does the picture drawn from it
  await expect(turn(page, 'you:world')).toContainText('Sunlit stone');
  await expect(turn(page, 'you:light')).toContainText('Golden hour');
  await expect(turn(page, 'you:stage')).toContainText('On a plinth');
  await expect(pics).toHaveCount(1);
  // agreed: the row opens, and a new answer asks again from there
  await pencil();
  await confirm.getByRole('button', { name: 'Change it' }).click();
  await tap(turn(page, 'q:world'), 'Dark mirror');
  await expect(openQ(page)).toHaveAttribute('data-turn', 'q:light');
  // the picture drawn from the old answers is not left standing under the new one
  await expect(pics).toHaveCount(0);
  await expect(studio(page).locator('.sc-pstudio-well img')).toHaveCount(0);
  await tap(openQ(page), 'Low-key');
  await tap(openQ(page), 'On a plinth');
  await expect(openQ(page)).toContainText('near-black polished surface');
  // the name given stays with the place
  await draw(page);
  await expect(openQ(page)).toContainText('Here is Stone Hall.');
  await expect(pics).toHaveCount(1);
});

test('the keyboard goes on with the conversation: each next answer is a Tab away, not back at the close button', async ({
  page,
}) => {
  await start(page);
  await turn(page, 'q:source').getByRole('button', { name: 'Guide me', exact: true }).focus();
  await page.keyboard.press('Enter');
  const world = turn(page, 'q:world').locator('.sc-convo-q');
  await expect(world).toBeFocused();
  // a person typing keeps their place: the line is never taken from, and the
  // words answer the question on the floor
  await line(page).focus();
  await line(page).fill('a sunlit loft with brick walls');
  await line(page).press('Enter');
  await expect(openQ(page)).toHaveAttribute('data-turn', 'q:light');
  await expect(line(page)).toBeFocused();
  // and the answer after it is still a Tab away, not back at the close button
  await turn(page, 'q:light').locator('.sc-convo-q').focus();
  await page.keyboard.press('Tab');
  await expect(turn(page, 'q:light').getByRole('button', { name: 'Soft daylight', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(openQ(page)).toHaveAttribute('data-turn', 'q:stage');
});

test('a sentence that answers nothing gets a line, and a request to cast someone is sent to Create', async ({
  page,
}) => {
  await start(page);
  await say(page, 'hi');
  await expect(studio(page)).toContainText('Hello. Describe the place, or choose above.');
  await expect(openQ(page)).toHaveAttribute('data-turn', 'q:source');
  await place(page, 'A sunlit loft with brick walls');
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
  await tap(turn(page, 'q:world'), 'Colour field');
  await expect(openQ(page)).toHaveAttribute('data-turn', 'q:light');
  await page.reload();
  await arrived(page, '.sc-pstudio[data-kind="scene"]');
  await expect(turn(page, 'you:world')).toContainText('Colour field');
  await expect(openQ(page)).toHaveAttribute('data-turn', 'q:light');
});

test('leaving with anything said asks first, staying hands the keyboard back, and leaving saves nothing', async ({
  page,
}) => {
  const slug = await start(page);
  const before = (await scenes(page)).length;
  await place(page, 'A misty pine forest at dawn');
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
  await place(page, 'A tiled bathroom counter in soft morning light');
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
  await page.waitForURL(new RegExp(`/${slug}/scenes/new/[a-f0-9]+$`));
  await expect(turn(page, 'q:source')).toBeVisible();
});

test('a sentence is asked only what it left open: a full one goes straight to the reading, a partial one one tap each', async ({
  page,
}) => {
  const slug = await start(page);
  // the place, the light and the camera said: nothing more is asked
  await say(page, 'White cyclorama, hard flash, top-down product photography');
  await expect(openQ(page)).toHaveAttribute('data-turn', /^q:agree-/);
  await expect(studio(page).locator('[data-turn="q:world"], [data-turn="q:light"], [data-turn="q:stage"]')).toHaveCount(
    0,
  );

  // a material and a register: how it is lit, then how the subject sits, and nothing else
  await page.goto(`/${slug}/scenes/new`);
  await expect(turn(page, 'q:source')).toBeVisible();
  await say(page, 'luxury product photography in warm stone');
  await expect(openQ(page)).toHaveAttribute('data-turn', 'q:light');
  await expect(openQ(page)).toContainText('You have the place. What light is it in?');
  await tap(openQ(page), 'Golden hour');
  await expect(openQ(page)).toHaveAttribute('data-turn', 'q:stage');
  await tap(openQ(page), 'On a plinth');
  await expect(openQ(page)).toHaveAttribute('data-turn', /^q:agree-/);
  await expect(openQ(page)).toContainText('luxury product photography in warm stone, in low golden-hour sun');
  // the camera is never one of them
  await expect(studio(page).locator('[data-turn="q:shot"]')).toHaveCount(0);
});
