import { expect, type Page } from '@playwright/test';
import type { GuideView } from '../src/apiTypes.js';

/**
 * Shared steps for the first-use specs: a home that was new at its first boot,
 * a brand made the way a person makes it, the install's record read back, and
 * what the tutor holds: one card, one control usable, everything else waiting.
 */
export const coachCard = (p: Page) => p.locator('.sc-coach');
export const coachTitle = (p: Page) => p.locator('.sc-coach .sc-coach-title');
export const coachBody = (p: Page) => p.locator('.sc-coach .sc-coach-body');
export const welcome = (p: Page) => p.locator('.sc-welcome');
/** Learn's ghost button in the bar (from 1024px), the dialog it opens, and one lesson in it. */
export const learnButton = (p: Page) => p.locator('.sc-learn-btn');
export const learnDialog = (p: Page) =>
  p.getByRole('dialog').filter({ has: p.locator('.sc-learn-list, .sc-learn-lesson') });
export const lessonRow = (p: Page, title: string) => learnDialog(p).locator('.sc-learn-row', { hasText: title });
export const brief = (p: Page) => p.locator('[data-guide="compose"] .sc-brief-line');
export const chips = (p: Page) => p.locator('[data-guide="compose"] .sc-brief-line .sc-token');

/** Opens one lesson from the bar's Learn and takes its one action, the way a person does. */
export async function fromLearn(p: Page, title: string): Promise<void> {
  await learnButton(p).click();
  await lessonRow(p, title).click();
  // the one step that can be pressed carries the lesson's action
  await learnDialog(p).locator('button.sc-learn-step').click();
}

export async function guideRecord(p: Page): Promise<GuideView> {
  return (await (await p.request.get('/api/guide')).json()) as GuideView;
}

/** The welcome waits for a quiet page; in a test the rest is zero. */
export async function noWelcomeWait(p: Page): Promise<void> {
  await p.addInitScript(() => window.localStorage.setItem('scenri:welcome-settle-ms', '0'));
}

export async function setUpBrand(p: Page, name: string): Promise<string> {
  const slug = name.toLowerCase().replace(/\s+/g, '-');
  await p.goto('/');
  await p.waitForURL((u) => u.pathname === '/setup');
  await p.getByRole('button', { name: 'Start from scratch instead' }).click();
  await p.locator('#sc-wiz-name').fill(name);
  await p.getByRole('button', { name: 'Create it' }).click();
  await p.waitForURL((u) => u.pathname === `/${slug}`);
  return slug;
}

/** A brand of a test's own, with one guided task already in hand. */
export async function ownBrand(p: Page, name: string, task = 'first-shot'): Promise<string> {
  const made = await p.request.post('/api/brands', {
    data: { brand: { specVersion: '0.1', meta: { name }, products: [{ id: 'lamp', name: 'Ribbed lamp' }] } },
  });
  const { id } = (await made.json()) as { id: string };
  const brands = (await (await p.request.get('/api/brands')).json()) as { id: string; slug: string }[];
  await p.request.post('/api/guide', { data: { start: { task, brandId: id } } });
  return brands.find((b) => b.id === id)?.slug as string;
}

/** Nothing of the tutor shows: wait out a settle of the page, then look. */
export async function expectNoGuide(p: Page): Promise<void> {
  await p.waitForTimeout(600);
  await expect(p.locator('.sc-coach, .sc-coach-veil')).toHaveCount(0);
}

/**
 * Begun away from Create (the welcome, Learn), the first step is the way there:
 * Create in the places, lit, taken by hand. Arriving by it is the opening read.
 */
export async function walkToCreate(p: Page): Promise<void> {
  await expect(coachTitle(p)).toHaveText('Shots are made in Create', { timeout: 20_000 });
  await p.locator('[data-guide="nav.create"]:visible').first().click();
  await p.waitForURL('**/create**');
}

/** Any lesson's way there: the lit place in the bar, taken by hand. */
export async function walkTheWay(
  p: Page,
  nav: 'create' | 'products' | 'presenters' | 'scenes',
  title: string,
): Promise<void> {
  await expect(coachTitle(p)).toHaveText(title, { timeout: 20_000 });
  await p.locator(`[data-guide="nav.${nav}"]:visible`).first().click();
}

