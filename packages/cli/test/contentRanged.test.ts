import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import JSZip from 'jszip';
import { zipEntries } from '../scripts/zip-entries.mjs';
import { type ArchiveServerOptions, startArchiveServer } from './archive-server.mjs';
import { type ArchivePin, archiveFetch, installByRange, type PinnedFile } from '../src/content/ranged.js';
import {
  CONTENT_PIN,
  CONTENT_SHA256,
  CONTENT_VERSION,
  createContentFetcher,
  finishContentInstall,
} from '../src/content/fetch.js';
import {
  contentFile,
  contentPartialRoot,
  installedContentRoot,
  shownDirList,
  shownFile,
} from '../src/content/overlay.js';
import { homeFirst } from '../src/content/priority.js';
import { presenterAvatarPath } from '../src/presenters.js';

/**
 * The library by byte range: the pinned archive read a file at a time, the
 * files asked for first, each kept only when its own hash matches, one bad
 * file failing alone, and a stop resumed rather than restarted. Everything
 * against a real HTTP server answering ranges the way GitHub's release host
 * does (archive-server.mjs), over an archive built here and pinned the way
 * scripts/pin-content.mts pins the real one.
 */

const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

async function fixture(files: Record<string, Buffer>): Promise<{ bytes: Buffer; pin: ArchivePin }> {
  const zip = new JSZip();
  for (const [name, data] of Object.entries(files)) zip.file(name, data);
  const bytes = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  const pinned = zipEntries(bytes)
    .sort((a, b) => a.dataOffset - b.dataOffset)
    .map((e): PinnedFile => {
      const packed = bytes.subarray(e.dataOffset, e.dataOffset + e.compressedSize);
      const data = e.method === 8 ? inflateRawSync(packed) : packed;
      return [e.name, e.dataOffset, e.compressedSize, e.method, e.size, sha(data)];
    });
  return { bytes, pin: { version: 9, sha256: sha(bytes), size: bytes.length, files: pinned } };
}

const picture = () => randomBytes(20_000 + Math.floor(Math.random() * 5000));
const LIBRARY = () => ({
  'meta.json': Buffer.from('{"version":9}'),
  'demo-products/mug.json': Buffer.from('{"id":"mug"}'),
  'previews/showcase/a.jpg': picture(),
  'previews/showcase/b.jpg': picture(),
  'previews/showcase/c.jpg': picture(),
  'previews/showcase/d.jpg': picture(),
  'previews/presenters/ana/avatar.jpg': picture(),
  'previews/presenters/ana/front.jpg': picture(),
  'previews/scene-one/ref-01.jpg': picture(),
  'previews/scene-one/ref-02.jpg': picture(),
});

let dir: string;
let partial: string;
const closers: (() => Promise<void>)[] = [];
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sc-ranged-'));
  partial = join(dir, 'content.partial');
});
afterEach(async () => {
  for (const close of closers.splice(0)) await close();
  rmSync(dir, { recursive: true, force: true });
});

async function serve(bytes: Buffer, extra: Omit<ArchiveServerOptions, 'bytes'> = {}) {
  const s = await startArchiveServer({ bytes, ...extra });
  closers.push(s.close);
  return s;
}

const base = (url: string, pin: ArchivePin) => ({
  url,
  pin,
  partial,
  order: [] as string[],
  fetchImpl: fetch,
  signal: new AbortController().signal,
  concurrency: 2,
  capBytes: 1,
  idleMs: 3000,
  backoffMs: [5, 5, 5, 5],
  onLanded: () => {},
});
const onDisk = (name: string) => join(partial, ...name.split('/'));
const spanOf = (pin: ArchivePin, name: string) => {
  const f = pin.files.find((x) => x[0] === name) as PinnedFile;
  return { start: f[1], end: f[1] + f[2] };
};
const requestsFor = (log: { start: number; end: number; status: number }[], span: { start: number; end: number }) =>
  log.filter((r) => r.status === 206 && r.start <= span.start && r.end >= span.end).length;

