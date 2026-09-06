import { createCore, SchemaTooNewError } from '@scenri/core';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { homedir, networkInterfaces } from 'node:os';
import { randomBytes } from 'node:crypto';
import { createEngineRegistry } from './engines.js';
import { createDemoEngine, demoOptionsFromEnv } from '@scenri/engine-demo';
import { buildServer } from './server.js';
import { detectInstallKind } from './installKind.js';
import { repairPresenterCrops } from './presenterRepair.js';
import { readMeta } from './meta.js';
import { portBusyLines } from './bootError.js';

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

export { detectInstallKind } from './installKind.js';

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
  const stubs =
    process.env.SCENRI_DEMO_ENGINE === '1'
      ? [createDemoEngine((b: Buffer) => core.images.save(b), demoOptionsFromEnv(process.env))]
      : [];
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
    runtime: {
      installKind,
      supervised,
      launcherProtocol: Number(process.env.SCENRI_LAUNCHER_PROTOCOL ?? '1') || 1,
    },
  });

  // A restart after an update races the outgoing process for the port. Under
  // supervision the old sibling is already exiting, so wait it out briefly;
  // unsupervised keeps the old fail-fast.
  for (let attempt = 0; ; attempt++) {
    try {
      await app.listen({ port: PORT, host: HOST });
      break;
    } catch (err) {
      if ((err as { code?: string }).code === 'EADDRINUSE') {
        if (supervised && attempt < 10) {
          await new Promise((r) => setTimeout(r, 300));
          continue;
        }
        // Someone already answers on this port. If it is Scenri, a second
        // start is not a failure — hand the person their running studio. The
        // timeout matters: a non-HTTP occupant accepts the socket and never
        // replies, and an unbounded fetch would hang this process silently.
        try {
          const res = await fetch(`http://127.0.0.1:${PORT}/api/version`, {
            signal: AbortSignal.timeout(2000),
          });
          const info = (await res.json()) as { name?: string };
          if (info.name === readMeta().name) {
            const url = `http://127.0.0.1:${PORT}`;
            console.log(`\n  Scenri is already running → ${url}\n`);
            if (process.env.SCENRI_NO_OPEN !== '1') {
              try {
                const { default: open } = await import('open');
                await open(url);
              } catch {
                /* headless env */
              }
            }
            process.exit(0);
          }
        } catch {
          /* not Scenri, or not answering — a foreign app owns the port */
        }
        console.error('');
        for (const line of portBusyLines(PORT)) console.error(`  ${line}`);
        console.error('');
        process.exit(1);
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
    console.log(`\n  ${signal}: closing Scenri…`);
    setTimeout(() => process.exit(1), 5000).unref();
    app
      .drain()
      .then(() => process.exit(0))
      .catch(() => process.exit(1));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // First look ~10s after listen, then a staleness tick every few minutes. check() itself honours the
  // Settings toggle and SCENRI_NO_UPDATE_CHECK, and stays silent offline.
  // One pass over custom presenters whose thumbnails predate the crop fix.
  // Content-addressed, so a healthy library is a read-only walk: it still
  // decodes every custom presenter's first shot through sharp, which is why
  // it runs after listen and never holds the port. A commit re-reads the
  // brand and patches one presenter by id, so a live write is never clobbered.
  void repairPresenterCrops(core, (line) => console.log(line)).catch(() => undefined);
  app.updates.schedule();
  // The one-time library download, shortly after listen. ensure() honours
  // SCENRI_NO_CONTENT_FETCH and its Settings toggle, and stays silent offline.
  app.content.schedule();

  const query = token ? `/?t=${token}` : '';
  const localUrl = `http://127.0.0.1:${PORT}${query}`;

  console.log(`\n  Scenri Studio → ${localUrl}`);
  for (const ip of reachableAt) console.log(`  on your network → http://${ip}:${PORT}${query}`);
  console.log(`  data dir        → ${core.home}`);
  console.log('  Keep this window open while Scenri is running.\n');
  if (!studioDist) console.log('  (studio UI not built, API only. Run: pnpm build)\n');
  if (token) {
    console.log('  Warning: the studio is reachable from your network.');
    console.log('  Anyone who opens a link above can generate on your API keys and');
    console.log('  delete your library. The token in the URL is the only thing gating');
    console.log('  that, and it is new on every run.');
    console.log('  For this machine only, unset SCENRI_HOST.\n');
  }
  if (process.env.SCENRI_NO_OPEN !== '1') {
    // Headless or browserless environment: the URL above is the fallback,
    // repeated so the last line on screen is the thing to click. The spawn
    // listeners matter as much as the catch: on macOS a missing opener fails
    // asynchronously on the child, not by throwing.
    let told = false;
    const tellUrl = () => {
      if (told) return;
      told = true;
      console.log(`  Open ${localUrl} in your browser.\n`);
    };
    try {
      const { default: open } = await import('open');
      const child = await open(localUrl);
      child.once('error', tellUrl);
      child.once('exit', (openExit) => {
        if (openExit !== null && openExit !== 0) tellUrl();
      });
    } catch {
      tellUrl();
    }
  }

  // The desktop icon. An installed launcher is quietly kept current (a new
  // bootstrap or icon, a node that moved, a newer build to adopt); one that
  // was never installed is offered exactly once, at a terminal, after the
  // browser is already open. SCENRI_NO_DESKTOP=1 silences both.
  const ownEntry = fileURLToPath(import.meta.url);
  const { addToDesktop, installDeps } = await import('./desktop/cli.js');
  const { refreshLauncher } = await import('./desktop/refresh.js');
  const { askOnTerminal, offerDesktop, shouldOfferDesktop } = await import('./desktop/offer.js');
  const { launcherInstalled } = await import('./desktop/paths.js');
  const meta = readMeta();
  void refreshLauncher({ ...installDeps(ownEntry), ownEntry, installKind, pkg: meta.name })
    .then((r) => {
      if (r.adopted)
        console.log(`  keeping a copy of Scenri ${meta.version} in ${join(core.home, 'app')} for the desktop icon`);
    })
    .catch(() => undefined);
  const offer = shouldOfferDesktop({
    env: process.env,
    stdinTTY: Boolean(process.stdin.isTTY),
    stdoutTTY: Boolean(process.stdout.isTTY),
    platform: process.platform,
    installKind,
    launcherInstalled: launcherInstalled(homedir()),
    declined: core.store.getSetting('desktop.prompt') === 'declined',
  });
  if (offer) {
    await offerDesktop({
      ask: askOnTerminal,
      add: () => addToDesktop(ownEntry),
      decline: () => core.store.setSetting('desktop.prompt', 'declined'),
      say: (line) => console.log(line),
    });
    console.log('');
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
