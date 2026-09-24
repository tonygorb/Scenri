import zlib from 'node:zlib';
import { expect, type Page, test } from '@playwright/test';
import { isolate } from './harness.js';

/**
 * A scene's own page: the record of a world you can shoot in.
 *
 * The claims here are what the page is for, not how it is laid out: the name
 * and the one verb that uses it, the pictures of the place large enough to
 * judge and openable, what a shot is told in words, and a delete that every
 * other surface hears about in the same commit.
 */
isolate();

/**
 * A 4 by 5 PNG of one colour, so the picture a scene was drawn as and the
 * photographs it was read from are different pictures, as they are in life.
 */
function png(r: number, g: number, b: number): Buffer {
  const w = 4;
  const h = 5;
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: w }, () => [r, g, b]).flat())]);
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

async function upload(p: Page, bytes: Buffer): Promise<string | undefined> {
  const up = await p.request.post('/api/images', {
    multipart: { file: { name: 'a.png', mimeType: 'image/png', buffer: bytes } },
  });
  return up.ok() ? ((await up.json()).hash as string) : undefined;
}

async function brand(p: Page): Promise<{ id: string; slug: string }> {
  await p.goto('/');
  await p.waitForURL((u) => {
    const seg = u.pathname.split('/').filter(Boolean);
    return seg.length === 1 && seg[0] !== 'setup';
  });
  const slug = decodeURIComponent(new URL(p.url()).pathname.split('/')[1]);
  const brands = await (await p.request.get('/api/brands')).json();
  return { id: brands[0].id, slug };
}

/**
 * A saved scene, written the way the studio writes one.
 *
 * Its own name per test: the tests in a file share one library, so a name used
 * twice makes "it is gone from the wall" pass or fail on somebody else's copy.
 */
async function scene(p: Page, brandId: string, name: string, over: Record<string, unknown> = {}) {
  const read = await upload(p, png(20, 40, 90));
  const drawn = await upload(p, png(200, 170, 40));
  const r = await p.request.post(`/api/brands/${brandId}/scenes`, {
    data: {
      name,
      prompt: 'A wet basalt shelf under flat daylight, the sea behind it.',
      lighting: 'Overcast daylight, no shadow edge',
      description: 'A cold shore of black rock.',
      keywords: ['basalt', 'shore', 'overcast', 'wide', 'cold'],
      verticals: ['Beauty', 'Fragrance'],
      instruction: 'a cold black shore under flat light',
      ...(read ? { refHashes: [read] } : {}),
      ...(drawn ? { previewHash: drawn } : {}),
      ...over,
    },
  });
  return (await r.json()).scene as { id: string; name: string };
}

test('says what the place is and what a shot made here is told', async ({ page }) => {
  const b = await brand(page);
  const s = await scene(page, b.id, 'Wet Basalt Shore');
  await page.goto(`/${b.slug}/scenes/${s.id}`);

  await expect(page.getByRole('heading', { level: 1, name: 'Wet Basalt Shore' })).toBeVisible();
  // the presenter page's head: the name, where it is filed as chips, what it is in one sentence
  await expect(page.getByRole('list', { name: 'Filed under' })).toHaveText(['Beauty', 'Fragrance'].join(''));
  await expect(page.getByText('A cold shore of black rock.')).toBeVisible();
  await expect(page.locator('.sc-lookpage-crumb')).toHaveCount(0);
  await expect(page.locator('.sc-lookpage-facts')).toHaveCount(0);
  // what its picture is, in the footnote, never as a caption under it
  // a picture drawn before anchors: the shot is told the words, and any picture can be picked
  await expect(page.locator('.sc-prec-note')).toContainText('Shots are told the words. Use a view to shoot like it.');
  // one verb, and the way to change it
  await expect(page.locator('.sc-lookpage-acts .sc-btn-primary')).toHaveText('Use in a shot');
  await expect(page.getByRole('link', { name: 'Edit scene' })).toBeVisible();
  // what a shot is told: the keys that are real, whole and in the open
  await expect(page.getByText('Overcast daylight, no shadow edge')).toBeVisible();
  await expect(page.getByText('Anything you write in the shot wins')).toBeVisible();
  // and not the set prose, which belongs to the studio that writes it
  await expect(page.getByText('A wet basalt shelf under flat daylight')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Read the full words/ })).toHaveCount(0);
});

