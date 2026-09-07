/**
 * The "Starting Scenri" page, served over loopback http by `scenri open` for
 * the seconds a cold start takes. An http URL lands in the default browser on
 * every OS; a file URL lands in whatever owns .html and, through Start-Process
 * or open(1), loses its fragment on the way. Serving it also answers the one
 * question a file never could: did a browser actually come and get the page.
 * Node builtins only, like everything the icon runs before the app is up.
 */
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface StartingServer {
  /** http://127.0.0.1:<port>/, the page's one address. */
  url: string;
  wasFetched(): boolean;
  userAgent(): string | null;
  close(): void;
}

export function serveStartingPage(html: string): Promise<StartingServer> {
  let fetched = false;
  let agent: string | null = null;
  const server = createServer((req, res) => {
    if ((req.method !== 'GET' && req.method !== 'HEAD') || req.url !== '/') {
      res.statusCode = 404;
      res.end();
      return;
    }
    fetched = true;
    const ua = req.headers['user-agent'];
    agent = typeof ua === 'string' ? ua : null;
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.setHeader('cache-control', 'no-store');
    res.end(html);
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${port}/`,
        wasFetched: () => fetched,
        userAgent: () => agent,
        close: () => {
          server.close();
          server.closeAllConnections();
        },
      });
    });
  });
}
