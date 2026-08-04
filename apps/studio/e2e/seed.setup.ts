import { test as setup, expect, type APIRequestContext } from '@playwright/test';

/**
 * Everything composer.spec.ts needs, put there on purpose.
 *
 * The composer only exists once a brand exists: with an empty library the app
 * renders the brand wizard instead, and every spec times out waiting for
 * `.bt-brief-line`. This used to pass only on machines whose `~/.scenri`
 * already held the right data, which meant the suite could not be run by
 * anyone else and CI could not run it at all.
 *
 * Idempotent, so rerunning against a warm home costs one GET.
 */
const BRAND_NAME = 'E2E Fixture';

const FIXTURE = {
  specVersion: '0.1',
  meta: { name: BRAND_NAME },
  // Two specs assert on the chip's own label, which is the product name
  // verbatim, and anchor on it ending in "can" — composer.spec.ts:223 and
  // :264. Renaming this product breaks them.
  products: [{ id: 'cold-brew-can', name: 'Cold brew can' }],
  characters: [{ id: 'marco', name: 'Marco' }],
  palette: {
    primary: { hex: '#D96C3B', name: 'Terracotta' },
    secondary: { hex: '#1F2933', name: 'Ink' },
  },
};

/** Poll a node to a terminal status; the API answers 202 and works in the background. */
async function waitDone(request: APIRequestContext, nodeId: string, tries = 60) {
  for (let i = 0; i < tries; i++) {
    const node = await (await request.get(`/api/nodes/${nodeId}`)).json();
    if (node.status !== 'running') return node;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`node ${nodeId} never finished`);
}

setup('seed the fixture brand', async ({ request }) => {
  const brands = await (await request.get('/api/brands')).json();
  if (brands.some((b: { json?: { meta?: { name?: string } } }) => b.json?.meta?.name === BRAND_NAME)) return;

  const brandRes = await request.post('/api/brands', { data: { brand: FIXTURE } });
  expect(brandRes.ok(), await brandRes.text()).toBeTruthy();
  const brand = await brandRes.json();

  const projectRes = await request.post('/api/projects', { data: { brandId: brand.id, name: 'E2E' } });
  expect(projectRes.ok(), await projectRes.text()).toBeTruthy();
  const { project } = await projectRes.json();

  // One finished shot, so the plus menu has a "recent shot" to attach. The
  // demo engine ships registered by default, so this needs no keys and is free.
  const nodeRes = await request.post('/api/nodes', {
    data: {
      projectId: project.id,
      kind: 'generation',
      engineId: 'demo',
      count: 1,
      prompt: 'a reference shot',
      width: 512,
      height: 512,
    },
  });
  expect(nodeRes.status(), await nodeRes.text()).toBe(202);

  const node = await waitDone(request, (await nodeRes.json()).id);
  expect(node.status).toBe('done');
  expect(node.images.length).toBeGreaterThan(0);
});
