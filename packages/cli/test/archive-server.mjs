/**
 * The library archive served the way GitHub's release host serves it: one
 * file, GET and HEAD, explicit byte ranges answered 206 (a suffix range is
 * answered 501, as the real host does), a whole-file GET answered 200.
 *
 * For the cold-start helper and the content tests, with the conditions a real
 * line has, each optional:
 *   mbps     one rate cap shared by every connection, like one line
 *   faults   byte spans that go wrong for any request reaching them:
 *            '404', 'reset' (the socket dies there), 'short' (the body ends
 *            there), 'corrupt' (bytes flipped); `times` limits a fault to its
 *            first N hits, so a retry can succeed
 *   cut      { afterMs, forMs }: the network gone for a while, starting that
 *            long after the first request
 * and a record of what was asked for, so a test can count requests, bytes,
 * peak concurrency and which spans were fetched twice.
 */
import { createServer } from 'node:http';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function startArchiveServer({
  bytes,
  mbps = 0,
  faults = [],
  cut = null,
  path = '/scenri-content.zip',
  chunk = 16 * 1024,
}) {
  const total = bytes.length;
  const perSecond = mbps > 0 ? (mbps * 1e6) / 8 : 0;
  let nextFree = 0;
  // One budget for every connection: each chunk waits for its place on the line.
  const pace = async (n) => {
    if (!perSecond) return;
    const now = Date.now();
    nextFree = Math.max(nextFree, now) + (n / perSecond) * 1000;
    const wait = nextFree - now - (n / perSecond) * 1000;
    if (wait > 0) await sleep(wait);
  };
  const stats = { requests: 0, ranges: 0, whole: 0, bytesSent: 0, open: 0, peak: 0, log: [] };
  const hits = new Map();
  let firstAt = 0;
  const down = () => {
    if (!cut || !firstAt) return false;
    const t = Date.now() - firstAt;
    return t >= cut.afterMs && t < cut.afterMs + cut.forMs;
  };
  const faultFor = (start, end) => {
    for (const f of faults) {
      if (f.end <= start || f.start >= end) continue;
      const n = hits.get(f) ?? 0;
      if (f.times !== undefined && n >= f.times) continue;
      hits.set(f, n + 1);
      return f;
    }
    return null;
  };

  const server = createServer(async (req, res) => {
    firstAt ||= Date.now();
    stats.requests += 1;
    if (down()) return req.socket.destroy();
    if (req.url?.split('?')[0] !== path) {
      res.statusCode = 404;
      return res.end();
    }
    res.setHeader('accept-ranges', 'bytes');
    res.setHeader('etag', '"fixture"');
    const range = req.headers.range;
    let start = 0;
    let end = total;
    if (range) {
      const m = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!m || m[1] === '') {
        res.statusCode = m ? 501 : 416;
        return res.end();
      }
      start = Number(m[1]);
      end = m[2] === '' ? total : Math.min(total, Number(m[2]) + 1);
      if (start >= total || end <= start) {
        res.statusCode = 416;
        res.setHeader('content-range', `bytes */${total}`);
        return res.end();
      }
      stats.ranges += 1;
      res.statusCode = 206;
      res.setHeader('content-range', `bytes ${start}-${end - 1}/${total}`);
    } else {
      stats.whole += 1;
      res.statusCode = 200;
    }
    const fault = faultFor(start, end);
    if (fault?.kind === '404') {
      res.statusCode = 404;
      res.removeHeader('content-range');
      return res.end();
    }
    res.setHeader('content-length', String(end - start));
    res.setHeader('content-type', 'application/zip');
    const entry = { start, end, status: res.statusCode, t0: Date.now(), t1: 0, sent: 0, fault: fault?.kind ?? null };
    stats.log.push(entry);
    if (req.method === 'HEAD') return res.end();
    stats.open += 1;
    stats.peak = Math.max(stats.peak, stats.open);
    try {
      for (let at = start; at < end; at += chunk) {
        if (down() || res.destroyed) return req.socket.destroy();
        let piece = bytes.subarray(at, Math.min(end, at + chunk));
        if (fault && fault.start < at + piece.length && fault.end > at) {
          const from = Math.max(fault.start, at) - at;
          if (fault.kind === 'reset') {
            if (from > 0) res.write(piece.subarray(0, from));
            return req.socket.destroy();
          }
          if (fault.kind === 'short') {
            if (from > 0) res.write(piece.subarray(0, from));
            // a body that ends early: the socket closes under a promised length
            return req.socket.end();
          }
          if (fault.kind === 'corrupt') {
            piece = Buffer.from(piece);
            piece[from] ^= 0xff;
          }
        }
        await pace(piece.length);
        if (!res.write(piece)) await new Promise((r) => res.once('drain', r));
        stats.bytesSent += piece.length;
        entry.sent += piece.length;
      }
      res.end();
    } finally {
      entry.t1 = Date.now();
      stats.open -= 1;
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}${path}`,
    stats,
    close: () =>
      new Promise((r) => {
        server.closeAllConnections?.();
        server.close(() => r());
      }),
  };
}

// ---- fixture archives, for the specs that need a pinned library of their own

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

/** A zip of stored (uncompressed) files, in the given order: [[name, bytes], ...]. */
export function storedZip(files) {
  const parts = [];
  const central = [];
  let offset = 0;
  for (const [name, data] of files) {
    const n = Buffer.from(name, 'utf8');
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(n.length, 26);
    parts.push(local, n, data);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(data.length, 20);
    entry.writeUInt32LE(data.length, 24);
    entry.writeUInt16LE(n.length, 28);
    entry.writeUInt32LE(offset, 42);
    central.push(entry, n);
    offset += 30 + n.length + data.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, directory, end]);
}

/** The pin scripts/pin-content.mts would write for a stored zip built above. */
export async function pinFor(bytes, version = 0) {
  const { createHash } = await import('node:crypto');
  const { zipEntries } = await import('../scripts/zip-entries.mjs');
  const sha = (b) => createHash('sha256').update(b).digest('hex');
  const files = zipEntries(bytes)
    .sort((a, b) => a.dataOffset - b.dataOffset)
    .map((e) => [
      e.name,
      e.dataOffset,
      e.compressedSize,
      e.method,
      e.size,
      sha(bytes.subarray(e.dataOffset, e.dataOffset + e.compressedSize)),
    ]);
  return { version, sha256: sha(bytes), size: bytes.length, files };
}
