import { test, expect, type Page } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { pinFor, startArchiveServer, storedZip } from '../../../packages/cli/test/archive-server.mjs';

/**
 * A first run's library, for real: a Scenri of this file's own downloads a
 * pinned archive by range from a server in this process, with no API mocked.
 * The repo's templates already carry every wall picture, so the fixture holds
 * what they lack (demo-product shots, presenter avatars) and the Products wall
 * is where the pictures are watched arriving. The packed build's own wall is
 * the cold-start helper's to prove (pnpm cold-start).
 *
 * Its own port in this lane's e2e band, clear of the workers (+0 to +3),
 * updates.spec's fixtures (+10 to +86) and activity-hardening's server (+90).
 */
const ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const PORT = Number(process.env.SCENRI_E2E_PORT ?? 4757) + 92;
const BASE = `http://127.0.0.1:${PORT}`;
test.describe.configure({ mode: 'serial' });

type Pinned = [string, number, number, number, number, string];
let bytes: Buffer;
let pin: { files: Pinned[] };
let pinFile = '';
let products: string[] = [];
let home = '';
let child: ChildProcess | null = null;

test.beforeAll(async () => {
  const templates = join(ROOT, 'templates');
  products = readdirSync(join(templates, 'demo-products'))
    .filter((f) => f.endsWith('.json'))
    .sort()
    .slice(0, 6)
    .map((f) => JSON.parse(readFileSync(join(templates, 'demo-products', f), 'utf8')).id as string);
  const presenters = readdirSync(join(templates, 'presenters'))
    .filter((f) => f.endsWith('.json'))
    .sort()
    .slice(0, 3)
    .map((f) => f.replace(/\.json$/, ''));
  // real, decodable pictures of a real size, so every derivative is cut for real
  const jpeg = (seed: number) =>
    sharp({
      create: {
        width: 400,
        height: 500,
        channels: 3,
        background: { r: (seed * 53) % 255, g: (seed * 97) % 255, b: (seed * 29) % 255 },
        noise: { type: 'gaussian', mean: 128, sigma: 24 },
      },
    })
      .jpeg({ quality: 70 })
      .toBuffer();
  const files: [string, Buffer][] = [['meta.json', Buffer.from('{"version":"e2e"}')]];
  let seed = 1;
  for (const id of products) {
    for (const angle of ['three-quarter', 'front'])
      files.push([`previews/demo-products/${id}/${angle}.jpg`, await jpeg(seed++)]);
  }
  for (const id of presenters) files.push([`previews/people/${id}/avatar.jpg`, await jpeg(seed++)]);
  bytes = storedZip(files);
  pin = await pinFor(bytes);
  pinFile = join(mkdtempSync(join(tmpdir(), 'sc-e2e-pin-')), 'pin.json');
  writeFileSync(pinFile, JSON.stringify(pin));
});

const version = async (): Promise<{ home?: string } | null> => {
  try {
    const res = await fetch(`${BASE}/api/version`);
    return res.ok ? ((await res.json()) as { home?: string }) : null;
  } catch {
    return null;
  }
};