describe('installing by range', () => {
  it('fetches every file once, the ones asked for first, never more than K at a time, and meta.json last', async () => {
    const { bytes, pin } = await fixture(LIBRARY());
    const s = await serve(bytes);
    const landed: string[] = [];
    const result = await installByRange({
      ...base(s.url, pin),
      concurrency: 1,
      order: ['previews/showcase/c.jpg', 'previews/showcase/a.jpg'],
      onLanded: (f) => landed.push(f[0]),
    });
    expect(result).toEqual({ kind: 'complete' });
    for (const [name, , , , , hash] of pin.files) expect(sha(readFileSync(onDisk(name)))).toBe(hash);
    // after the one-byte probe, the first two reads are the two asked for, in that order
    const reads = s.stats.log.filter((r) => r.end - r.start > 1);
    expect(reads[0].start).toBe(spanOf(pin, 'previews/showcase/c.jpg').start);
    expect(reads[1].start).toBe(spanOf(pin, 'previews/showcase/a.jpg').start);
    expect(landed.at(-1)).toBe('meta.json');
    for (const [name] of pin.files) expect(requestsFor(s.stats.log, spanOf(pin, name))).toBe(1);
  });

  it('never has more than K reads in flight', async () => {
    const { bytes, pin } = await fixture(LIBRARY());
    const s = await serve(bytes, { mbps: 20 });
    expect(await installByRange({ ...base(s.url, pin), concurrency: 3 })).toEqual({ kind: 'complete' });
    expect(s.stats.peak).toBeGreaterThan(1);
    expect(s.stats.peak).toBeLessThanOrEqual(3);
  });

  it('merges neighbours into one read up to the cap', async () => {
    const { bytes, pin } = await fixture(LIBRARY());
    const s = await serve(bytes);
    const result = await installByRange({ ...base(s.url, pin), capBytes: 1 << 20 });
    expect(result).toEqual({ kind: 'complete' });
    // one probe, one read for everything but meta.json, one for meta.json
    expect(s.stats.ranges).toBe(3);
  });

  it('keeps what landed and fetches only what is missing after a stop, clearing what it cannot trust', async () => {
    const { bytes, pin } = await fixture(LIBRARY());
    const first = await serve(bytes);
    const stop = new AbortController();
    let n = 0;
    const cut = await installByRange({
      ...base(first.url, pin),
      concurrency: 1,
      signal: stop.signal,
      onLanded: () => {
        if (++n === 3) stop.abort();
      },
    });
    expect(cut.kind).toBe('partial');
    expect(existsSync(onDisk('meta.json'))).toBe(false);
    const landedFirst = pin.files.filter((f) => existsSync(onDisk(f[0]))).map((f) => f[0]);
    expect(landedFirst.length).toBeGreaterThanOrEqual(3);
    // what a stop or another build can leave behind
    writeFileSync(`${onDisk(landedFirst[0])}`, 'not the picture');
    writeFileSync(`${onDisk('previews/showcase/d.jpg')}.part`, 'half');
    mkdirSync(join(partial, 'stray'), { recursive: true });
    writeFileSync(join(partial, 'stray', 'old.jpg'), 'from another version');

    const second = await serve(bytes);
    const landedAgain: string[] = [];
    const done = await installByRange({ ...base(second.url, pin), onLanded: (f) => landedAgain.push(f[0]) });
    expect(done).toEqual({ kind: 'complete' });
    // what was kept is counted first, as it is checked, so a restart's count starts from it
    expect(landedAgain.slice(0, landedFirst.length - 1).sort()).toEqual(landedFirst.slice(1).sort());
    expect(existsSync(`${onDisk('previews/showcase/d.jpg')}.part`)).toBe(false);
    expect(existsSync(join(partial, 'stray', 'old.jpg'))).toBe(false);
    for (const [name, , , , , hash] of pin.files) expect(sha(readFileSync(onDisk(name)))).toBe(hash);
    // the tampered one was fetched again; the other files that had landed were not
    expect(requestsFor(second.stats.log, spanOf(pin, landedFirst[0]))).toBe(1);
    for (const name of landedFirst.slice(1)) expect(requestsFor(second.stats.log, spanOf(pin, name))).toBe(0);
  });

  it.each(['404', 'reset', 'short', 'corrupt'])(
    'a file answering %s fails alone, after a bounded few tries',
    async (kind) => {
      const { bytes, pin } = await fixture(LIBRARY());
      const bad = spanOf(pin, 'previews/showcase/b.jpg');
      const s = await serve(bytes, { faults: [{ ...bad, kind }] });
      const result = await installByRange({ ...base(s.url, pin), concurrency: 3 });
      expect(result.kind).toBe('partial');
      const missing = result.kind === 'partial' ? result.missing.map((f) => f[0]).sort() : [];
      expect(missing).toEqual(['meta.json', 'previews/showcase/b.jpg']);
      for (const [name, , , , , hash] of pin.files) {
        if (!missing.includes(name)) expect(sha(readFileSync(onDisk(name)))).toBe(hash);
      }
      expect(existsSync(onDisk('previews/showcase/b.jpg'))).toBe(false);
      const tries = s.stats.log.filter((r) => r.start <= bad.start && r.end >= bad.end).length;
      expect(tries).toBeLessThanOrEqual(5);
    },
  );

  it('a failing file in a read shared with its neighbours still fails alone', async () => {
    const { bytes, pin } = await fixture(LIBRARY());
    const bad = spanOf(pin, 'previews/showcase/b.jpg');
    const s = await serve(bytes, { faults: [{ ...bad, kind: 'reset' }] });
    const result = await installByRange({ ...base(s.url, pin), capBytes: 1 << 20 });
    const missing = result.kind === 'partial' ? result.missing.map((f) => f[0]).sort() : [];
    expect(missing).toEqual(['meta.json', 'previews/showcase/b.jpg']);
  });

  it('a file failing once lands on the next try', async () => {
    const { bytes, pin } = await fixture(LIBRARY());
    const s = await serve(bytes, { faults: [{ ...spanOf(pin, 'previews/showcase/b.jpg'), kind: 'reset', times: 1 }] });
    expect(await installByRange(base(s.url, pin))).toEqual({ kind: 'complete' });
  });

  it('with no network at all the pass ends instead of walking every file through its backoff', async () => {
    const { bytes, pin } = await fixture(LIBRARY());
    // everything but the probe's first byte resets
    const s = await serve(bytes, { faults: [{ start: 1, end: bytes.length, kind: 'reset' }] });
    const result = await installByRange({ ...base(s.url, pin), backoffMs: [50, 50, 50, 50] });
    expect(result.kind).toBe('partial');
    // 3 x K network failures in a row end it: far fewer than 5 tries for each of 10 files
    expect(s.stats.ranges).toBeLessThanOrEqual(1 + 3 * 2 + 2);
  });

  it('leaves a host that does not answer ranges to be taken whole', async () => {
    const { bytes, pin } = await fixture(LIBRARY());
    const plain = createServer((_req, res) => res.end(bytes));
    await new Promise<void>((r) => plain.listen(0, '127.0.0.1', r));
    closers.push(() => new Promise((r) => plain.close(() => r())));
    const url = `http://127.0.0.1:${(plain.address() as { port: number }).port}/a.zip`;
    expect(await installByRange(base(url, pin))).toEqual({ kind: 'unranged' });
    expect(existsSync(onDisk('meta.json'))).toBe(false);
  });

  it('a read cut short keeps every file that fully arrived, and fetches only the rest', async () => {
    const { bytes, pin } = await fixture(LIBRARY());
    const cutAt = spanOf(pin, 'previews/showcase/c.jpg').start + 10;
    // one merged read for everything but meta.json, its body ending once in the middle of c.jpg
    const s = await serve(bytes, { faults: [{ start: cutAt, end: cutAt + 1, kind: 'short', times: 1 }] });
    expect(await installByRange({ ...base(s.url, pin), capBytes: 1 << 20 })).toEqual({ kind: 'complete' });
    for (const [name, at, packed, , , hash] of pin.files) {
      expect(sha(readFileSync(onDisk(name)))).toBe(hash);
      if (name === 'meta.json') continue;
      // the files wholly before the cut landed from the first read and were never asked for again
      expect(requestsFor(s.stats.log, spanOf(pin, name)), name).toBe(at + packed <= cutAt ? 1 : 2);
    }
  });

  it('copies what the package already carries byte for byte, instead of fetching it', async () => {
    const files = LIBRARY();
    const { bytes, pin } = await fixture(files);
    const seed = join(dir, 'templates');
    // the package carries a record and a picture as they are, and another picture in a cut of its own
    const carried: [string, Buffer][] = [
      ['demo-products/mug.json', files['demo-products/mug.json']],
      ['previews/showcase/a.jpg', files['previews/showcase/a.jpg']],
      ['previews/showcase/b.jpg', Buffer.from('a smaller cut')],
    ];
    for (const [name, data] of carried) {
      mkdirSync(dirname(join(seed, name)), { recursive: true });
      writeFileSync(join(seed, name), data);
    }
    const s = await serve(bytes);
    const landed: string[] = [];
    const result = await installByRange({ ...base(s.url, pin), seed, onLanded: (f) => landed.push(f[0]) });
    expect(result).toEqual({ kind: 'complete' });
    for (const [name, , , , , hash] of pin.files) expect(sha(readFileSync(onDisk(name)))).toBe(hash);
    expect(requestsFor(s.stats.log, spanOf(pin, 'demo-products/mug.json'))).toBe(0);
    expect(requestsFor(s.stats.log, spanOf(pin, 'previews/showcase/a.jpg'))).toBe(0);
    expect(requestsFor(s.stats.log, spanOf(pin, 'previews/showcase/b.jpg'))).toBe(1);
    // and they count as landed, so the count the bell shows is the truth
    expect(landed).toEqual(expect.arrayContaining(['demo-products/mug.json', 'previews/showcase/a.jpg']));
  });

  it('refuses a host serving an archive of another size after its one-byte probe', async () => {
    const { bytes, pin } = await fixture(LIBRARY());
    const s = await serve(Buffer.concat([bytes, Buffer.from('more')]));
    expect(await installByRange(base(s.url, pin))).toEqual({ kind: 'mismatch', size: bytes.length + 4 });
    expect(s.stats.requests).toBe(1);
  });

  it('installs an archive already in memory the same way, file by file', async () => {
    const { bytes, pin } = await fixture(LIBRARY());
    const landed: string[] = [];
    const result = await installByRange({
      ...base('archive:', pin),
      fetchImpl: archiveFetch(bytes),
      capBytes: 1 << 20,
      onLanded: (f) => landed.push(f[0]),
    });
    expect(result).toEqual({ kind: 'complete' });
    for (const [name, , , , , hash] of pin.files) expect(sha(readFileSync(onDisk(name)))).toBe(hash);
    expect(landed.at(-1)).toBe('meta.json');
  });

  it('refuses an answer for a range it did not ask for, before reading it', async () => {
    const { bytes, pin } = await fixture(LIBRARY());
    // answers the probe honestly, then every read with the archive's first bytes
    const liar = createServer((req, res) => {
      const [a] = /bytes=(\d+)-(\d+)/
        .exec(req.headers.range ?? '')
        ?.slice(1)
        .map(Number) ?? [0];
      res.statusCode = 206;
      res.setHeader('content-range', a === 0 ? `bytes 0-0/${bytes.length}` : `bytes 0-99/${bytes.length}`);
      res.end(a === 0 ? bytes.subarray(0, 1) : bytes.subarray(0, 100));
    });
    await new Promise<void>((r) => liar.listen(0, '127.0.0.1', r));
    closers.push(() => new Promise((r) => liar.close(() => r())));
    const url = `http://127.0.0.1:${(liar.address() as { port: number }).port}/a.zip`;
    const result = await installByRange(base(url, pin));
    expect(result.kind).toBe('partial');
    expect(pin.files.some((f) => existsSync(onDisk(f[0])))).toBe(false);
  });
});

