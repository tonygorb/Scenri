import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '../src/api.js';

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
});
