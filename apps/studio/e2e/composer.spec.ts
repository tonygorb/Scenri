import { test, expect, type Page } from '@playwright/test';

/**
 * The caret and focus behaviour of the brief.
 *
 * These cases cannot be written in jsdom: only trusted events move focus, and
 * Chromium's editing caret is a (node, offset) anchor that behaves differently
 * from what the Selection API reports. Every regression in this area this far
 * has been invisible to unit tests and obvious within seconds of real clicking,
 * so this spec clicks and types for real.
 */

const line = (p: Page) => p.locator('.sc-brief-line').first();
const dock = (p: Page) => p.locator('.sc-home-dock, .sc-canvas-dock').first();
const chips = (p: Page) => p.locator('.sc-brief-line .sc-token');

/** What the sentence reads as, chips included. */
const sentence = async (p: Page) => (await line(p).textContent())?.replace(/ /g, ' ') ?? '';

/**
 * Open the attach panel and pick a tab.
 *
 * Attach used to be two clicks: a menu naming five kinds, then a panel that
 * already had those same five as tabs. The menu is gone, so this opens the
 * panel and goes straight to the tab.
 */
async function plusMenu(p: Page, tab: RegExp) {
  const panel = p.locator('.sc-attachpanel');
  if (await panel.isVisible().catch(() => false)) {
    await dock(p).locator('.sc-attach-toggle').click();
  }
  await dock(p).locator('.sc-attach-toggle').click();
  await p.locator('.sc-ap-tabs button', { hasText: tab }).click();
  await p.locator('.sc-ap-card').first().waitFor();
}

async function pickCard(p: Page, index = 0) {
  await p.locator('.sc-ap-card').nth(index).click();
  await expect(chips(p)).not.toHaveCount(0);
}

/**
 * Click exactly at a character in the line.
 *
 * A Playwright text locator resolves to the element that contains the text,
 * which here is the whole line, so its box is useless for aiming at a word.
 * A Range around the character gives the real coordinates.
 */
async function clickAtChar(p: Page, nodeIndex: number, charOffset: number) {
  const pt = await p.evaluate(
    ([ni, off]) => {
      const el = document.querySelector('.sc-brief-line')!;
      const node = el.childNodes[ni as number];
      const len = (node.textContent ?? '').length;
      const r = document.createRange();
      r.setStart(node, Math.min(off as number, len));
      r.setEnd(node, Math.min((off as number) + 1, len));
      const b = r.getBoundingClientRect();
      return { x: b.left + 1, y: b.top + b.height / 2 };
    },
    [nodeIndex, charOffset],
  );
  await p.mouse.click(pt.x, pt.y);
}

test.beforeEach(async ({ page }) => {
  // the brief lives on the hub: Home is the way in and carries no tools
  await page.goto('/');
  // a brand is the whole first segment now: one segment, and not the wizard
  await page.waitForURL((u) => {
    const seg = u.pathname.split('/').filter(Boolean);
    return seg.length === 1 && seg[0] !== 'setup';
  });
  await page.goto(`${new URL(page.url()).pathname}/create`);
  await line(page).waitFor();
  await line(page).click();
  // start from a clean sentence whatever the last run left behind
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('Backspace');
});

test('typing after a chip added from the plus menu', async ({ page }) => {
  await page.keyboard.type('change the background color of this ');
  await plusMenu(page, /shots/i);
  await pickCard(page);
  await page.keyboard.type('to warm beige');
  expect(await sentence(page)).toMatch(/reference\s*to warm beige$/);
});

test('a chip lands at the caret, not at the end', async ({ page }) => {
  await page.keyboard.type('shoot it in golden light');
  // put the caret after "shoot it"
  for (let i = 0; i < ' in golden light'.length; i++) await page.keyboard.press('ArrowLeft');
  await plusMenu(page, /product/i);
  await pickCard(page);
  await page.keyboard.type('X');
  const text = await sentence(page);
  expect(text.startsWith('shoot it ')).toBe(true);
  expect(text).toMatch(/X\s*in golden light$/); // typing carried on after the chip
});

test('@ reaches for an ingredient and typing carries on', async ({ page }) => {
  await page.keyboard.type('put the ');
  await page.keyboard.type('@');
  await page.locator('.sc-cmd-row').first().waitFor();
  await page.locator('.sc-cmd-row').first().click();
  await page.keyboard.type('on ice');
  const text = await sentence(page);
  expect(text).not.toContain('@');
  expect(text).toMatch(/on ice$/);
});

