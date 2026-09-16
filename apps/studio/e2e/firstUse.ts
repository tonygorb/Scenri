import { expect, type Page } from '@playwright/test';

/**
 * Shared steps for the first-use specs: a home that was new at its first boot,
 * a brand made the way a person makes it, and the install's record read back.
 */
export const tourTitle = (p: Page) => p.locator('.sc-tour .sc-tour-title');
export const tourCard = (p: Page) => p.locator('.sc-tour');
export const welcome = (p: Page) => p.locator('.sc-welcome');

export async function learned(p: Page): Promise<string[]> {
  return ((await (await p.request.get('/api/guide')).json()) as { learned: string[] }).learned;
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

/** A page's tour never starts: wait out a settle of the page, then look. */
export async function expectNoTour(p: Page): Promise<void> {
  await p.waitForTimeout(600);
  await expect(tourCard(p)).toHaveCount(0);
}
