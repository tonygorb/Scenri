import { createCore, SchemaTooNewError } from '@scenri/core';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { randomBytes } from 'node:crypto';
import { createEngineRegistry } from './engines.js';
import { createDemoEngine } from '@scenri/engine-demo';
import { buildServer, type InstallKind } from './server.js';
import { readMeta } from './meta.js';

const PORT = Number(process.env.SCENRI_PORT || 4747);
/**
 * This machine only, by default. The API has no accounts: whoever reaches the
 * port can generate on the user's API keys and delete their library. Reaching
 * phones on the same Wi-Fi is opt-in via SCENRI_HOST, and that path is gated
 * on a per-session token.
 */
const HOST = process.env.SCENRI_HOST || '127.0.0.1';

const LOOPBACK = ['127.0.0.1', 'localhost', '::1'];

function lanAddresses(): string[] {
  const out: string[] = [];
  for (const addrs of Object.values(networkInterfaces())) {
    for (const a of addrs ?? []) {
      // older Node reported family as the number 4; both spellings still count
      if ((a.family as string | number) === 'IPv4' || (a.family as string | number) === 4) {
        if (!a.internal) out.push(a.address);
      }
    }
  }
  return out;
}

/**
 * Where this build came from, judged by where it runs from. Decides which
 * update story the UI tells: a checkout gets git guidance, never an Update
 * button that would overwrite someone's working tree.
 */
export function detectInstallKind(entryPath: string, home: string): InstallKind {
  if (!entryPath.includes(`${sep}dist${sep}`) && !entryPath.endsWith(`${sep}dist`)) return 'dev';
  if (entryPath.startsWith(join(home, 'app', 'versions') + sep)) return 'managed';
  if (entryPath.includes(`${sep}_npx${sep}`)) return 'npx';
  if (entryPath.includes(`${sep}node_modules${sep}`)) return 'global';
  return 'unknown';
}

export async function serve(): Promise<void> {
  try {
    await run();
  } catch (err) {
    if (err instanceof SchemaTooNewError) {
      // A person at a terminal, not a stack trace: say what happened and the fix.
      console.error(`\n  ${err.message}\n`);
      process.exit(1);
    }
    throw err;
  }
}

async function run(): Promise<void> {
  const core = createCore();
  // The e2e suite needs a generation that finishes without keys, money or a
  // network. The demo engine is deliberately absent from the default registry
  // (see engines.ts) because it proves nothing about fidelity, so it is opted
  // into explicitly here and nowhere else.
  const stubs = process.env.SCENRI_DEMO_ENGINE === '1' ? [createDemoEngine((b: Buffer) => core.images.save(b))] : [];
  const engines = createEngineRegistry(core, stubs);
  const here = dirname(fileURLToPath(import.meta.url));
  // dev: monorepo path; published: bundled dist
  const candidates = [join(here, '..', '..', '..', 'apps', 'studio', 'dist'), join(here, '..', 'studio-dist')];
  const studioDist = candidates.find((p) => existsSync(p));

  const supervised = process.env.SCENRI_SUPERVISED === '1';
  const installKind = detectInstallKind(fileURLToPath(import.meta.url), core.home);

  const onlyThisMachine = LOOPBACK.includes(HOST);
  // Off loopback, "can reach the port" stops meaning "is sitting at this
  // machine", so the URLs we print carry a token that is new on every run.
  const token = onlyThisMachine ? undefined : randomBytes(24).toString('base64url');
  const reachableAt = onlyThisMachine ? [] : HOST === '0.0.0.0' || HOST === '::' ? lanAddresses() : [HOST];

  const app = buildServer({
    core,
    engines,
    studioDist,
    access: { allowedHosts: reachableAt, token },
    runtime: { installKind, supervised },
  });

  // A restart after an update races the outgoing process for the port. Under
  // supervision the old sibling is already exiting, so wait it out briefly;
  // unsupervised keeps the old fail-fast.
  for (let attempt = 0; ; attempt++) {
    try {
      await app.listen({ port: PORT, host: HOST });
      break;
    } catch (err) {
      if ((err as { code?: string }).code === 'EADDRINUSE' && supervised && attempt < 10) {
        await new Promise((r) => setTimeout(r, 300));
        continue;
      }
      throw err;
    }
  }

  // Ctrl-C / kill: finish or abort in-flight work, close the database, then
  // leave. The force timer is unref'd so it never keeps a clean exit alive.
  let closing = false;
  const shutdown = (signal: NodeJS.Signals) => {
    if (closing) return;
    closing = true;
    console.log(`\n  ${signal} — closing scenri…`);
    setTimeout(() => process.exit(1), 5000).unref();
    app
      .drain()
      .then(() => process.exit(0))
      .catch(() => process.exit(1));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // First look ~10s after listen, then daily. check() itself honours the
  // Settings toggle and SCENRI_NO_UPDATE_CHECK, and stays silent offline.
  app.updates.schedule();

  const query = token ? `/?t=${token}` : '';
  const localUrl = `http://127.0.0.1:${PORT}${query}`;

  console.log(`\n  scenri studio → ${localUrl}`);
  for (const ip of reachableAt) console.log(`  on your network → http://${ip}:${PORT}${query}`);
  console.log(`  data dir        → ${core.home}\n`);
  if (!studioDist) console.log('  (studio UI not built, API only. Run: pnpm build)\n');
  if (token) {
    console.log('  Warning: the studio is reachable from your network.');
    console.log('  Anyone who opens a link above can generate on your API keys and');
    console.log('  delete your library. The token in the URL is the only thing gating');
    console.log('  that, and it is new on every run.');
    console.log('  For this machine only, unset SCENRI_HOST.\n');
  }
  if (process.env.SCENRI_NO_OPEN !== '1') {
    try {
      const { default: open } = await import('open');
      await open(localUrl);
    } catch {
      /* headless env */
    }
  }
}

/**
 * The staged-install probe: prove this build can actually run on this machine
 * — the native modules load under the running node — without touching the
 * user's database. The updater spawns this and requires {"ok":true}.
 */
export async function verify(): Promise<void> {
  try {
    const { default: Database } = await import('better-sqlite3');
    const db = new Database(':memory:');
    db.pragma('user_version');
    db.close();
    const { default: sharp } = await import('sharp');
    await sharp({ create: { width: 1, height: 1, channels: 3, background: '#000' } })
      .png()
      .toBuffer();
    console.log(JSON.stringify({ ok: true, version: readMeta().version }));
  } catch (err) {
    console.log(JSON.stringify({ ok: false, error: String((err as Error)?.message ?? err) }));
    process.exit(1);
  }
}