test('the pictures of the place are large enough to judge, and open at full size', async ({ page }) => {
  const b = await brand(page);
  const s = await scene(page, b.id, 'Basalt Frames');
  await page.goto(`/${b.slug}/scenes/${s.id}`);

  const tile = page.locator('.sc-scenepage-place .sc-scenepage-open');
  await expect(tile).toBeVisible();
  // a scene has no avatar, so its one picture is its identity: it is drawn at
  // its own size, bounded only by the screen, never fitted into a card
  const box = await tile.boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(360);
  // alone, it still wears its view's pill, centred on the picture and not the column
  // (the centre is the pill, as on a card: the picture opens from anywhere else)
  const aside = { position: { x: 24, y: 60 } };
  await tile.hover(aside);
  const use = page.getByRole('button', { name: 'Use this view: The place' });
  await expect(use).toHaveCSS('opacity', '1');
  const pill = (await use.boundingBox())!;
  expect(pill.height).toBeLessThan(40);
  expect(Math.abs(pill.x + pill.width / 2 - (box!.x + box!.width / 2))).toBeLessThan(2);
  expect(Math.abs(pill.y + pill.height / 2 - (box!.y + box!.height / 2))).toBeLessThan(2);

  await tile.click(aside);
  const shown = page.getByRole('dialog');
  await expect(shown).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(shown).toHaveCount(0);
  // the keyboard comes back to the picture that was opened, not the page behind
  await expect(tile).toBeFocused();
});

