import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import JSZip from 'jszip';
import { afterEach, describe, expect, it } from 'vitest';
import { archiveMatches, CONTENT_SHA256, createContentFetcher } from '../src/content/fetch.js';

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

describe('the archive this build was tested against', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it('pins the published archive by its sha256', () => {
    expect(CONTENT_SHA256).toMatch(/^[a-f0-9]{64}$/);
    const bytes = Buffer.from('an archive');
    expect(archiveMatches(bytes, createHash('sha256').update(bytes).digest('hex'))).toBe(true);
    expect(archiveMatches(Buffer.from('another archive'), createHash('sha256').update(bytes).digest('hex'))).toBe(
      false,
    );
  });

  /** The release asset can be replaced on GitHub; a build installs only the bytes it expects. */
  it('installs a matching archive and refuses one that does not match, leaving no library', async () => {
    const zip = new JSZip();
    zip.file('meta.json', JSON.stringify({ version: 3 }));
    zip.file('templates/one.json', '{}');
    const body = await zip.generateAsync({ type: 'nodebuffer' });
    const server = createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/zip', 'content-length': String(body.length) });
      res.end(body);
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/scenri-content.zip`;
    const store = () => {
      const settings = new Map<string, string>();
      return {
        getSetting: (k: string) => settings.get(k) ?? null,
        setSetting: (k: string, v: string) => void settings.set(k, v),
      };
    };
    try {
      const wrongHome = mkdtempSync(join(tmpdir(), 'scenri-pin-'));
      dirs.push(wrongHome);
      const refused = await createContentFetcher({
        store: store(),
        url,
        env: { SCENRI_HOME: wrongHome },
        log: () => {},
        sha256: 'f'.repeat(64),
      }).ensure();
      expect(refused).toMatchObject({ ok: false, updated: false });
      expect(existsSync(join(wrongHome, 'content', 'meta.json'))).toBe(false);

      const rightHome = mkdtempSync(join(tmpdir(), 'scenri-pin-'));
      dirs.push(rightHome);
      const sha = createHash('sha256').update(body).digest('hex');
      const installed = await createContentFetcher({
        store: store(),
        url,
        env: { SCENRI_HOME: rightHome },
        log: () => {},
        sha256: sha,
      }).ensure();
      expect(installed).toMatchObject({ ok: true, updated: true });
      expect(existsSync(join(rightHome, 'content', 'meta.json'))).toBe(true);
    } finally {
      server.close();
    }
  });
});
