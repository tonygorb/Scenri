import { describe, it, expect, afterEach } from 'vitest';
import { spawn } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { createCore } from '@scenri/core';
import { readMeta } from '../src/meta.js';

/**
 * `npx scenri` run while Scenri already runs is not a failure: it hands the
 * person the running studio. It has to do that without opening the library,
 * because opening it marks every running shot as interrupted, the sweep only
 * a real restart needs. The second start is a real process here, against a
 * stand-in Scenri that answers on the port with this library's home.
 */
const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const ENTRY = join(REPO, 'packages', 'cli', 'src', 'index.ts');

let home: string;
let running: Server | null = null;
afterEach(() => {
  running?.close();
  running = null;
  rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

describe('a second start', () => {
  // `npx scenri` and the desktop icon start serve under the launcher, which
  // sets SCENRI_SUPERVISED; `pnpm dev` and `scenri serve` start it bare.
  it.each([
    ['through the launcher', '1'],
    ['on its own', ''],
  ])(
    "%s hands over the running Scenri and leaves its library's work alone",
    async (_how, supervised) => {
      home = mkdtempSync(join(tmpdir(), 'sc-second-'));
      const core = createCore(home);
      const brand = core.store.createBrand({ meta: { name: 'Busy' } });
      const { project, root } = core.store.createProject(brand.id, 'Busy');
      const [shot] = core.store.addNodes({
        projectId: project.id,
        parentId: root.id,
        kind: 'generation',
        prompt: 'still rendering',
        engineId: 'demo',
        count: 1,
      });
      expect(shot.status).toBe('running');
      core.close();

      running = createServer((_req, res) => {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ name: readMeta().name, version: readMeta().version, home }));
      });
      await new Promise<void>((r) => running!.listen(0, '127.0.0.1', () => r()));
      const port = (running.address() as AddressInfo).port;

      const child = spawn(process.execPath, ['--import', 'tsx', ENTRY, 'serve'], {
        cwd: REPO,
        env: {
          ...process.env,
          SCENRI_HOME: home,
          SCENRI_PORT: String(port),
          SCENRI_SUPERVISED: supervised,
          SCENRI_NO_OPEN: '1',
          SCENRI_NO_DESKTOP: '1',
          SCENRI_NO_UPDATE_CHECK: '1',
          SCENRI_NO_CONTENT_FETCH: '1',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let out = '';
      child.stdout.on('data', (d) => {
        out += String(d);
      });
      child.stderr.on('data', (d) => {
        out += String(d);
      });
      const code = await new Promise<number | null>((r) => child.on('exit', (c) => r(c)));
      expect(code, out).toBe(0);
      expect(out).toContain('Scenri is already running');

      const db = new Database(join(home, 'scenri.db'), { readonly: true });
      const row = db.prepare('SELECT status, error FROM nodes WHERE id = ?').get(shot.id) as { status: string };
      db.close();
      expect(row.status).toBe('running');
    },
    60_000,
  );
});