describe('the fetcher around it', () => {
  let home: string;
  beforeEach(() => {
    home = join(dir, 'home');
    mkdirSync(home);
  });
  const settings = () => {
    const s = new Map<string, string>();
    return { getSetting: (k: string) => s.get(k) ?? null, setSetting: (k: string, v: string) => void s.set(k, v) };
  };

  it('counts pictures as they land and says how the run ended', async () => {
    const { bytes, pin } = await fixture(LIBRARY());
    const s = await serve(bytes);
    const f = createContentFetcher({
      store: settings(),
      url: s.url,
      env: { SCENRI_HOME: home },
      log: () => {},
      pin,
      concurrency: 2,
      backoffMs: [5, 5, 5, 5],
    });
    const pictures = pin.files.filter((x) => x[0].endsWith('.jpg')).length;
    expect(f.state()).toMatchObject({ arriving: true, landed: 0, total: pictures, outcome: null, installs: 0 });
    const result = await f.ensure();
    expect(result).toMatchObject({ ok: true, updated: true });
    expect(f.state()).toMatchObject({
      arriving: false,
      landed: pictures,
      total: pictures,
      outcome: 'complete',
      installs: 1,
      failed: 0,
    });
    expect(f.state().bytes).toBe(f.state().totalBytes);
    expect(f.state().startedAt).toMatch(/^\d{4}-/);
    // whole, it is the installed library until the next start moves it into place
    expect(installedContentRoot({ SCENRI_HOME: home })).toBe(contentPartialRoot({ SCENRI_HOME: home }));
  });

  it('says plainly what did not arrive, and a second pass later picks it up', async () => {
    const { bytes, pin } = await fixture(LIBRARY());
    // fails through the whole first pass (five tries), then is fine
    const s = await serve(bytes, { faults: [{ ...spanOf(pin, 'previews/showcase/b.jpg'), kind: '404', times: 5 }] });
    const f = createContentFetcher({
      store: settings(),
      url: s.url,
      env: { SCENRI_HOME: home },
      log: () => {},
      pin,
      concurrency: 2,
      backoffMs: [5, 5, 5, 5],
      retryWaitsMs: [20],
    });
    expect(await f.ensure()).toMatchObject({ ok: true });
    expect(f.state()).toMatchObject({ outcome: 'complete', arriving: false });

    const t = await serve(bytes, { faults: [{ ...spanOf(pin, 'previews/showcase/b.jpg'), kind: '404' }] });
    const g = createContentFetcher({
      store: settings(),
      url: t.url,
      env: { SCENRI_HOME: join(dir, 'other') },
      log: () => {},
      pin,
      concurrency: 2,
      backoffMs: [5, 5, 5, 5],
      retryWaitsMs: [20],
    });
    mkdirSync(join(dir, 'other'));
    expect(await g.ensure()).toMatchObject({ ok: false });
    expect(g.state()).toMatchObject({ outcome: 'partial', failed: 1, arriving: false });
  });

  it('after a dropped connection, the one more pass starts once the host answers again', async () => {
    const { bytes, pin } = await fixture(LIBRARY());
    // the network goes for 800 ms, 300 ms in, while the library is still coming
    const s = await serve(bytes, { mbps: 0.5, cut: { afterMs: 300, forMs: 800 } });
    const f = createContentFetcher({
      store: settings(),
      url: s.url,
      env: { SCENRI_HOME: home },
      log: () => {},
      pin,
      concurrency: 2,
      capBytes: 1,
      backoffMs: [5, 5, 5, 5],
      // asked every 100 ms: one wait that short would retry into the outage and end partial
      retryWaitsMs: Array(40).fill(100),
    });
    expect(await f.ensure()).toMatchObject({ ok: true });
    expect(f.state()).toMatchObject({ outcome: 'complete', failed: 0 });
  }, 20_000);

  it('a stop keeps what landed, and the next start resumes', async () => {
    const { bytes, pin } = await fixture(LIBRARY());
    const s = await serve(bytes, { mbps: 1 });
    // one file per read, so they land one at a time
    const opts = {
      url: s.url,
      env: { SCENRI_HOME: home },
      log: () => {},
      pin,
      concurrency: 1,
      capBytes: 1,
      backoffMs: [5],
    };
    const f = createContentFetcher({ store: settings(), ...opts });
    void f.ensure();
    await expect.poll(() => f.state().landed, { timeout: 10_000, interval: 20 }).toBeGreaterThanOrEqual(2);
    await f.settle();
    const kept = pin.files.filter((x) => existsSync(join(contentPartialRoot(opts.env), ...x[0].split('/'))));
    expect(kept.length).toBeGreaterThan(0);
    expect(kept.length).toBeLessThan(pin.files.length);
    const g = createContentFetcher({ store: settings(), ...opts, url: (await serve(bytes)).url });
    expect(await g.ensure()).toMatchObject({ ok: true });
    expect(g.state().landed).toBe(pin.files.filter((x) => x[0].endsWith('.jpg')).length);
  });
});