/** The library's own create button, once they have found the page. */
export async function startNew(p: Page, title: string): Promise<void> {
  await expect(coachTitle(p)).toHaveText(title, { timeout: 20_000 });
  await p.locator('[data-guide="library.new"]:visible').first().click();
}

/** Reads the opening and moves past it, the way anyone does. */
export async function readTheOpening(p: Page): Promise<void> {
  await expect(coachTitle(p)).toContainText('This is Create', { timeout: 20_000 });
  await coachCard(p).getByRole('button', { name: 'Start' }).click();
}

/** Picks the first tile of a kind in the open picker, the way a person does. */
export async function pickFromPicker(p: Page, kind: 'Product' | 'Presenter' | 'Scene'): Promise<void> {
  await p
    .locator('.sc-attachpanel')
    .getByRole('button', { name: new RegExp(`^${kind}: `) })
    .first()
    .click();
}

/** The three ingredients the first shot asks for, each picked where it is asked for. */
export async function pickTheIngredients(p: Page): Promise<void> {
  await expect(coachTitle(p)).toHaveText('Choose a product');
  await p.locator('[data-guide="compose.add"]').click();
  for (const kind of ['Product', 'Presenter', 'Scene'] as const) await pickFromPicker(p, kind);
  await expect(coachTitle(p)).toHaveText('Say how to shoot it, then make it');
}

/** Says how to shoot it and leaves the brief, which is what moves the tutor on. */
export async function sayTheWords(p: Page, words = 'on a worn table in late afternoon light'): Promise<void> {
  await expect.poll(() => p.evaluate(() => document.activeElement?.className ?? '')).toContain('sc-brief-line');
  await p.keyboard.type(words);
  await p.locator('[data-guide="compose.send"]').focus();
  await expect(coachTitle(p)).toHaveText('Say how to shoot it, then make it');
}

/**
 * The card points at the real control: a press at the centre of the first
 * visible match lands inside it, and the card neither covers it, nor points
 * anywhere else, nor leaves the screen. Measured against the page's own boxes,
 * never pixels.
 */
export async function pointsAt(p: Page, selector: string): Promise<void> {
  await expect(coachCard(p)).toHaveAttribute('data-state', 'shown');
  const measure = (sel: string) => {
    const el = [...document.querySelectorAll<HTMLElement>(sel)].find((e) => e.getClientRects().length > 0);
    const card = document.querySelector('.sc-coach');
    const arrow = document.querySelector<HTMLElement>('.sc-coach-arrow');
    if (!el || !card || !arrow) return null;
    const t = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const cx = Math.min(Math.max(t.left + t.width / 2, 1), vw - 1);
    const cy = Math.min(Math.max(t.top + Math.min(t.height, vh - t.top) / 2, 1), vh - 1);
    const hit = document.elementFromPoint(Math.round(cx), Math.round(cy));
    const c = card.getBoundingClientRect();
    const a = arrow.getBoundingClientRect();
    const overlaps = c.left < t.right && t.left < c.right && c.top < t.bottom && t.top < c.bottom;
    const side = card.getAttribute('data-side');
    const across = side === 'top' || side === 'bottom';
    const mid = across ? a.left + a.width / 2 : a.top + a.height / 2;
    const span = across ? [t.left, t.right] : [t.top, t.bottom];
    return {
      inside: !!hit && el.contains(hit),
      overlaps,
      arrowOnTarget: arrow.hidden || (mid >= span[0] - 1 && mid <= span[1] + 1),
      onScreen: c.left >= 0 && c.top >= 0 && c.right <= vw && c.bottom <= vh,
    };
  };
  await expect
    .poll(async () => await p.evaluate(measure, selector))
    .toEqual({
      inside: true,
      overlaps: false,
      arrowOnTarget: true,
      onScreen: true,
    });
}

/** The page behind an ask is held: some of it is inert. */
export async function expectHeld(p: Page): Promise<void> {
  await expect.poll(() => p.locator('[data-sc-coach-inert]').count()).toBeGreaterThan(0);
}

/** Nothing the tutor held is left behind. */
export async function expectLetGo(p: Page): Promise<void> {
  await expect(p.locator('[data-sc-coach-inert]')).toHaveCount(0);
}

export async function isInert(p: Page, selector: string): Promise<boolean> {
  return p
    .locator(selector)
    .first()
    .evaluate((el) => !!el.closest('[inert]'));
}
