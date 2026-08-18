import { expect, type APIRequestContext, type Page } from '@playwright/test';

/**
 * Shared plumbing for the visual-regression specs.
 *
 * Determinism is handled here, in the harness, never in the app:
 * - the clock is faked to a fixed date so relative-time labels and the usage
 *   heatmap stop moving between runs;
 * - Math.random is a seeded LCG so the first-run shelf shuffle is stable;
 * - the theme is written to localStorage before boot so headless Chromium's
 *   `prefers-color-scheme: light` never decides what gets captured.
 */

/** Fixed wall-clock for every capture. Never change once baselines exist. */
const FROZEN_TIME = new Date('2026-08-18T12:00:00');

export async function prep(page: Page, theme: 'dark' | 'light' = 'dark'): Promise<void> {
  await page.clock.install({ time: FROZEN_TIME });
  await page.addInitScript((t) => {
    localStorage.setItem('sc-theme', t);
    let s = 42;
    Math.random = () => {
      s = (s * 1664525 + 1013904223) % 4294967296;
      return s / 4294967296;
    };
  }, theme);
}

/**
 * Wait until the surface has genuinely finished drawing: fonts loaded, every
 * in-viewport image decoded, plus one short settle for the pieces that measure
 * themselves after layout (the assets rail, the tab-ink bar, the shelf).
 */
export async function settle(page: Page): Promise<void> {
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await page.waitForFunction(
    () => {
      const vh = window.innerHeight;
      const vw = window.innerWidth;
      return Array.from(document.images).every((img) => {
        const r = img.getBoundingClientRect();
        const visible = r.bottom > 0 && r.top < vh && r.right > 0 && r.left < vw && r.width > 0 && r.height > 0;
        return !visible || (img.complete && img.naturalWidth > 0);
      });
    },
    undefined,
    { timeout: 10_000 },
  );
  await page.waitForTimeout(300);
}

/** Settle, then compare against the golden baseline (or write it under --update-snapshots). */
export async function shot(page: Page, name: string): Promise<void> {
  await settle(page);
  await expect(page).toHaveScreenshot(`${name}.png`);
}

export type Discovered = {
  slug: string;
  shotId: string | null;
  productId: string | null;
  sceneId: string | null;
  presenterId: string | null;
};

/**
 * Real ids from the seeded fixture, so every URL is a real route — the same
 * discovery shape scripts/capture-mockups.mjs uses against the dev server.
 */
export async function discover(request: APIRequestContext): Promise<Discovered> {
  const get = async (path: string): Promise<Record<string, unknown>> => {
    const res = await request.get(path);
    if (!res.ok()) throw new Error(`${path} -> ${res.status()}`);
    return (await res.json()) as Record<string, unknown>;
  };

  const brandsBody = await get('/api/brands');
  const list = (Array.isArray(brandsBody) ? brandsBody : ((brandsBody.brands as unknown[]) ?? [])) as Array<{
    id: string;
    slug: string;
  }>;
  if (!list.length) throw new Error('no brands on the visual fixture server');
  const brand = list[0];

  const ws = (await get(`/api/brands/${brand.id}/workspace`).catch(() => ({}))) as {
    nodes?: Array<{ id: string; status?: string; images?: string[] }>;
  };
  const shotNode = (ws.nodes ?? []).find((n) => n.status === 'done' && (n.images?.length ?? 0) > 0) ?? null;

  const products = (await get(`/api/brands/${brand.id}/products-library`).catch(() => ({}))) as {
    products?: Array<{ id: string }>;
  };
  const scenes = (await get('/api/scenes').catch(() => ({}))) as { scenes?: Array<{ id: string }> };
  const presenters = (await get('/api/presenters').catch(() => ({}))) as { presenters?: Array<{ id: string }> };

  return {
    slug: brand.slug,
    shotId: shotNode?.id ?? null,
    productId: products.products?.[0]?.id ?? null,
    sceneId: scenes.scenes?.[0]?.id ?? null,
    presenterId: presenters.presenters?.[0]?.id ?? null,
  };
}
