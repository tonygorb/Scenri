import { expect, type Page } from '@playwright/test';
import type { GuideView } from '../src/apiTypes.js';

/**
 * Shared steps for the first-use specs: a home that was new at its first boot,
 * a brand made the way a person makes it, the install's record read back, and
 * what the guide holds: a coach over the screen with working windows on the
 * step's surfaces, and a card that only points.
 */
export const coachCard = (p: Page) => p.locator('.sc-coach');
export const coachTitle = (p: Page) => p.locator('.sc-coach .sc-coach-title');
export const coachBody = (p: Page) => p.locator('.sc-coach .sc-coach-body');
export const welcome = (p: Page) => p.locator('.sc-welcome');
export const steps = (p: Page) => p.locator('.sc-steps');
export const brief = (p: Page) => p.locator('[data-guide="compose"] .sc-brief-line');
export const chips = (p: Page) => p.locator('[data-guide="compose"] .sc-brief-line .sc-token');

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

/** Nothing of the guide shows: wait out a settle of the page, then look. */
export async function expectNoGuide(p: Page): Promise<void> {
  await p.waitForTimeout(600);
  await expect(p.locator('.sc-coach, .sc-coach-veil')).toHaveCount(0);
}

/** One product, one presenter and one scene from the open picker, each ticked on the card as it lands. */
export async function pickOneOfEach(p: Page): Promise<void> {
  for (const kind of ['Product', 'Presenter', 'Scene']) {
    await p
      .locator('.sc-attachpanel')
      .getByRole('button', { name: new RegExp(`^${kind}: `) })
      .first()
      .click();
    await expect(p.locator('.sc-coach-item[data-done]', { hasText: kind })).toHaveCount(1);
  }
  await expect(coachTitle(p)).toHaveText("That's everything a shot needs");
}

/**
 * The card points at the real control: a press at the centre of the first
 * visible match lands inside it, and the card neither covers it, nor points
 * anywhere else, nor leaves the screen. Measured against the page's own boxes,
 * never pixels.
 */
export async function pointsAt(p: Page, selector: string): Promise<void> {
  await expect(coachCard(p)).toHaveAttribute('data-state', 'shown');
  const r = await p.evaluate((sel) => {
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
  }, selector);
  expect(r).toEqual({ inside: true, overlaps: false, arrowOnTarget: true, onScreen: true });
}

/** The page behind a coach is held: some of it is inert. */
export async function expectHeld(p: Page): Promise<void> {
  await expect.poll(() => p.locator('[data-sc-coach-inert]').count()).toBeGreaterThan(0);
}

/** Nothing a coach held is left behind. */
export async function expectLetGo(p: Page): Promise<void> {
  await expect(p.locator('[data-sc-coach-inert]')).toHaveCount(0);
}

/**
 * The three settings steps of the first shot, each done the way a person does
 * it: open the control, pick an answer (keeping the current one counts).
 */
export async function answerSettings(p: Page): Promise<void> {
  const steps: [string, string][] = [
    ['shape', 'Choose the shape'],
    ['count', 'Choose how many'],
    ['quality', 'Choose the size'],
  ];
  for (const [which, title] of steps) {
    await expect(coachTitle(p)).toHaveText(title);
    await p.locator(`[data-guide="compose.${which}"]`).click();
    await p.locator('.sc-setpop[data-state="open"] [role="radio"][aria-checked="true"]').first().click();
  }
  await expect(coachTitle(p)).toHaveText('Make it');
}

export async function isInert(p: Page, selector: string): Promise<boolean> {
  return p
    .locator(selector)
    .first()
    .evaluate((el) => !!el.closest('[inert]'));
}
