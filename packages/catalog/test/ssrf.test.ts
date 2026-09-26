import { describe, it, expect } from 'vitest';
import { httpText } from '../src/http/fetch.js';

/**
 * A store address arrives in a request body, and every page it names can
 * redirect somewhere else. Both have to be checked.
 *
 * Without this, `POST /catalog/import {"url":"http://169.254.169.254/..."}`
 * made the server fetch the cloud metadata service and hand the contents
 * back, and a public domain redirecting there did the same thing more quietly.
 */
describe('where a crawl may go', () => {
  const ok = (body: string) => new Response(body, { status: 200, headers: { 'content-type': 'text/html' } });

  it('refuses an address that resolves to this machine', async () => {
    await expect(httpText('http://127.0.0.1/secrets', { retries: 0 })).rejects.toThrow();
  });

  it('refuses the cloud metadata address', async () => {
    await expect(httpText('http://169.254.169.254/latest/meta-data/', { retries: 0 })).rejects.toThrow();
  });

  it('refuses a private network address', async () => {
    for (const host of ['http://10.0.0.5/', 'http://192.168.1.1/', 'http://172.16.0.9/']) {
      await expect(httpText(host, { retries: 0 })).rejects.toThrow();
    }
  });

  it('refuses this machine written as an IPv6 address that carries it', async () => {
    const fetchImpl = (async () => ok('<html>secrets</html>')) as typeof fetch;
    // `new URL` hands the host on as [::ffff:7f00:1]
    await expect(httpText('http://[::ffff:127.0.0.1]/', { fetchImpl, retries: 0 })).rejects.toThrow(/private network/);
  });

  it('refuses a scheme that is not http', async () => {
    await expect(httpText('file:///etc/passwd', { retries: 0 })).rejects.toThrow(/http/i);
  });

  /**
   * The one `redirect: 'follow'` could never catch: undici follows the whole
   * chain internally, so only the first address was ever seen.
   */
  it('refuses a public address that redirects to a private one', async () => {
    const fetchImpl = (async (input: any) => {
      const url = String(input);
      if (url.includes('example.test')) {
        return new Response('', { status: 302, headers: { location: 'http://169.254.169.254/latest/meta-data/' } });
      }
      return ok('<html>secrets</html>');
    }) as typeof fetch;
    await expect(httpText('https://example.test/', { fetchImpl, retries: 0 })).rejects.toThrow();
  });

  it('lets a public address through, and reports where it ended up', async () => {
    const fetchImpl = (async (input: any) => {
      const url = String(input);
      if (url.endsWith('/start')) {
        return new Response('', { status: 301, headers: { location: 'https://example.com/finish' } });
      }
      return ok('<html>fine</html>');
    }) as typeof fetch;
    const res = await httpText('https://example.com/start', { fetchImpl, retries: 0 });
    expect(res.ok).toBe(true);
    expect(res.text).toContain('fine');
    // Callers resolve relative links against this.
    expect(res.url).toBe('https://example.com/finish');
  });

  it('still reports a refusal as a status, so a blocked API is recognised', async () => {
    const fetchImpl = (async () => new Response('no', { status: 403 })) as typeof fetch;
    const res = await httpText('https://example.com/products.json', { fetchImpl, retries: 0 });
    expect(res.ok).toBe(false);
    expect(res.status).toBe(403);
  });
});
