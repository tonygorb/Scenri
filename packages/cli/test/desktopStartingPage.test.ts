import { describe, it, expect } from 'vitest';
import { serveStartingPage } from '../src/desktop/startingPage.js';

/**
 * The "Starting Scenri" page reaches the browser over loopback http, never as
 * a file: an http URL goes to the default browser on every OS, a file goes to
 * whatever owns .html. The server also answers the one question a file never
 * could: did a browser actually come and get the page.
 */

const HTML = '<!doctype html><meta name="scenri-studio" content="http://127.0.0.1:4747/"><!-- page -->';

describe('serveStartingPage', () => {
  it('serves the page once on a loopback port of its own and remembers who fetched it', async () => {
    const page = await serveStartingPage(HTML);
    try {
      expect(page.url).toMatch(/^http:\/\/127\.0\.0\.1:\d{2,5}\/$/);
      expect(page.wasFetched()).toBe(false);
      expect(page.userAgent()).toBeNull();
      const res = await fetch(page.url, { headers: { 'user-agent': 'TestBrowser/1.0' } });
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('text/html; charset=utf-8');
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect(await res.text()).toBe(HTML);
      expect(page.wasFetched()).toBe(true);
      expect(page.userAgent()).toBe('TestBrowser/1.0');
    } finally {
      page.close();
    }
  });

  it('answers nothing else, and a stray request does not count as the page being seen', async () => {
    const page = await serveStartingPage(HTML);
    try {
      const res = await fetch(`${page.url}favicon.ico`);
      expect(res.status).toBe(404);
      expect(page.wasFetched()).toBe(false);
    } finally {
      page.close();
    }
  });

  it('lets go of the port when closed', async () => {
    const page = await serveStartingPage(HTML);
    page.close();
    await expect(fetch(page.url)).rejects.toThrow();
  });
});
