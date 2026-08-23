import { test, expect, type Page } from '@playwright/test';
import { isolate } from './harness.js';

/**
 * The providers pane, and the dialog it drills into.
 *
 * This is the one settings surface that writes a secret, so the parts worth a
 * real browser are: that a saved key changes the list without a reload, that it
 * survives reopening, that removing it puts the row back, and that the field is
 * never a place a key can be read out of again.
 *
 * The e2e server runs on its own port with its own SCENRI_HOME, so the keys
 * written here never touch the library you actually use.
 */

// A Scenri of this file's own, on an empty home, seeded from scratch.
isolate();

const api = async (p: Page, path: string, init?: RequestInit) =>
  p.evaluate(
    async ([u, i]) => {
      const r = await fetch(u as string, i as RequestInit);
      return r.json();
    },
    [path, init ?? undefined],
  );

/** The brand the app resolves "/" to, whatever this machine happens to hold. */
async function currentSlug(p: Page): Promise<string> {
  await p.goto('/');
  await p.waitForURL((u) => {
    const seg = u.pathname.split('/').filter(Boolean);
    return seg.length === 1 && seg[0] !== 'setup';
  });
  return decodeURIComponent(new URL(p.url()).pathname.split('/')[1]);
}

const openPane = async (p: Page) => {
  const slug = await currentSlug(p);
  await p.goto(`/${slug}?settings=engines`);
  await expect(p.locator('.sc-set')).toBeVisible();
  return slug;
};

/** One provider's row, found by the name a person reads rather than by index. */
const row = (p: Page, name: string) => p.locator('.sc-eng').filter({ has: p.getByText(name, { exact: true }) });

/** Leave no key behind: the home is reused across runs. */
const clearKey = (p: Page, field: string) =>
  api(p, '/api/settings', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ [field]: '' }),
  });

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await clearKey(page, 'openrouter_api_key');
});

test.afterEach(async ({ page }) => {
  await clearKey(page, 'openrouter_api_key');
});

test('the pane lists every provider with one action each', async ({ page }) => {
  await openPane(page);

  await expect(page.locator('.sc-set-head b')).toHaveText('Providers');

  // Every engine the server registered is a row, and Codex leads.
  const engines = (await api(page, '/api/engines')) as { id: string }[];
  await expect(page.locator('.sc-eng')).toHaveCount(engines.length);
  await expect(page.locator('.sc-eng').first()).toContainText('Codex CLI');

  // No row ever offers two things to click.
  for (const eng of await page.locator('.sc-eng').all()) {
    expect(await eng.locator('button').count()).toBeLessThanOrEqual(1);
  }

  // A pane about providers is not a form: no key field is on show.
  await expect(page.locator('.sc-set-scroll input')).toHaveCount(0);
});

test('a connected provider says so once, and an unconnected one says nothing', async ({ page }) => {
  await openPane(page);

  // The demo engine is always available on the e2e server, so it is the one
  // row whose connected state does not depend on this machine.
  const demo = row(page, 'Demo');
  await expect(demo.locator('.sc-stat')).toHaveText(/Connected/);
  await expect(demo).not.toContainText('Ready');

  const openrouter = row(page, 'OpenRouter');
  await expect(openrouter.locator('.sc-stat')).toHaveCount(0);
  await expect(openrouter.getByRole('button')).toHaveText('Connect');
  // The pane strips our billing word: the provider is called what it is called.
  await expect(openrouter).not.toContainText('BYOK');
});

test('connecting drills into a dialog over the pane, and closing returns to it', async ({ page }) => {
  const slug = await openPane(page);

  await row(page, 'OpenRouter').getByRole('button').click();
  await page.waitForURL(`**/${slug}?settings=engines&setup=openrouter`);

  // Both are open: the pane is still behind, so nothing was lost by drilling.
  await expect(page.locator('.sc-setup')).toBeVisible();
  await expect(page.locator('.sc-set')).toBeVisible();
  await expect(page.locator('.sc-setup-title')).toHaveText('Connect OpenRouter');

  await page.locator('.sc-setup .sc-set-close').click();
  await expect(page.locator('.sc-setup')).toHaveCount(0);
  await expect(page.locator('.sc-set')).toBeVisible();
  await page.waitForURL(`**/${slug}?settings=engines`);
});