test('what it was read from is shown as evidence, never as the place itself', async ({ page }) => {
  const b = await brand(page);
  const s = await scene(page, b.id, 'Basalt Evidence');
  await page.goto(`/${b.slug}/scenes/${s.id}`);

  // with the pictures, in the presenter's own sources block
  await expect(page.locator('.sc-presenterpage-sources-lb')).toHaveText('What it was read from');
  await page.getByRole('button', { name: 'Source photo 1, open' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
});

test('a way to shoot it is how the verb is pressed, and it rides in the chip', async ({ page }) => {
  const b = await brand(page);
  const s = await scene(page, b.id, 'Basalt Setups', {
    setups: [{ id: 'top-down', label: 'Top down', camera: 'Directly overhead, looking straight down, deep focus' }],
  });
  await page.goto(`/${b.slug}/scenes/${s.id}`);

  // no band of its own: the ways hang off Use in a shot
  await expect(page.getByText('Ways to shoot it')).toHaveCount(0);
  await page.getByRole('button', { name: 'Use it a way' }).click();
  await page.getByRole('menuitem', { name: 'Top down' }).click();

  // using it starts a shot in this world, framed that way: one scene, one chip
  await page.waitForURL(/\/create/);
  const chip = page.locator('.sc-token[data-kind="template"]');
  await expect(chip).toHaveAttribute('data-tok', `t:${s.id}|top-down`);
  await expect(chip).toContainText('Basalt Setups');
  // the seed does not stay in the address to apply itself again
  await expect(page).not.toHaveURL(/setup=/);
});

test('a way that was wrong can be taken away, which only Details can do', async ({ page }) => {
  const b = await brand(page);
  const s = await scene(page, b.id, 'Basalt Unways', {
    setups: [{ id: 'wide', label: 'Wide', camera: 'A wide view, the subject small in the frame' }],
  });
  await page.goto(`/${b.slug}/scenes/${s.id}`);

  await page.getByRole('button', { name: 'Edit name, filing and ways' }).click();
  const sheet = page.getByRole('dialog');
  await expect(sheet.getByText('A wide view, the subject small in the frame')).toBeVisible();
  await sheet.getByRole('button', { name: 'Remove Wide' }).click();
  await sheet.getByRole('button', { name: 'Save' }).click();

  // gone from the record, so the verb is a plain button again
  await expect(page.getByRole('button', { name: 'Use it a way' })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Use it a way' })).toHaveCount(0);
});

// The anchor: a scene's picture drawn beside its references and made nobody's
// is given to every new shot as its world, and any picture of the place can
// be picked to shoot like.
test('an anchor goes with the shot as its world, and a picture picked is the frame it follows', async ({ page }) => {
  const b = await brand(page);
  const s = await scene(page, b.id, 'Basalt Anchor', { anchor: true });
  await page.goto(`/${b.slug}/scenes/${s.id}`);
  await expect(page.locator('.sc-prec-note')).toContainText(
    'Shots are given its picture as their world and find their own frame in it. Use a view to shoot like it.',
  );
  const record = (await (await page.request.get('/api/brands')).json())[0].json.scenes.find((x: any) => x.id === s.id);
  expect(record.anchor).toBe(true);
  const preview = String(record.preview).slice('asset:'.length);

  await page.locator('.sc-scenepage-place .sc-scenepage-open').click({ position: { x: 24, y: 60 } });
  await page.getByRole('dialog').getByRole('button', { name: 'Use this view' }).click();

  // one chip: the scene, carrying the picture it follows, named by its view
  await page.waitForURL(/\/create/);
  const chip = page.locator('.sc-token[data-kind=template]');
  await expect(chip).toHaveAttribute('data-tok', `t:${s.id}||${preview}|Place`);
  await expect(chip).toContainText('Basalt Anchor · Place');
  await expect(chip.locator('img')).toHaveAttribute('src', new RegExp(preview));
  await expect(page.locator('.sc-token[data-kind=ref]')).toHaveCount(0);
  // spent, so Back or a reload never adds it again; a seed nobody built on is
  // not a draft (draft.ts), exactly as a scene alone is not
  await expect(page).not.toHaveURL(/ref=|view=/);
  await page.reload();
  await expect(page.locator('.sc-token')).toHaveCount(0);
  // and the shot is given the scene's words and that one picture: its anchor stays home
  const compiled = await (
    await page.request.post('/api/brief/preview', {
      data: {
        brief: { tokens: [{ t: 'template', id: s.id, view: preview, viewName: 'Place' }] },
        brandId: b.id,
        engineId: 'demo',
      },
    })
  ).json();
  // the demo engine reads no pictures, so what it would be given is in `dropped`
  const given = [...compiled.attachments, ...(compiled.dropped ?? [])].map((a: any) => [a.role, a.hash]);
  expect(given).toEqual([['reference', preview]]);
});

test('deleting it is gone from the library in the same commit, with no reload', async ({ page }) => {
  const b = await brand(page);
  const s = await scene(page, b.id, 'Basalt To Delete');
  await page.goto(`/${b.slug}/scenes/${s.id}`);

  await page.getByRole('button', { name: 'Delete scene' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete scene' }).click();
  await page.waitForURL(new RegExp(`/${b.slug}/scenes$`));
  await expect(page.getByText('Basalt To Delete')).toHaveCount(0);
});

// Hero first (2026-09-24): a scene's cover is presentation, chosen from any of
// its views; a view picked for a shot is the frame it follows; neither changes
// the other, and neither changes what a shot is given.
test('Set as cover shows the hero on the card, everywhere, with no reload, and changes nothing a shot is given', async ({
  page,
}) => {
  const b = await brand(page);
  const place = await upload(page, png(200, 170, 40));
  const hero = await upload(page, png(30, 160, 90));
  const s = await scene(page, b.id, 'Basalt Cover', {
    previewHash: place,
    anchor: true,
    heroHash: hero,
    heroWith: { product: 'vial' },
  });
  const record = async () =>
    (await (await page.request.get('/api/brands')).json())[0].json.scenes.find((x: any) => x.id === s.id);
  // a hero written with its place stands for a scene with no cover yet
  expect((await record()).cover).toBe('hero');
  const brief = { tokens: [{ t: 'template', id: s.id }] };
  const before = await (
    await page.request.post('/api/brief/preview', { data: { brief, brandId: b.id, engineId: 'demo' } })
  ).json();

  await page.goto(`/${b.slug}/scenes/${s.id}`);
  // the hero first, then the place; the mark on the one that stands for it
  const labels = page.locator('.sc-refset .sc-refset-lb');
  await expect(labels.first()).toHaveText('Hero · Cover');
  await expect(labels.nth(1)).toHaveText('The place');
  const frames = page.locator('.sc-refset .sc-sceneview-frame');
  // the cover wears a card's selected ring, and its caption says so
  await expect(frames.first()).toHaveAttribute('data-cover', 'true');
  await expect(labels.first()).toHaveText('Hero · Cover');
  // the keyboard reaches both: the pill, and More holding Set as cover
  await page.keyboard.press('Tab');
  const morePlace = frames.nth(1).getByRole('button', { name: 'More for The place' });
  await morePlace.focus();
  await expect(morePlace).toHaveCSS('opacity', '1');
  await expect(frames.nth(1).getByRole('button', { name: 'Use this view: The place' })).toHaveCSS('opacity', '1');
  await page.keyboard.press('Enter');
  await page.getByRole('menuitem', { name: 'Set as cover' }).press('Enter');
  await expect(labels.nth(1)).toHaveText('The place · Cover');
  await expect(labels.first()).toHaveText('Hero');
  await expect(frames.first()).not.toHaveAttribute('data-cover');
  expect((await record()).cover).toBe('place');
  // nothing on a view draws again: the menu is a card's verbs and the cover
  await frames.first().hover();
  await frames.first().getByRole('button', { name: 'More for Hero' }).click();
  await expect(page.getByRole('menuitem')).toHaveText(['Open', 'Use this view', 'Set as cover']);
  await page.keyboard.press('Escape');
  // the wall shows it in the same commit
  await page.getByRole('link', { name: 'Scenes', exact: true }).first().click();
  await page.waitForURL(new RegExp(`/${b.slug}/scenes$`));
  await expect(page.locator(`img[src*="${place}"]`).first()).toBeVisible();
  // and a shot is given exactly what it was given before
  const after = await (
    await page.request.post('/api/brief/preview', { data: { brief, brandId: b.id, engineId: 'demo' } })
  ).json();
  expect(after.prompt).toBe(before.prompt);
  expect(after.attachments).toEqual(before.attachments);
});

test("a catalog scene's views: Scenri's cover is marked and fixed, and Use this view hands one to a shot", async ({
  page,
}) => {
  const b = await brand(page);
  await page.goto(`/${b.slug}/scenes/waterline-caustics`);
  const frames = page.locator('.sc-refset .sc-sceneview-frame');
  // Scenri's cover is its own choice and is not marked here: a cover mark is
  // state for someone who can change it, and nobody changes this one
  await expect(page.locator('.sc-refset .sc-refset-lb')).toHaveText([
    'Hero',
    'The place',
    'Close-up',
    'Another angle',
    'A bold one',
  ]);
  await expect(page.locator('.sc-refset [data-cover]')).toHaveCount(0);

  // Keepers is one star beside the header's buttons, as on every record page
  const keep = page.getByRole('button', { name: 'Add to Keepers' });
  await keep.click();
  await expect(page.getByRole('button', { name: 'Remove from Keepers' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Remove from Keepers' }).click();
  await expect(keep).toHaveAttribute('aria-pressed', 'false');

  // on a hover device: Use this view is the centred pill, More the card's
  // corner button in the top-right, named by the app's tip
  await frames.nth(4).hover();
  const box = (await frames.nth(4).boundingBox())!;
  const use = frames.nth(4).getByRole('button', { name: 'Use this view: A bold one' });
  await expect(use).toHaveCSS('opacity', '1');
  const pill = (await use.boundingBox())!;
  expect(Math.abs(pill.x + pill.width / 2 - (box.x + box.width / 2))).toBeLessThan(2);
  expect(Math.abs(pill.y + pill.height / 2 - (box.y + box.height / 2))).toBeLessThan(2);
  const more = frames.nth(4).getByRole('button', { name: 'More for A bold one' });
  const icon = (await more.boundingBox())!;
  expect(Math.abs(box.x + box.width - (icon.x + icon.width) - 8)).toBeLessThan(1);
  expect(Math.abs(icon.y - box.y - 8)).toBeLessThan(1);
  await more.hover();
  await expect(page.locator('.sc-tip')).toHaveText('More');
  await more.click();
  // a card's verbs, Open and the fast path; Scenri's cover is not changed
  // here, and a catalog frame is not drawn again
  await expect(page.getByRole('menuitem')).toHaveText(['Open', 'Use this view']);
  await page.keyboard.press('Escape');

  // Use this view: one chip, the scene carrying that picture, in Create
  await frames.first().hover();
  await frames.first().getByRole('button', { name: 'Use this view: Hero' }).click();
  await page.waitForURL(/\/create/);
  const chip = page.locator('.sc-token[data-kind=template]');
  await expect(chip).toHaveAttribute('data-tok', /^t:waterline-caustics\|\|[a-f0-9]{32}\|Hero$/);
  await expect(chip).toContainText('· Hero');
  await expect(page.locator('.sc-token[data-kind=ref]')).toHaveCount(0);
  await expect(page).not.toHaveURL(/ref=|view=/);
});

test("a scene chip's picker offers its own pictures: follow one, then the whole scene again", async ({ page }) => {
  const b = await brand(page);
  await page.goto(`/${b.slug}/create?scene=waterline-caustics&compose=1`);
  const chip = page.locator('.sc-token[data-kind=template]');
  await expect(chip).toHaveAttribute('data-tok', 't:waterline-caustics');
  await chip.click();
  // two sections: this scene's pictures, Whole scene first, then the other scenes
  await expect(page.locator('.sc-swap .sc-ap-sec')).toHaveText([/Waterline/, /Other scenes/]);
  const tiles = page.locator('.sc-swap-this .sc-ap-card');
  await expect(tiles).toHaveText(['+2Whole scene', 'Hero', 'Place', 'Close-up', 'Angle', 'Bold']);
  await expect(tiles.first()).toHaveAttribute('aria-pressed', 'true');
  // following a picture is the scene's own chip carrying it
  await tiles.nth(3).click();
  await expect(chip).toHaveAttribute('data-tok', /^t:waterline-caustics\|\|[a-f0-9]{32}\|Close-up$/);
  await expect(chip).toContainText('· Close-up');
  await chip.click();
  await expect(tiles.nth(3)).toHaveAttribute('aria-pressed', 'true');
  await tiles.first().click();
  await expect(chip).toHaveAttribute('data-tok', 't:waterline-caustics');
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  test('a view opens, and the sheet carries what a catalog view offers', async ({ page }) => {
    const b = await brand(page);
    await page.goto(`/${b.slug}/scenes/waterline-caustics`);
    // no hover on a phone: the frame's own actions are not drawn
    await expect(page.locator('.sc-refset .sc-sceneview-frame .sc-lookcard-use').first()).toBeHidden();
    // Scenri's own cover is not marked
    await expect(page.locator('.sc-refset .sc-sceneview-cover')).toHaveCount(0);
    await page.locator('.sc-refset .sc-refset-tile').nth(2).tap();
    const sheet = page.getByRole('dialog');
    await expect(sheet.getByRole('button', { name: 'Use this view' })).toBeVisible();
    // Scenri's own cover is fixed: only a scene you made changes its cover
    await expect(sheet.getByRole('button', { name: 'Set as cover' })).toHaveCount(0);
  });
});
