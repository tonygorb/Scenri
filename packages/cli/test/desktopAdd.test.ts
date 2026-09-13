import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { addToDesktop } from '../src/desktop/cli.js';
import { offerDesktop } from '../src/desktop/offer.js';
import { entryOf } from '../src/update/versionsDir.js';

/**
 * Add to desktop, end to end below the OS: adopt the running build, prove the
 * copy loads, then write the icon. No runnable copy means no icon, because an
 * icon that says "app files are missing" on its first click is worse than none.
 */

const assetsDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'launcher');
let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'sc-add-'));
  mkdirSync(join(root, 'Desktop'));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

function plantNpx(version: string) {
  const nm = join(root, '_npx', 'h', 'node_modules');
  mkdirSync(join(nm, 'scenri', 'dist'), { recursive: true });
  mkdirSync(join(nm, 'fastify'), { recursive: true });
  writeFileSync(join(nm, 'scenri', 'package.json'), JSON.stringify({ name: 'scenri', version }));
  writeFileSync(join(nm, 'scenri', 'dist', 'index.js'), '');
  return join(nm, 'scenri', 'dist', 'index.js');
}

const base = (ownEntry: string, verify: boolean) => ({
  platform: 'darwin' as NodeJS.Platform,
  homedir: root,
  home: join(root, 'data'),
  execPath: join(root, 'node'),
  env: { SCENRI_DESKTOP_DIR: join(root, 'Desktop') } as NodeJS.ProcessEnv,
  version: '0.8.4',
  assetsDir,
  runImpl: async () => '',
  installKind: 'npx' as const,
  pkg: 'scenri',
  verifyImpl: async () => verify,
  ownEntry,
});

describe('addToDesktop', () => {
  it('adopts the running build, verifies it, and writes the icon', async () => {
    const said: string[] = [];
    const res = await addToDesktop(plantNpx('0.8.4'), (l) => said.push(l), base(plantNpx('0.8.4'), true));
    expect(res).toMatchObject({ ok: true, path: join(root, 'Desktop', 'Scenri.app') });
    expect(existsSync(entryOf(join(root, 'data'), 'scenri', '0.8.4'))).toBe(true);
    expect(said.join('\n')).toContain('keeping a copy of Scenri 0.8.4');
    expect(said.join('\n')).toContain('Added Scenri to your desktop');
  });

  it('refuses to make an icon with nothing runnable behind it', async () => {
    const said: string[] = [];
    const res = await addToDesktop(plantNpx('0.8.4'), (l) => said.push(l), base(plantNpx('0.8.4'), false));
    expect(res).toMatchObject({ ok: false, reason: 'failed' });
    expect((res as { message: string }).message).toContain('npx scenri');
    expect(existsSync(join(root, 'Desktop', 'Scenri.app'))).toBe(false);
    expect(existsSync(join(root, '.scenri', 'launcher', 'launcher.json'))).toBe(false);
  });

  it('says so from a source checkout and touches nothing', async () => {
    const res = await addToDesktop('/repo/packages/cli/src/index.ts', () => {}, {
      ...base('/x', true),
      installKind: 'dev',
    });
    expect(res).toMatchObject({ ok: false, reason: 'unsupported' });
    expect(existsSync(join(root, 'Desktop', 'Scenri.app'))).toBe(false);
  });
});

/**
 * The whole point of the 0.9.2 fix: yes attempts, no skips, and neither can
 * stop a server that is already listening. These wire the real addToDesktop
 * into the real offerDesktop, exactly as serve() does, and then break the
 * things underneath it.
 */
describe('the first-run offer, composed as serve() composes it', () => {
  const askYes = async () => 'Y';

  it('answers rather than throwing when adoption itself blows up', async () => {
    const said: string[] = [];
    const ownEntry = join(root, 'nowhere', 'dist', 'index.js');
    await expect(
      offerDesktop({
        ask: askYes,
        add: () => addToDesktop(ownEntry, (l) => said.push(l), base(ownEntry, true)),
        decline: () => expect.unreachable('a yes is not a decline'),
        say: (l) => said.push(l),
      }),
    ).resolves.toBeUndefined();
    expect(said.join('\n')).toContain('Scenri is running anyway');
    expect(existsSync(join(root, 'Desktop', 'Scenri.app'))).toBe(false);
  });

  it('answers rather than throwing when the OS will not say where the Desktop is', async () => {
    const said: string[] = [];
    const entry = plantNpx('0.8.4');
    await expect(
      offerDesktop({
        ask: askYes,
        add: () =>
          addToDesktop(entry, (l) => said.push(l), {
            ...base(entry, true),
            platform: 'win32',
            env: { PATH: 'C:\\Windows\\System32' },
            runImpl: async () => {
              throw new Error('powershell.exe timed out after 30000ms');
            },
          }),
        decline: () => expect.unreachable('a yes is not a decline'),
        say: (l) => said.push(l),
      }),
    ).resolves.toBeUndefined();
    expect(said.join('\n')).toContain('Scenri is running anyway');
  });

  it('skips the attempt entirely on a no, and writes nothing', async () => {
    const said: string[] = [];
    const entry = plantNpx('0.8.4');
    let declined = 0;
    await offerDesktop({
      ask: async () => 'n',
      add: () => addToDesktop(entry, (l) => said.push(l), base(entry, true)),
      decline: () => {
        declined++;
      },
      say: (l) => said.push(l),
    });
    expect(declined).toBe(1);
    expect(existsSync(join(root, 'Desktop', 'Scenri.app'))).toBe(false);
    expect(existsSync(join(root, '.scenri', 'launcher', 'launcher.json'))).toBe(false);
  });
});
