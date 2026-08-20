import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface ImageStore {
  save(buf: Buffer, ext?: string): string; // returns hash (filename stem)
  pathFor(hash: string): string;
  read(hash: string): Buffer;
  has(hash: string): boolean;
}

export function createImageStore(homeDir: string): ImageStore {
  const dir = join(homeDir, 'images');
  // 0o700 like the home dir itself: user work, owner's eyes only. Creation
  // only — an existing folder keeps whatever its owner set. POSIX only: on
  // Windows the mode is ignored and the profile's ACLs apply.
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const fileFor = (hash: string) => join(dir, `${hash}.png`);
  return {
    save(buf) {
      const hash = createHash('sha256').update(buf).digest('hex').slice(0, 32);
      const file = fileFor(hash);
      if (!existsSync(file)) writeFileSync(file, buf);
      return hash;
    },
    pathFor(hash) {
      if (!/^[a-f0-9]{32}$/.test(hash)) throw new Error('invalid image hash');
      return fileFor(hash);
    },
    read(hash) {
      return readFileSync(this.pathFor(hash));
    },
    has(hash) {
      return /^[a-f0-9]{32}$/.test(hash) && existsSync(fileFor(hash));
    },
  };
}
