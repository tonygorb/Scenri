import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createContentFetcher } from '../src/content/fetch.js';

describe('downloading the archive', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  /**
   * The timeout used to stop at the headers: a server that sent them and then
   * went quiet held the download, and every later ensure() waiting on it, for
   * as long as the process lived.
   */
  it('gives up on an archive that stops arriving, and installs nothing', async () => {
    const stalled = createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/zip', 'content-length': '1000000' });
      res.write('PK');
    });
    await new Promise<void>((r) => stalled.listen(0, '127.0.0.1', r));
    const at = mkdtempSync(join(tmpdir(), 'scenri-stall-'));
    dirs.push(at);
    const settings = new Map<string, string>();
    try {
      const fetcher = createContentFetcher({
        store: { getSetting: (k) => settings.get(k) ?? null, setSetting: (k, v) => void settings.set(k, v) },
        url: `http://127.0.0.1:${(stalled.address() as AddressInfo).port}/scenri-content.zip`,
        env: { SCENRI_HOME: at },
        log: () => {},
        timeoutMs: 200,
      });
      const res = await fetcher.ensure();
      expect(res).toMatchObject({ ok: false, updated: false });
      expect(res.error).toBeTruthy();
      expect(existsSync(join(at, 'content'))).toBe(false);
    } finally {
      stalled.closeAllConnections();
      stalled.close();
    }
  }, 5000);
});
