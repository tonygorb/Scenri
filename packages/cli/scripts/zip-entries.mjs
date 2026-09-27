/**
 * The files in a zip held in memory, and where each one's bytes start.
 *
 * Development tooling only: the pin script, the cold-start helper and the
 * tests read archives with it. The app never parses an archive it downloads
 * by range; it reads each file's place from the pin committed beside it.
 *
 * Plain zip as `zip -r` writes it: no zip64 (under 4 GB and 65,535 entries),
 * no encryption. Anything else is refused rather than guessed at.
 */
export function zipEntries(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('not a zip: no end of central directory');
  const count = buf.readUInt16LE(eocd + 10);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (count === 0xffff || cdOffset === 0xffffffff) throw new Error('zip64 archives are not supported');
  const out = [];
  let p = cdOffset;
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error(`bad central directory entry ${i}`);
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const crc32 = buf.readUInt32LE(p + 16);
    const compressedSize = buf.readUInt32LE(p + 20);
    const size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const headerOffset = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8');
    p += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith('/')) continue;
    if (flags & 1) throw new Error(`${name} is encrypted`);
    if (method !== 0 && method !== 8) throw new Error(`${name} uses compression method ${method}`);
    if (buf.readUInt32LE(headerOffset) !== 0x04034b50) throw new Error(`bad local header for ${name}`);
    const dataOffset = headerOffset + 30 + buf.readUInt16LE(headerOffset + 26) + buf.readUInt16LE(headerOffset + 28);
    out.push({ name, method, crc32, compressedSize, size, headerOffset, dataOffset });
  }
  return out;
}