async function boot(extra: Record<string, string>): Promise<void> {
  const env: Record<string, string | undefined> = {
    ...process.env,
    SCENRI_NO_OPEN: '1',
    SCENRI_HOST: '127.0.0.1',
    SCENRI_PORT: String(PORT),
    SCENRI_HOME: home,
    SCENRI_DEMO_ENGINE: '1',
    SCENRI_NO_UPDATE_CHECK: '1',
    SCENRI_NO_GUIDE: '1',
    SCENRI_NO_CODEX: '1',
    SCENRI_NO_DESKTOP: '1',
    OPENROUTER_API_KEY: '',
    REPLICATE_API_TOKEN: '',
    FAL_KEY: '',
    SCENRI_CONTENT_PIN: pinFile,
    ...extra,
  };
  delete env.SCENRI_NO_CONTENT_FETCH;
  child = spawn(process.execPath, ['--import', 'tsx', 'packages/cli/src/index.ts', 'serve'], {
    cwd: ROOT,
    stdio: 'ignore',
    env,
  });
  for (let i = 0; i < 150; i++) {
    if ((await version())?.home === home) return;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Scenri never answered on ${BASE} for ${home}`);
}

async function kill(): Promise<void> {
  const c = child;
  child = null;
  if (!c || c.exitCode !== null) return;
  const gone = new Promise<void>((r) => c.once('exit', () => r()));
  c.kill('SIGKILL');
  await gone;
  for (let i = 0; i < 50 && (await version()) !== null; i++) await new Promise((r) => setTimeout(r, 100));
}

async function brand(): Promise<{ id: string; slug: string }> {
  const res = await fetch(`${BASE}/api/brands`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ brand: { specVersion: '0.1', meta: { name: 'First Run' } } }),
  });
  return (await res.json()) as { id: string; slug: string };
}

const content = async (brandId: string) =>
  (
    (await (await fetch(`${BASE}/api/brands/${brandId}/activity`)).json()) as {
      content: { arriving: boolean; landed?: number; total?: number; outcome?: string | null };
    }
  ).content;

const card = (page: Page, id: string) =>
  page.locator('.sc-lookcard').filter({ has: page.locator(`a[href$="/products/${id}"]`) });

const fileOf = (name: string) => pin.files.find((f) => f[0] === name) as Pinned;
const requestsFor = (log: { start: number; end: number; status: number }[], name: string) => {
  const [, start, size] = fileOf(name);
  return log.filter((r) => r.status === 206 && r.start <= start && r.end >= start + size).length;
};

test.beforeEach(async ({ page }, testInfo) => {
  await page.bringToFront();
  testInfo.setTimeout(120_000);
  home = mkdtempSync(join(tmpdir(), 'sc-e2e-firstrun-'));
});
test.afterEach(async () => {
  await kill();
  rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

test('library pictures hold their place, arrive without a reload, and the bell counts them to the end', async ({
  page,
}) => {
  const archive = await startArchiveServer({ bytes, mbps: 0.6 });
  try {
    await boot({ SCENRI_CONTENT_URL: archive.url });
    const b = await brand();
    await page.goto(`${BASE}/${b.slug}/products`);
    // on their way: the held place, never the missing-picture glyph
    const first = card(page, products[0]);
    await expect(first.locator('.sc-lookcard-blank[data-waiting]')).toBeVisible({ timeout: 15_000 });
    expect(await page.locator('.sc-lookcard-blank:not([data-waiting])').count()).toBe(0);
    const waitingBox = await first.boundingBox();

    // one row in the bell, counting pictures
    await page.getByRole('button', { name: /^Activity/ }).click();
    await expect(page.getByText('Downloading the Scenri library')).toBeVisible();
    await expect(page.getByText(/^\d+ of \d+ pictures$/)).toBeVisible();
    await page.keyboard.press('Escape');

    // moving around while it runs neither restarts nor doubles it
    for (const name of ['Home', 'Places', 'Create', 'Products']) {
      await page.getByRole('link', { name, exact: true }).first().click();
      await page.waitForTimeout(400);
    }

    // the cards gain their pictures where they stand
    for (const id of products) await expect(card(page, id).locator('img[data-ready]')).toBeVisible({ timeout: 45_000 });
    const landedBox = await first.boundingBox();
    expect(Math.round(landedBox?.height ?? 0)).toBe(Math.round(waitingBox?.height ?? 0));
    expect(Math.round(landedBox?.width ?? 0)).toBe(Math.round(waitingBox?.width ?? 0));

    await expect.poll(async () => (await content(b.id)).outcome, { timeout: 30_000 }).toBe('complete');
    // one quiet notice, not an unread alert, and no toast about it
    await page.getByRole('button', { name: /^Activity/ }).click();
    await expect(page.getByText('Scenri library downloaded')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('button', { name: /^Activity, \d+ unread/ })).toHaveCount(0);
    expect(await page.locator('.sc-toast-wrap', { hasText: /library/i }).count()).toBe(0);

    // every file of the archive was asked for exactly once
    for (const [name] of pin.files) expect(requestsFor(archive.stats.log, name), name).toBe(1);
  } finally {
    await archive.close();
  }
});

test('a stop keeps what landed, and the next start fetches only the rest', async () => {
  const archive = await startArchiveServer({ bytes, mbps: 0.4 });
  try {
    await boot({ SCENRI_CONTENT_URL: archive.url });
    const b = await brand();
    await expect.poll(async () => (await content(b.id)).landed ?? 0, { timeout: 30_000 }).toBeGreaterThanOrEqual(3);
    await kill();
    const partial = join(home, 'content.partial');
    const kept = pin.files.map((f) => f[0]).filter((name) => existsSync(join(partial, ...name.split('/'))));
    expect(kept.length).toBeGreaterThanOrEqual(3);
    expect(kept.length).toBeLessThan(pin.files.length);
    const before = archive.stats.log.length;

    await boot({ SCENRI_CONTENT_URL: archive.url });
    await expect.poll(async () => (await content(b.id)).outcome, { timeout: 60_000 }).toBe('complete');
    const after = archive.stats.log.slice(before);
    for (const name of kept) expect(requestsFor(after, name), name).toBe(0);
  } finally {
    await archive.close();
  }
});

test('a picture that never arrives fails alone, and says so once, unread', async ({ page }) => {
  const [, start, size] = fileOf(`previews/demo-products/${products[1]}/three-quarter.jpg`);
  const archive = await startArchiveServer({ bytes, faults: [{ start, end: start + size, kind: '404' }] });
  try {
    await boot({ SCENRI_CONTENT_URL: archive.url, SCENRI_CONTENT_RETRY_MS: '500' });
    const b = await brand();
    await page.goto(`${BASE}/${b.slug}/products`);
    await expect.poll(async () => (await content(b.id)).outcome, { timeout: 90_000 }).toBe('partial');
    // the others arrived
    await expect(card(page, products[0]).locator('img[data-ready]')).toBeVisible({ timeout: 15_000 });
    // one unread notice that says what did not arrive and what happens next
    await expect(page.getByRole('button', { name: /^Activity, 1 unread/ })).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: /^Activity/ }).click();
    await expect(page.getByText('Scenri library partly downloaded')).toBeVisible();
    await expect(page.getByText('1 picture did not download. Scenri tries again when it next starts.')).toBeVisible();
    expect(await page.locator('.sc-toast-wrap', { hasText: /library/i }).count()).toBe(0);
  } finally {
    await archive.close();
  }
});
