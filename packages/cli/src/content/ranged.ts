import { createHash } from 'node:crypto';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, normalize, relative, sep } from 'node:path';
import { promisify } from 'node:util';
import { inflateRaw, inflateRawSync } from 'node:zlib';

/**
 * The library archive installed a file at a time from where the pin says each
 * one's bytes are, the files Home shows first, and each kept only once its own
 * sha256 matches the pin. The archive is the one published, unchanged:
 * GitHub's release host answers byte ranges, so no second format and no
 * second host are needed for the order, the resume and the one-bad-file-fails-
 * alone that one whole-archive GET could not give. An archive already in
 * memory (a host that ignores ranges, pull-content's file) goes through the
 * same install, answered from memory (archiveFetch).
 */

const inflateAsync = promisify(inflateRaw);

/** [name, where its packed bytes start, how many, 0 stored or 8 deflate, unpacked size, sha256 of the unpacked bytes] */
export type PinnedFile = [
  name: string,
  dataOffset: number,
  compressedSize: number,
  method: number,
  size: number,
  sha256: string,
];

/** An archive pinned file by file (scripts/pin-content.mts), in archive order. */
export interface ArchivePin {
  version: number;
  sha256: string;
  size: number;
  files: PinnedFile[];
}

export interface RangedOptions {
  url: string;
  pin: ArchivePin;
  /** The directory verified files land in (content.partial). */
  partial: string;
  /** Names wanted first, in that order; every other pinned file follows in archive order. */
  order: readonly string[];
  /** A directory already holding some of the library byte for byte (the package's own templates): those files are copied, not fetched. */
  seed?: string;
  fetchImpl: typeof fetch;
  signal: AbortSignal;
  /** Requests in flight at once. */
  concurrency: number;
  /** The most bytes one request takes when neighbouring files are merged into it. */
  capBytes: number;
  /** A request that receives nothing for this long is given up (and retried). */
  idleMs: number;
  /** Waits before the second, third and fourth attempt at the same file. */
  backoffMs: readonly number[];
  onLanded: (file: PinnedFile) => void;
}

export type RangedResult =
  | { kind: 'complete' }
  | { kind: 'partial'; missing: PinnedFile[] }
  /** The host did not answer a byte range: the caller takes the archive whole and installs it from memory. */
  | { kind: 'unranged' }
  /** The host answered a range of an archive of another size: not the one pinned, and nothing was fetched. */
  | { kind: 'mismatch'; size: number };

/** A pinned name as a path inside `root`, or null if it would leave it. */
function placeOf(root: string, name: string): string | null {
  const rel = normalize(name);
  if (rel.startsWith('..') || rel.startsWith('/') || rel.startsWith('\\') || /^[a-zA-Z]:/.test(rel)) return null;
  const dest = join(root, ...name.split('/'));
  return dest.startsWith(root + sep) ? dest : null;
}

const sha256 = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (signal.aborted) return resolve();
    const t = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        resolve();
      },
      { once: true },
    );
  });

/** Rename, again a moment later when Windows holds the file (an antivirus pass, a reader). */
async function renameRetrying(from: string, to: string): Promise<void> {
  for (let i = 0; ; i++) {
    try {
      return await rename(from, to);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (i >= 5 || (code !== 'EPERM' && code !== 'EBUSY' && code !== 'EACCES')) throw err;
      await new Promise((r) => setTimeout(r, 100 * (i + 1)));
    }
  }
}

/** A checked file into place: written aside, then renamed, so a stop never leaves half a file under its real name. */
async function put(dest: string, data: Buffer): Promise<void> {
  await mkdir(dirname(dest), { recursive: true });
  await writeFile(`${dest}.part`, data);
  await renameRetrying(`${dest}.part`, dest);
}

/**
 * What a previous run left in `partial`, checked against the pin: files whose
 * hash matches stay, and everything else goes (a .part a stop cut short, a
 * file of another version, anything the pin does not list). Each kept file is
 * reported as it is checked, so a restart's count climbs from what was kept.
 */
export async function keepVerified(
  partial: string,
  pin: ArchivePin,
  onKept: (file: PinnedFile) => void = () => {},
): Promise<Set<string>> {
  const pinned = new Map(pin.files.map((f) => [f[0], f]));
  const kept = new Set<string>();
  if (!existsSync(partial)) return kept;
  const walk = async (dir: string): Promise<void> => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const at = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(at);
        continue;
      }
      const name = relative(partial, at).split(sep).join('/');
      const file = pinned.get(name);
      if (file && !name.endsWith('.part') && sha256(await readFile(at)) === file[5]) {
        kept.add(name);
        onKept(file);
      } else await rm(at, { force: true, maxRetries: 3 });
    }
  };
  await walk(partial);
  return kept;
}

