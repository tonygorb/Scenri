import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, saveBrandOnUnload } from '../src/api.js';

const answer = () => new Response(JSON.stringify({ eligible: false }), { status: 200 });

describe('requests', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('a guide intent is handed to the browser to finish, so a reload in that instant keeps it', async () => {
    const fetch = vi.fn(async () => answer());
    vi.stubGlobal('fetch', fetch);
    await api.guideIntent({ reached: { task: 'product', moment: 'new' } });
    expect(fetch).toHaveBeenCalledWith('/api/guide', expect.objectContaining({ method: 'POST', keepalive: true }));
  });

  it('an ordinary request is not kept alive', async () => {
    const fetch = vi.fn(async () => answer());
    vi.stubGlobal('fetch', fetch);
    await api.guide();
    const init = (fetch.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(init.keepalive).toBeFalsy();
  });
  // LOAD-1: a kit save carried every owned presenter and scene, which the
  // server throws away for a keepAssets save. At about a thousand of them the
  // body passed the server's 1 MiB limit (413), and a leaving save rides a
  // keepalive request, which browsers cap at 64 KB.
  it('a kit save sends the kit alone, never the collections the server keeps', async () => {
    const fetch = vi.fn(async () => answer());
    vi.stubGlobal('fetch', fetch);
    const brand = {
      meta: { name: 'Harbor' },
      palette: { primary: { hex: '#000000' } },
      products: [{ id: 'p' }],
      scenes: [{ id: 's' }],
      characters: [{ id: 'c' }],
    };
    await api.updateBrand('b1', brand);
    await saveBrandOnUnload('b1', brand);
    for (const call of fetch.mock.calls as unknown as [string, RequestInit][]) {
      const body = JSON.parse(String(call[1].body));
      expect(body.keepAssets).toBe(true);
      expect(body.brand).toEqual({ meta: { name: 'Harbor' }, palette: { primary: { hex: '#000000' } } });
    }
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
