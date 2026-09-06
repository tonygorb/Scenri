/**
 * Settings > About's side of the desktop launcher: what state it is in, add
 * or recreate it, and quit Scenri. Quit is the twin of the update restart:
 * never over live work, answer first, then drain and leave with 0 so a
 * supervising launcher does not respawn.
 */
import type { FastifyInstance } from 'fastify';
import type { Core } from '@scenri/core';
import type { InstallKind } from '../installKind.js';
import type { DesktopStatus, InstallResult } from '../desktop/install.js';

export function registerDesktopRoutes(
  app: FastifyInstance,
  deps: {
    core: Core;
    runtime: { installKind: InstallKind; supervised: boolean; entry?: string };
    busyCount: () => number;
    exitImpl?: (code: number) => void;
    /** Injected in tests; the default reads the real launcher record and Desktop. */
    statusImpl?: () => Promise<DesktopStatus>;
    installImpl?: () => Promise<InstallResult>;
  },
): void {
  const { core, runtime } = deps;

  const status =
    deps.statusImpl ??
    (async (): Promise<DesktopStatus> => {
      if (!runtime.entry) {
        return {
          supported: false,
          platform: process.platform,
          installed: false,
          path: null,
          current: false,
          record: null,
        };
      }
      const { installDeps } = await import('../desktop/cli.js');
      const { desktopStatus } = await import('../desktop/install.js');
      return desktopStatus(installDeps(runtime.entry));
    });

  const install =
    deps.installImpl ??
    (async (): Promise<InstallResult> => {
      if (!runtime.entry) {
        return { ok: false, reason: 'unsupported', message: 'Desktop shortcuts are not available on this system yet.' };
      }
      const { addToDesktop } = await import('../desktop/cli.js');
      return addToDesktop(runtime.entry);
    });

  app.get('/api/desktop', async () => {
    const s = await status();
    return {
      supported: s.supported,
      platform: s.platform,
      installed: s.installed,
      path: s.path,
      declined: core.store.getSetting('desktop.prompt') === 'declined',
      installKind: runtime.installKind,
    };
  });

  app.post('/api/desktop/install', async (_req, reply) => {
    if (runtime.installKind === 'dev') {
      return reply.status(409).send({
        error: 'Running from a source checkout; there is no installed build to put on a desktop.',
        reason: 'dev',
      });
    }
    const res = await install();
    if (!res.ok) return reply.status(409).send({ error: res.message, reason: res.reason });
    return { ok: true, path: res.path };
  });

  app.post('/api/system/quit', async (_req, reply) => {
    const busy = deps.busyCount();
    if (busy > 0) {
      return reply.status(409).send({ error: `work is still running (${busy} task${busy === 1 ? '' : 's'})` });
    }
    // Answer first, then go: the browser needs this reply to show its stopped
    // overlay before the socket disappears.
    reply.send({ ok: true });
    const exit = deps.exitImpl ?? ((code: number) => process.exit(code));
    setTimeout(() => {
      let done = false;
      setTimeout(() => {
        if (!done) exit(0);
      }, 5000).unref();
      void app
        .drain()
        .then(() => {
          done = true;
          exit(0);
        })
        .catch(() => {
          done = true;
          exit(0);
        });
    }, 50);
  });
}