test('# reaches for a look, and offers only looks', async ({ page }) => {
  await page.keyboard.type('a shot ');
  await page.keyboard.type('#');
  await page.locator('.sc-cmd-row').first().waitFor();
  // the sigil is the filter: a look menu never lists products or colors
  const groups = await page.locator('.sc-cmd-group').allInnerTexts();
  expect(groups.every((g) => /looks/i.test(g))).toBe(true);
  await page.locator('.sc-cmd-row').first().click();
  await page.keyboard.type('at dawn');
  const text = await sentence(page);
  expect(text).not.toContain('#');
  expect(text).toMatch(/at dawn$/);
});

test('a hex colour is text, not a look query', async ({ page }) => {
  await page.keyboard.type('keep the cap #F5C518 exactly');
  // the menu must not be open, and nothing may have been eaten
  await expect(page.locator('.sc-cmd')).toHaveCount(0);
  expect(await sentence(page)).toContain('#F5C518');
});

test('an email keeps its @', async ({ page }) => {
  await page.keyboard.type('credit tony@example.com in the corner');
  await expect(page.locator('.sc-cmd')).toHaveCount(0);
  expect(await sentence(page)).toContain('tony@example.com');
});

test('clicking moves the caret, before and after a chip', async ({ page }) => {
  await page.keyboard.type('alpha bravo ');
  await plusMenu(page, /product/i);
  await pickCard(page);
  await page.keyboard.type('charlie delta');

  // node 0 is "alpha bravo ", node 1 the chip, node 2 the text after it
  await clickAtChar(page, 0, 6); // just before "bravo"
  await page.keyboard.type('#');
  expect(await sentence(page)).toMatch(/^alpha #bravo/);

  await clickAtChar(page, 2, 9); // inside "charlie delta"
  await page.keyboard.type('@');
  expect(await sentence(page)).toMatch(/charlie @delta/);
});

test('backspace over a chip removes it and leaves one space', async ({ page }) => {
  await page.keyboard.type('one ');
  await plusMenu(page, /product/i);
  await pickCard(page);
  await page.keyboard.type('two');
  await expect(chips(page)).toHaveCount(1);

  // walk back over "two" and the space, then delete the chip itself
  for (let i = 0; i < 'two '.length; i++) await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Backspace');
  await expect(chips(page)).toHaveCount(0);
  expect(await sentence(page)).not.toMatch(/ {2}/);
});

test('changing aspect and quality does not disturb the sentence', async ({ page }) => {
  await page.keyboard.type('a careful sentence');

  await page.locator('.sc-var').first().click(); // aspect
  await page.locator('[role="menuitem"]').filter({ hasText: /Story/ }).first().click();
  await expect(page.locator('[role="menuitem"]')).toHaveCount(0); // the menu hands focus back as it closes
  await page.keyboard.type(' more');

  await page.locator('.sc-var', { hasText: /Draft|Standard|High/ }).click(); // quality
  await page.locator('[role="menuitem"]').filter({ hasText: /High/ }).first().click();
  await expect(page.locator('[role="menuitem"]')).toHaveCount(0);
  await page.keyboard.type(' still');

  // the sentence never repainted, and the caret came back both times
  expect(await sentence(page)).toBe('a careful sentence more still');
  await expect(page.locator('.sc-var', { hasText: '9:16' })).toBeVisible();
});

test('copy and paste rebuilds the chips', async ({ page }) => {
  await page.keyboard.type('hero of ');
  await plusMenu(page, /product/i);
  await pickCard(page);
  await page.keyboard.type('at dusk');
  const original = await sentence(page);

  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('ControlOrMeta+c');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ControlOrMeta+v');

  await expect(chips(page)).toHaveCount(2);
  expect(await sentence(page)).toContain(original.trim());
});

test('a second look swaps in place instead of stacking', async ({ page }) => {
  await page.keyboard.type('mood: ');
  await plusMenu(page, /look/i);
  await pickCard(page, 0);
  await expect(chips(page)).toHaveCount(1);
  const first = await chips(page).first().textContent();

  await plusMenu(page, /look/i);
  await pickCard(page, 2);
  await expect(chips(page)).toHaveCount(1);
  expect(await chips(page).first().textContent()).not.toBe(first);
  expect(await sentence(page)).toMatch(/^mood: /); // it kept its slot
});

test('clicking a chip puts the caret beside it, never inside it', async ({ page }) => {
  await page.keyboard.type('AAAA ');
  await plusMenu(page, /product/i);
  await pickCard(page);
  await page.keyboard.type('BBBB');

  const box = (await chips(page).first().boundingBox())!;
  // the middle of the chip: the caret belongs after it, not in its label
  await page.mouse.click(box.x + box.width * 0.55, box.y + box.height / 2);
  await page.keyboard.press('Escape'); // the chip's own menu opened too
  expect(
    await page.evaluate(() => {
      const n = getSelection()?.anchorNode as Node | null;
      return !!n?.parentElement?.closest('.sc-token');
    }),
  ).toBe(false);
  await page.keyboard.type('X');
  expect(await sentence(page)).toMatch(/can\s*XBBBB$/);

  // and the left few pixels reach the caret in front of it
  const box2 = (await chips(page).first().boundingBox())!;
  await page.mouse.click(box2.x + 2, box2.y + box2.height / 2);
  await page.keyboard.type('Z');
  expect(await sentence(page)).toMatch(/^AAAA Z/);
});

test('clicking in the gap after a chip lands after it, not in front of it', async ({ page }) => {
  await page.keyboard.type('test ');
  await plusMenu(page, /product/i);
  await pickCard(page);
  await page.keyboard.type('sdfsdf sdf sdf');
  await page.keyboard.press('Escape');

  // The few pixels between a chip and the text after it: Chromium resolves
  // this point to the position BEFORE the chip, tens of pixels the other way,
  // which threw the caret back in front of the chip on every click.
  for (const dx of [2, 6, 10]) {
    const pt = await page.evaluate((d) => {
      const cr = document.querySelector('.sc-token')!.getBoundingClientRect();
      return { x: cr.right + (d as number), y: cr.top + cr.height / 2 };
    }, dx);
    await page.mouse.click(pt.x, pt.y);
    const side = await page.evaluate(() => {
      const r = getSelection()!.getRangeAt(0);
      const chip = document.querySelector('.sc-token')!;
      // DOCUMENT_POSITION_FOLLOWING means the caret's node comes after the chip
      return (chip.compareDocumentPosition(r.startContainer) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
    });
    expect(side, `click ${dx}px past the chip should land after it`).toBe(true);
  }

  // and back in the gap itself, typing lands immediately after the chip
  const gap = await page.evaluate(() => {
    const cr = document.querySelector('.sc-token')!.getBoundingClientRect();
    return { x: cr.right + 3, y: cr.top + cr.height / 2 };
  });
  await page.mouse.click(gap.x, gap.y);
  await page.keyboard.type('!');
  expect(await sentence(page)).toMatch(/can\s*!sdfsdf/);
});

test('every point in the card puts the caret where it was clicked', async ({ page }) => {
  await page.keyboard.type('test ');
  await plusMenu(page, /product/i);
  await pickCard(page);
  await page.keyboard.type('sdfsdf sdf sdf');
  await page.keyboard.press('Escape');

  /*
   * The whole card, not just the exact text row. Two things used to break here:
   * the line was a flex container, so the gaps between its items belonged to no
   * text node, and the card's padding was not part of the editable at all. A
   * click a few pixels off the text threw the caret to the front of the brief.
   */
  const points = await page.evaluate(() => {
    const card = document.querySelector('.sc-brief')!.getBoundingClientRect();
    const c = document.querySelector('.sc-token')!.getBoundingClientRect();
    const mid = c.top + c.height / 2;
    return {
      'gap after the chip': { x: c.right + 4, y: mid },
      'high in the row': { x: c.right + 4, y: c.top - 4 },
      'low in the row': { x: c.right + 4, y: c.bottom + 3 },
      'the padding above the text': { x: c.right + 4, y: card.top + 3 },
    };
  });

  for (const [label, pt] of Object.entries(points)) {
    await page.mouse.click(pt.x, pt.y);
    await page.keyboard.press('Escape');
    const after = await page.evaluate(() => {
      const r = getSelection()!.getRangeAt(0);
      const chip = document.querySelector('.sc-token')!;
      return (chip.compareDocumentPosition(r.startContainer) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
    });
    expect(after, `${label} should land after the chip`).toBe(true);
  }

  // and the empty stretch after the sentence means the end of it
  const far = await page.evaluate(() => {
    const card = document.querySelector('.sc-brief')!.getBoundingClientRect();
    const c = document.querySelector('.sc-token')!.getBoundingClientRect();
    return { x: card.right - 30, y: c.top + c.height / 2 };
  });
  await page.mouse.click(far.x, far.y);
  await page.keyboard.type('!');
  expect(await sentence(page)).toMatch(/sdf!$/);
});

test('clicking the body of a chip opens its own menu', async ({ page }) => {
  await page.keyboard.type('with ');
  await plusMenu(page, /product/i);
  await pickCard(page);
  await page.keyboard.press('Escape');
  const box = await chips(page).first().boundingBox();
  if (!box) throw new Error('no chip');
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.locator('.sc-cmd-row').first()).toBeVisible();
});