describe('where library files are read from', () => {
  let templates: string;
  let home: string;
  let was: string | undefined;
  beforeEach(() => {
    templates = join(dir, 'templates');
    home = join(dir, 'home');
    mkdirSync(join(templates, 'previews', 'presenters'), { recursive: true });
    mkdirSync(join(home, 'content.partial', 'previews', 'presenters', 'ana'), { recursive: true });
    writeFileSync(join(home, 'content.partial', 'previews', 'presenters', 'ana', 'avatar.jpg'), 'arrived');
    was = process.env.SCENRI_HOME;
    process.env.SCENRI_HOME = home;
  });
  afterEach(() => {
    if (was === undefined) delete process.env.SCENRI_HOME;
    else process.env.SCENRI_HOME = was;
  });

  it('shows a picture the moment it arrives, and never draws from a library that is not whole', () => {
    const arrived = join(home, 'content.partial', 'previews', 'presenters', 'ana', 'avatar.jpg');
    expect(shownFile(templates, 'previews', 'presenters', 'ana', 'avatar.jpg')).toBe(arrived);
    expect(shownDirList(templates, 'previews', 'presenters', 'ana')).toEqual(['avatar.jpg']);
    // generation, and the scene-examples gate, read only a whole library
    expect(contentFile(templates, 'previews', 'presenters', 'ana', 'avatar.jpg')).not.toBe(arrived);
    expect(existsSync(presenterAvatarPath(templates, 'ana'))).toBe(false);
    expect(installedContentRoot()).toBeNull();
    // whole (meta.json is written last), it is the library for everything
    writeFileSync(join(home, 'content.partial', 'meta.json'), '{"version":9}');
    expect(contentFile(templates, 'previews', 'presenters', 'ana', 'avatar.jpg')).toBe(arrived);
  });

  it('moves a whole download into place at start, and never deletes through a linked cache', () => {
    const primary = join(dir, 'primary-content');
    mkdirSync(primary);
    writeFileSync(join(primary, 'meta.json'), '{"version":3}');
    symlinkSync(primary, join(home, 'content'));
    expect(finishContentInstall({ SCENRI_HOME: home })).toBe('none');
    writeFileSync(join(home, 'content.partial', 'meta.json'), '{"version":9}');
    expect(finishContentInstall({ SCENRI_HOME: home })).toBe('moved');
    expect(readFileSync(join(home, 'content', 'meta.json'), 'utf8')).toContain('9');
    expect(existsSync(join(home, 'content.partial'))).toBe(false);
    // the lane's link went; what it pointed at did not
    expect(readFileSync(join(primary, 'meta.json'), 'utf8')).toContain('3');
    expect(realpathSync(join(home, 'content'))).not.toBe(realpathSync(primary));
  });
});

