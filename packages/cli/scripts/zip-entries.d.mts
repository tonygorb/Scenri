export interface ZipEntry {
  name: string;
  method: number;
  crc32: number;
  compressedSize: number;
  size: number;
  headerOffset: number;
  dataOffset: number;
}
export function zipEntries(buf: Buffer): ZipEntry[];
