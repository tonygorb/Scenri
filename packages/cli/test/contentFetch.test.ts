import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CONTENT_PIN,
  CONTENT_SHA256,
  CONTENT_TAG,
  CONTENT_VERSION,
  createContentFetcher,
} from '../src/content/fetch.js';
import { installedContentRoot } from '../src/content/overlay.js';
import { pinFor, startArchiveServer, storedZip } from './archive-server.mjs';

const store = () => {
  const settings = new Map<string, string>();
  return {
    getSetting: (k: string) => settings.get(k) ?? null,
    setSetting: (k: string, v: string) => void settings.set(k, v),
  };
};

/** A host that answers every request with the whole archive, the way a plain file server or a proxy can. */
async function wholeOnly(body: Buffer) {
  const requests: (string | undefined)[] = [];
  const server = createServer((req, res) => {
    requests.push(req.headers.range);
    res.writeHead(200, { 'content-type': 'application/zip', 'content-length': String(body.length) });
    res.end(body);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/scenri-content.zip`,
    requests,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

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
    try {
      const fetcher = createContentFetcher({
        store: store(),
        url: `http://127.0.0.1:${(stalled.address() as AddressInfo).port}/scenri-content.zip`,
        env: { SCENRI_HOME: at },
        log: () => {},
        timeoutMs: 200,
      });
      const res = await fetcher.ensure();
      expect(res).toMatchObject({ ok: false, updated: false });
      expect(res.error).toBeTruthy();
      expect(installedContentRoot({ SCENRI_HOME: at })).toBeNull();
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

  it('takes its version, tag and sha256 from the pin, the one place they live', () => {
    expect(CONTENT_SHA256).toMatch(/^[a-f0-9]{64}$/);
    expect(CONTENT_SHA256).toBe(CONTENT_PIN.sha256);
    expect(CONTENT_VERSION).toBe(CONTENT_PIN.version);
    expect(CONTENT_TAG).toBe(`content-v${CONTENT_PIN.version}`);
  });

  /** The release asset can be replaced on GitHub; a build installs only the bytes it expects. */
  it('takes a host that ignores ranges whole, installs a matching archive file by file, and refuses one that does not match', async () => {
    const body = storedZip([
      ['meta.json', Buffer.from(JSON.stringify({ version: 3 }))],
      ['templates/one.json', Buffer.from('{}')],
    ]);
    const pin = await pinFor(body, 3);
    const host = await wholeOnly(body);
    try {
      const wrongHome = mkdtempSync(join(tmpdir(), 'scenri-pin-'));
      dirs.push(wrongHome);
      const wrong = {
        ...pin,
        files: pin.files.map(([name, at, packed, method, size, hash]) => [
          name,
          at,
          packed,
          method,
          size,
          name === 'templates/one.json' ? 'f'.repeat(64) : hash,
        ]),
      };
      const refused = await createContentFetcher({
        store: store(),
        url: host.url,
        env: { SCENRI_HOME: wrongHome },
        log: () => {},
        pin: wrong as typeof pin,
      }).ensure();
      expect(refused).toMatchObject({ ok: false, updated: false });
      expect(installedContentRoot({ SCENRI_HOME: wrongHome })).toBeNull();

      const rightHome = mkdtempSync(join(tmpdir(), 'scenri-pin-'));
      dirs.push(rightHome);
      const before = host.requests.length;
      const installed = await createContentFetcher({
        store: store(),
        url: host.url,
        env: { SCENRI_HOME: rightHome },
        log: () => {},
        pin,
      }).ensure();
      expect(installed).toMatchObject({ ok: true, updated: true });
      expect(installedContentRoot({ SCENRI_HOME: rightHome })).toBe(join(rightHome, 'content.partial'));
      expect(readFileSync(join(rightHome, 'content.partial', 'templates', 'one.json'), 'utf8')).toBe('{}');
      // the range it asked for came back whole, so it took the archive once and installed it from memory
      expect(host.requests.slice(before)).toEqual(['bytes=0-0', undefined]);
    } finally {
      await host.close();
    }
  });

  it('refuses a host serving another archive before fetching any of it', async () => {
    const body = storedZip([['meta.json', Buffer.from('{"version":3}')]]);
    const other = storedZip([
      ['meta.json', Buffer.from('{"version":3}')],
      ['extra.jpg', Buffer.from('another library')],
    ]);
    const host = await startArchiveServer({ bytes: other });
    const home = mkdtempSync(join(tmpdir(), 'scenri-other-'));
    dirs.push(home);
    try {
      const res = await createContentFetcher({
        store: store(),
        url: host.url,
        env: { SCENRI_HOME: home },
        log: () => {},
        pin: await pinFor(body, 3),
      }).ensure();
      expect(res).toMatchObject({ ok: false, updated: false });
      expect(res.error).toMatch(/SCENRI_CONTENT_PIN/);
      expect(host.stats.requests).toBe(1);
      expect(host.stats.whole).toBe(0);
      expect(existsSync(join(home, 'content.partial', 'extra.jpg'))).toBe(false);
    } finally {
      await host.close();
    }
  });
});

/**
 * What the studio is told while the library downloads. The attempt starts
 * right after listen and the studio asks at once, so "on its way" has to be
 * true before the attempt begins, or the studio heard "nothing coming" and
 * never looked again. A failed attempt must end it, or the cards would wait
 * for pictures that are not coming.
 */
describe('what the studio is told about the download', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it('says pictures are arriving before the attempt starts, and counts the install that lands them', async () => {
    const body = storedZip([['meta.json', Buffer.from(JSON.stringify({ version: 4 }))]]);
    const host = await wholeOnly(body);
    const home = mkdtempSync(join(tmpdir(), 'scenri-state-'));
    dirs.push(home);
    try {
      const fetcher = createContentFetcher({
        store: store(),
        url: host.url,
        env: { SCENRI_HOME: home },
        log: () => {},
        pin: await pinFor(body, 4),
      });
      expect(fetcher.state()).toMatchObject({ arriving: true, installs: 0 });
      const res = await fetcher.ensure();
      expect(res).toMatchObject({ ok: true, updated: true });
      expect(fetcher.state()).toMatchObject({ arriving: false, installs: 1 });
    } finally {
      await host.close();
    }
  });

  it('stops saying so once an attempt fails, so nothing waits for ever', async () => {
    const home = mkdtempSync(join(tmpdir(), 'scenri-state-'));
    dirs.push(home);
    const fetcher = createContentFetcher({
      store: store(),
      url: 'http://127.0.0.1:9/scenri-content.zip',
      env: { SCENRI_HOME: home },
      log: () => {},
      fetchImpl: (async () => {
        throw new Error('offline');
      }) as unknown as typeof fetch,
    });
    expect(fetcher.state().arriving).toBe(true);
    const res = await fetcher.ensure();
    expect(res.ok).toBe(false);
    expect(fetcher.state()).toMatchObject({ arriving: false, installs: 0 });
  });

  it('says nothing is arriving when the download is switched off', () => {
    const home = mkdtempSync(join(tmpdir(), 'scenri-state-'));
    dirs.push(home);
    const fetcher = createContentFetcher({
      store: store(),
      env: { SCENRI_HOME: home, SCENRI_NO_CONTENT_FETCH: '1' },
      log: () => {},
    });
    expect(fetcher.state()).toMatchObject({ arriving: false, installs: 0 });
  });
});