describe('the order Home asks for', () => {
  it('walks the wall in its order, then the pages the library opens on, skipping what the package carries', () => {
    const templates = join(dir, 'templates');
    mkdirSync(join(templates, 'previews', 'showcase'), { recursive: true });
    writeFileSync(join(templates, 'previews', 'showcase', 'first.jpg'), 'bundled');
    const tile = (id: string, tokens: unknown[]) => ({ id, brief: { tokens } }) as never;
    const order = homeFirst({
      templatesRoot: templates,
      showcase: [
        tile('first', [{ t: 'product', id: 'mug' }]),
        tile('second', [
          { t: 'character', id: 'ana' },
          { t: 'product', id: 'mug' },
        ]),
      ],
      demoProducts: [{ id: 'mug', category: 'fragrance' } as never],
      presenters: [{ id: 'ana' }],
      scenes: [{ id: 'garden', cover: 'hero' } as never],
    });
    expect(order[0]).toBe('previews/demo-products/mug/three-quarter.jpg');
    expect(order).not.toContain('previews/showcase/first.jpg');
    expect(order.slice(1, 3)).toEqual(['previews/showcase/second.jpg', 'previews/presenters/ana/avatar.jpg']);
    expect(order.filter((n) => n.includes('mug'))).toHaveLength(1);
    expect(order.slice(-2)).toEqual(['previews/presenters/ana/portrait.jpg', 'previews/garden/ref-02.jpg']);
  });
});

describe('the pin the build ships', () => {
  it('is the archive this version expects', () => {
    expect(CONTENT_PIN.version).toBe(CONTENT_VERSION);
    expect(CONTENT_PIN.sha256).toBe(CONTENT_SHA256);
    expect(CONTENT_PIN.files.some((f) => f[0] === 'meta.json')).toBe(true);
    const offsets = CONTENT_PIN.files.map((f) => f[1]);
    expect(offsets).toEqual([...offsets].sort((a, b) => a - b));
  });

  // Read-only over the installed library, which CI's unit and Windows jobs
  // hydrate from the same release: a content bump cannot ship a stale pin.
  const installed = join(process.env.HOME ?? '', '.scenri', 'content');
  const v3 = (() => {
    try {
      return JSON.parse(readFileSync(join(installed, 'meta.json'), 'utf8')).version === CONTENT_VERSION;
    } catch {
      return false;
    }
  })();
  it.skipIf(!v3)('matches the installed library file for file', () => {
    for (const [name, , , , size, hash] of CONTENT_PIN.files) {
      const data = readFileSync(join(installed, ...name.split('/')));
      expect(data.length, name).toBe(size);
      expect(sha(data), name).toBe(hash);
    }
  });
});
