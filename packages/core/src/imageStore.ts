import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, existsSync, readFileSync, renameSync, rmSync, statSync, utimesSync } from 'node:fs';
import { join } from 'node:path';

export interface ImageStore {
  save(buf: Buffer, ext?: string): string; // returns hash (filename stem)
  pathFor(hash: string): string;
  read(hash: string): Buffer;
  has(hash: string): boolean;
  /** Unlink a stored image. True when there was one. The caller decides whether anything still needs it. */
  remove(hash: string): boolean;
}

export function createImageStore(homeDir: string): ImageStore {
  const dir = join(homeDir, 'images');
  // 0o700 like the home dir itself: user work, owner's eyes only. Creation
  // only — an existing folder keeps whatever its owner set. POSIX only: on
  // Windows the mode is ignored and the profile's ACLs apply.
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  /**
   * Every extension the store has ever written, newest first.
   *
   * It only ever wrote `.png`, because a catalog image was re-encoded before it
   * got here: a 269 KB jpeg became 2.90 MB, and gymshark's 6,603 pictures came
   * to 19.1 GB and 1.9 minutes of encoding for a format nothing needs. Display
   * goes through the WebP thumbnail derivative and generation reads the file
   * through sharp, which sniffs. So the bytes a store served can be kept as
   * they are, and a hash now resolves against whichever extension it was
   * written with. Every existing `.png` keeps working untouched.
   */
  //
  // `heif` and `heic` are here because sharp reports an AVIF file as `heif`,
  // and `save` takes its extension from what sharp read. Without them the
  // bytes were written as `<hash>.heif` and then never found again: `resolve`
  // fell through to `<hash>.png`, `has` said no and `read` threw. A store
  // serving AVIF produced products that looked imported and had an image
  // nothing could open.
  const EXTS = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif', 'heif', 'heic'] as const;
  const fileFor = (hash: string, ext = 'png') => join(dir, `${hash}.${ext}`);
  const resolve = (hash: string) => {
    for (const ext of EXTS) {
      const file = fileFor(hash, ext);
      if (existsSync(file)) return file;
    }
    return fileFor(hash);
  };
  return {
    save(buf, ext = 'png') {
      const clean = /^[a-z0-9]{2,5}$/i.test(ext) ? ext.toLowerCase() : 'png';
      const hash = createHash('sha256').update(buf).digest('hex').slice(0, 32);
      const file = fileFor(hash, clean);
      // Whole or not at all. An in-place write cut short (a full disk) left a
      // short file under the right name, and taking existence as completeness
      // meant every later save of the same bytes trusted it for good. A file
      // of the wrong size is a torn write, so it is written again.
      if (!existsSync(file) || statSync(file).size !== buf.length) {
        const tmp = `${file}.${process.pid}.tmp`;
        try {
          writeFileSync(tmp, buf);
          renameSync(tmp, file);
        } finally {
          rmSync(tmp, { force: true });
        }
      } else {
        // The same bytes saved again are new again: the boot sweep of pictures
        // nothing references goes by age, and a photo first saved long ago and
        // attached again today must not look abandoned.
        const now = new Date();
        utimesSync(file, now, now);
      }
      return hash;
    },
    pathFor(hash) {
      if (!/^[a-f0-9]{32}$/.test(hash)) throw new Error('invalid image hash');
      return resolve(hash);
    },
    read(hash) {
      return readFileSync(this.pathFor(hash));
    },
    has(hash) {
      return /^[a-f0-9]{32}$/.test(hash) && EXTS.some((ext) => existsSync(fileFor(hash, ext)));
    },
    remove(hash) {
      const file = this.pathFor(hash);
      if (!existsSync(file)) return false;
      rmSync(file, { force: true });
      return true;
    },
  };
}
