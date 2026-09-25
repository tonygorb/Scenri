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
  await expect(page.locator('.sc-lookpage-crumb a')).toHaveText('Scenes');
  await expect(page.locator('.sc-lookpage-crumb a')).toHaveAttribute('href', `/${b.slug}/scenes`);
  await expect(page.locator('.sc-lookpage-crumb')).toContainText('Yours');
  await expect(page.locator('.sc-lookpage-facts')).toHaveCount(0);
  // what its picture is, in the footnote, never as a caption under it
  await expect(page.locator('.sc-prec-note')).toContainText('Shots are told the words, never handed this picture.');
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

  const tile = page.locator('.sc-scenepage-place > button');
  await expect(tile).toBeVisible();
  // a scene has no avatar, so its one picture is its identity: it is drawn at
  // its own size, bounded only by the screen, never fitted into a card
  const box = await tile.boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(360);

  await tile.click();
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

test('deleting it is gone from the library in the same commit, with no reload', async ({ page }) => {
  const b = await brand(page);
  const s = await scene(page, b.id, 'Basalt To Delete');
  await page.goto(`/${b.slug}/scenes/${s.id}`);

  await page.getByRole('button', { name: 'Delete scene' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete scene' }).click();
  await page.waitForURL(new RegExp(`/${b.slug}/scenes$`));
  await expect(page.getByText('Basalt To Delete')).toHaveCount(0);
});