test('a saved key updates the row immediately, and survives reopening', async ({ page }) => {
  const slug = await openPane(page);
  await row(page, 'OpenRouter').getByRole('button').click();

  const field = page.locator('.sc-setup-key input');
  // A secret is never rendered in the clear, here or anywhere.
  await expect(field).toHaveAttribute('type', 'password');
  await field.fill('sk-or-e2e-not-a-real-key');
  await page.locator('.sc-setup-key button[type="submit"]').click();

  // The dialog closes itself and the row behind it has already caught up.
  await expect(page.locator('.sc-setup')).toHaveCount(0);
  await expect(row(page, 'OpenRouter').locator('.sc-stat')).toHaveText(/Connected/);
  await expect(row(page, 'OpenRouter').getByRole('button')).toHaveText('Manage');

  // Reopened from cold, the state is the server's, not the page's.
  await page.goto(`/${slug}?settings=engines`);
  await expect(row(page, 'OpenRouter').locator('.sc-stat')).toHaveText(/Connected/);

  // And the key cannot be read back out of the field that saved it.
  await row(page, 'OpenRouter').getByRole('button').click();
  await expect(page.locator('.sc-setup-key input')).toHaveValue('');
  await expect(page.locator('.sc-setup-title')).toHaveText('OpenRouter key');
});

test('disconnecting removes the key and puts the row back', async ({ page }) => {
  await openPane(page);
  await row(page, 'OpenRouter').getByRole('button').click();
  await page.locator('.sc-setup-key input').fill('sk-or-e2e-not-a-real-key');
  await page.locator('.sc-setup-key button[type="submit"]').click();
  await expect(page.locator('.sc-setup')).toHaveCount(0);

  await row(page, 'OpenRouter').getByRole('button').click();
  await page.locator('.sc-setup-cut button').click();
  // Removing a key has no undo, so it asks first.
  await page.getByRole('button', { name: 'Disconnect', exact: true }).last().click();

  await expect(page.locator('.sc-setup')).toHaveCount(0);
  await expect(row(page, 'OpenRouter').getByRole('button')).toHaveText('Connect');
  await expect(row(page, 'OpenRouter').locator('.sc-stat')).toHaveCount(0);

  const present = (await api(page, '/api/settings')) as Record<string, boolean>;
  expect(present.openrouter_api_key).toBe(false);
});

test('a failed save is reported instead of being swallowed', async ({ page }) => {
  await openPane(page);
  await page.route('**/api/settings', (route) =>
    route.request().method() === 'PUT'
      ? route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"disk is full"}' })
      : route.continue(),
  );

  await row(page, 'OpenRouter').getByRole('button').click();
  await page.locator('.sc-setup-key input').fill('sk-or-e2e-not-a-real-key');
  await page.locator('.sc-setup-key button[type="submit"]').click();

  await expect(page.locator('.sc-setup-problem')).toContainText('disk is full');
  await expect(page.locator('.sc-setup')).toBeVisible();
});

test('the row stays readable at a phone width', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 760 });
  await openPane(page);

  // The status keeps its own column here too, rather than moving to the second
  // line and putting the same fact in two places depending on the width.
  await expect(row(page, 'Demo').locator('.sc-stat')).toBeVisible();

  // Every row is still one line tall, and the action is still a real target.
  const heights = await page.locator('.sc-eng').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
  // One line tall each, within a pixel: sub-pixel rounding differs between
  // rasterisers, so an exact match passes on macOS and fails on Linux CI for
  // reasons that have nothing to do with the layout being right.
  expect(Math.max(...heights) - Math.min(...heights)).toBeLessThanOrEqual(1);

  const act = row(page, 'OpenRouter').getByRole('button');
  expect((await act.boundingBox())!.height).toBeGreaterThanOrEqual(32);
});