/**
 * An archive already in memory, answering byte ranges the way the release
 * host does, so the whole-archive transports (a host that ignores ranges,
 * pull-content's file) install through installByRange, file by file.
 */
export function archiveFetch(bytes: Buffer): typeof fetch {
  return (async (_url: string | URL | Request, init?: RequestInit) => {
    const m = /^bytes=(\d+)-(\d+)$/.exec(new Headers(init?.headers).get('range') ?? '');
    if (!m) return new Response(new Uint8Array(bytes), { status: 200 });
    const start = Number(m[1]);
    const end = Math.min(bytes.length - 1, Number(m[2]));
    return new Response(new Uint8Array(bytes.subarray(start, end + 1)), {
      status: 206,
      headers: { 'content-range': `bytes ${start}-${end}/${bytes.length}` },
    });
  }) as typeof fetch;
}

export async function installByRange(o: RangedOptions): Promise<RangedResult> {
  const { pin } = o;
  const meta = pin.files.findIndex((f) => f[0] === 'meta.json');
  if (meta < 0) throw new Error('the pin names no meta.json');
  await mkdir(o.partial, { recursive: true });
  const present = await keepVerified(o.partial, pin, (f) => {
    if (f[0] !== 'meta.json') o.onLanded(f);
  });
  if (present.has('meta.json') && present.size === pin.files.length) return { kind: 'complete' };

  // Where the bytes are served from: the release URL answers with a redirect
  // to a signed address, which is reused for every range until it is refused.
  let resolved = o.url;
  const probe = async (): Promise<'ok' | 'unranged' | number> => {
    const res = await o.fetchImpl(o.url, {
      headers: { range: 'bytes=0-0' },
      signal: AbortSignal.any([o.signal, AbortSignal.timeout(o.idleMs)]),
    });
    const total = /\/(\d+)$/.exec(res.headers.get('content-range') ?? '')?.[1];
    await res.body?.cancel().catch(() => {});
    if (res.status !== 206 || !total) return 'unranged';
    if (Number(total) !== pin.size) return Number(total);
    resolved = res.url || o.url;
    return 'ok';
  };
  const probed = await probe();
  if (probed === 'unranged') return { kind: 'unranged' };
  if (probed !== 'ok') return { kind: 'mismatch', size: probed };

  // What the package already carries byte for byte (the catalog records, the
  // scene cards) is copied from it rather than fetched.
  if (o.seed) {
    for (const f of pin.files) {
      if (f[0] === 'meta.json' || present.has(f[0])) continue;
      const from = placeOf(o.seed, f[0]);
      const dest = placeOf(o.partial, f[0]);
      if (!from || !dest || !existsSync(from) || statSync(from).size !== f[4]) continue;
      const data = await readFile(from);
      if (sha256(data) !== f[5]) continue;
      await put(dest, data);
      present.add(f[0]);
      o.onLanded(f);
    }
  }

  // Order: what was asked for first, then the rest as it lies in the archive,
  // meta.json held back to be written last; runs of neighbours merged up to the cap.
  const index = new Map(pin.files.map((f, i) => [f[0], i]));
  const seen = new Set<number>();
  const wanted: number[] = [];
  for (const name of o.order) {
    const i = index.get(name);
    if (i === undefined || seen.has(i)) continue;
    seen.add(i);
    wanted.push(i);
  }
  for (let i = 0; i < pin.files.length; i++) if (!seen.has(i)) wanted.push(i);
  const jobs: number[][] = [];
  for (const i of wanted) {
    if (i === meta || present.has(pin.files[i][0])) continue;
    const last = jobs.at(-1);
    const tail = last?.at(-1);
    if (last && tail !== undefined && i === tail + 1) {
      const first = pin.files[last[0]];
      const f = pin.files[i];
      if (f[1] + f[2] - first[1] <= o.capBytes) {
        last.push(i);
        continue;
      }
    }
    jobs.push([i]);
  }

  let reresolved = false;
  let networkStreak = 0;
  let stopped = false;
  const failed = new Set<number>();

  /**
   * One ranged read of [start, end), handing the bytes over as they arrive:
   * 'done', 'missing' (404/410/416, before any byte) or 'network' (it never
   * started, or ended short). What arrived before a failure was handed over.
   */
  const read = async (
    start: number,
    end: number,
    onBytes: (buf: Buffer, at: number) => void,
  ): Promise<'done' | 'missing' | 'network'> => {
    const ctrl = new AbortController();
    const onAbort = () => ctrl.abort();
    o.signal.addEventListener('abort', onAbort, { once: true });
    let timer = setTimeout(() => ctrl.abort(), o.idleMs);
    try {
      const get = () => o.fetchImpl(resolved, { headers: { range: `bytes=${start}-${end - 1}` }, signal: ctrl.signal });
      let res = await get();
      if ((res.status === 401 || res.status === 403) && !reresolved) {
        // the signed address expired: ask the release URL for a fresh one, once
        reresolved = true;
        await res.body?.cancel().catch(() => {});
        if ((await probe()) === 'ok') res = await get();
      }
      if (res.status === 404 || res.status === 410 || res.status === 416) {
        await res.body?.cancel().catch(() => {});
        return 'missing';
      }
      // A host answering anything but exactly this range (a proxy's 200 with the
      // whole archive, say) is refused before a byte of its body is read.
      if (
        res.status !== 206 ||
        res.headers.get('content-range') !== `bytes ${start}-${end - 1}/${pin.size}` ||
        !res.body
      ) {
        await res.body?.cancel().catch(() => {});
        return 'network';
      }
      const buf = Buffer.allocUnsafe(end - start);
      let at = 0;
      const reader = res.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        clearTimeout(timer);
        timer = setTimeout(() => ctrl.abort(), o.idleMs);
        if (at + value.length > buf.length) return 'network';
        buf.set(value, at);
        at += value.length;
        onBytes(buf, at);
      }
      return at === buf.length ? 'done' : 'network';
    } catch {
      return 'network';
    } finally {
      clearTimeout(timer);
      o.signal.removeEventListener('abort', onAbort);
    }
  };

  /** Unpack, check and place one file; false when its bytes are not what the pin says. */
  const land = async (i: number, packed: Buffer): Promise<boolean> => {
    const f = pin.files[i];
    const dest = placeOf(o.partial, f[0]);
    if (!dest) return false;
    let data: Buffer;
    try {
      // Small files inflate on the spot (well under 20 ms): async inflate in
      // 16 KiB pieces would queue behind sharp on the thread pool it fills.
      data =
        f[3] === 0
          ? packed
          : f[3] === 8
            ? f[4] < 1 << 20
              ? inflateRawSync(packed)
              : await inflateAsync(packed, { chunkSize: Math.max(64 * 1024, f[4]) })
            : Buffer.alloc(0);
    } catch {
      return false;
    }
    if (data.length !== f[4] || sha256(data) !== f[5]) return false;
    await put(dest, data);
    return true;
  };

  /**
   * A job's files, each landing the moment its own bytes are in, while the
   * rest of the read streams on; tried again until they land, their attempts
   * run out, or the pass is stopped.
   */
  const run = async (job: number[]): Promise<void> => {
    let pending = job;
    let attempt = 0;
    while (pending.length && !stopped && !o.signal.aborted) {
      const start = pin.files[pending[0]][1];
      const last = pin.files[pending[pending.length - 1]];
      const tries = pending;
      let next = 0;
      const landing: Promise<boolean>[] = [];
      const got = await read(start, last[1] + last[2], (buf, at) => {
        for (; next < tries.length; next += 1) {
          const f = pin.files[tries[next]];
          if (f[1] + f[2] - start > at) break;
          landing.push(land(tries[next], buf.subarray(f[1] - start, f[1] + f[2] - start)));
        }
      });
      const landed = await Promise.all(landing);
      const again: number[] = [];
      landed.forEach((ok, j) => {
        if (ok) o.onLanded(pin.files[tries[j]]);
        else again.push(tries[j]);
      });
      again.push(...tries.slice(next));
      if (got === 'network' && !landed.some(Boolean)) {
        networkStreak += 1;
        // Every request failing on the network is no network: end the pass now
        // rather than walk every file through its backoff with the Wi-Fi off.
        if (networkStreak >= 3 * o.concurrency) stopped = true;
      } else networkStreak = 0;
      if (!again.length) return;
      if (again.length > 1) {
        // Several files still to come are tried again one at a time, each with
        // tries of its own, so one bad file fails alone rather than taking the
        // files it shared a read with down with it.
        for (const i of again) jobs.push([i]);
        return;
      }
      pending = again;
      if (attempt >= o.backoffMs.length) break;
      await sleep(o.backoffMs[attempt], o.signal);
      attempt += 1;
    }
    for (const i of pending) failed.add(i);
  };

  let next = 0;
  const worker = async () => {
    while (!stopped && !o.signal.aborted && next < jobs.length) await run(jobs[next++]);
  };
  await Promise.all(Array.from({ length: Math.max(1, o.concurrency) }, worker));

  // meta.json last, and only onto a library that is whole: its presence is what says so.
  const missing = () => pin.files.filter((f, i) => i !== meta && !existsSync(join(o.partial, ...f[0].split('/'))));
  if (!stopped && !o.signal.aborted && !failed.size && !missing().length) await run([meta]);
  const left = pin.files.filter((f) => !existsSync(join(o.partial, ...f[0].split('/'))));
  return left.length ? { kind: 'partial', missing: left } : { kind: 'complete' };
}