test('a failed codex install shows the way out, and a recovered machine clears it', async ({ page }) => {
  const slug = await currentSlug(page);
  await page.route('**/api/engines/codex/status', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{"state":"not-installed"}' }),
  );
  let install = {
    ok: false,
    state: 'not-installed',
    fallbackCommand: 'sudo npm install -g @openai/codex',
    docsUrl: 'https://developers.openai.com/codex/cli',
    detail: 'npm needs your password to install into its system folder.',
  };
  await page.route('**/api/engines/codex/install', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(install) }),
  );

  await page.goto(`/${slug}?setup=codex-cli`);
  await page.getByRole('button', { name: 'Install Codex CLI' }).click();
  await expect(page.locator('.sc-setup-problem')).toContainText('password');
  await expect(page.locator('.sc-setup-cmd code')).toHaveText('sudo npm install -g @openai/codex');

  // The user ran the command in Terminal. npm still exits non-zero on the
  // retry, but the re-probe says the machine moved on, so the error must go.
  install = { ...install, state: 'ready', detail: 'npm error EACCES: permission denied' };
  await page.getByRole('button', { name: 'Install Codex CLI' }).click();
  await expect(page.locator('.sc-setup-body')).toContainText('Codex CLI is ready');
  await expect(page.locator('.sc-setup-problem')).toHaveCount(0);
});

test('an unverifiable codex never says Connected, and Check again is the way out', async ({ page }) => {
  const slug = await currentSlug(page);
  let status = { state: 'unverified', reason: 'Could not verify Codex on this computer', platform: 'windows' };
  await page.route('**/api/engines/codex/status', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(status) }),
  );

  await page.goto(`/${slug}?setup=codex-cli`);
  await expect(page.locator('.sc-setup-body')).toContainText('could not verify Codex');
  await expect(page.locator('.sc-setup-body')).toContainText('quit and reopen Scenri');
  await expect(page.locator('.sc-setup-body')).not.toContainText('Codex CLI is ready');

  // The machine came back; one press of Check again lands on ready.
  status = { state: 'ready', reason: '', platform: 'windows' };
  await page.getByRole('button', { name: 'Check again' }).click();
  await expect(page.locator('.sc-setup-body')).toContainText('Codex CLI is ready');
});

test('a codex below the version floor asks for an update, with PowerShell wording on Windows', async ({ page }) => {
  const slug = await currentSlug(page);
  await page.route('**/api/engines/codex/status', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        state: 'update-needed',
        reason: 'Codex CLI 0.140.0 is too old. Scenri needs 0.145.0 or newer.',
        platform: 'windows',
      }),
    }),
  );

  await page.goto(`/${slug}?setup=codex-cli`);
  await expect(page.locator('.sc-setup-body')).toContainText('too old for Scenri');
  await expect(page.locator('.sc-setup-cmd code')).toHaveText('npm install -g @openai/codex@latest');
  await expect(page.locator('.sc-setup-body')).toContainText('PowerShell');
  await expect(page.locator('.sc-setup-body')).not.toContainText('Codex CLI is ready');
});

test('the pane gives an unverified codex row a button and its reason, never a Connected dot', async ({ page }) => {
  await page.route('**/api/engines', async (route) => {
    const real = await (await route.fetch()).json();
    const doctored = real.map((e: { id: string }) =>
      e.id === 'codex-cli'
        ? { ...e, available: false, code: 'unverified', reason: 'Could not verify Codex on this computer' }
        : e,
    );
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(doctored) });
  });

  await openPane(page);
  const codex = row(page, 'Codex CLI');
  await expect(codex.getByRole('button', { name: /Set up/ })).toBeVisible();
  await expect(codex.locator('.sc-stat-why')).toContainText('Could not verify');
  await expect(codex.locator('.sc-stat:not(.sc-stat-why)')).toHaveCount(0);
});
