import { join } from 'node:path';
import { existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { spawn } from 'node:child_process';
import JSZip from 'jszip';
import type { FastifyInstance } from 'fastify';
import type { Core } from '@scenri/core';

export function registerSystemRoutes(app: FastifyInstance, deps: { core: Core }): void {
  const { core } = deps;
  app.get('/api/home', async () => {
    const imagesDir = join(core.home, 'images');
    let files = 0,
      bytes = 0;
    if (existsSync(imagesDir)) {
      for (const f of readdirSync(imagesDir)) {
        try {
          bytes += statSync(join(imagesDir, f)).size;
          files++;
        } catch {
          /* vanished mid-walk */
        }
      }
    }
    const dbPath = join(core.home, 'scenri.db');
    const dbBytes = existsSync(dbPath) ? statSync(dbPath).size : 0;
    return { dir: core.home, dbPath, images: files, bytes: bytes + dbBytes };
  });

  /** Open the library in the OS file manager. Local app only, by nature. */
  app.post('/api/system/reveal', async (_req, reply) => {
    const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open';
    try {
      spawn(cmd, [core.home], { detached: true, stdio: 'ignore' }).unref();
    } catch {
      /* headless box */
    }
    return reply.send({ ok: true });
  });

  /** Everything you made, as one zip. Never keys: those live in the settings table, which this never reads. */
  app.get('/api/export/all', async (_req, reply) => {
    const zip = new JSZip();
    const brands = core.store.listBrands();
    zip.file('brands.json', JSON.stringify(brands, null, 2));
    const seen = new Set<string>();
    for (const brand of brands) {
      for (const project of core.store.listProjects(brand.id)) {
        const tree = core.store.treeFor(project.id);
        zip.file(`projects/${project.id}/tree.json`, JSON.stringify({ project, nodes: tree }, null, 2));
        for (const node of tree) {
          for (const hash of node.images ?? []) {
            if (seen.has(hash) || !core.images.has(hash)) continue;
            seen.add(hash);
            zip.file(`images/${hash}.png`, core.images.read(hash));
          }
        }
      }
    }
    const buf = await zip.generateAsync({ type: 'nodebuffer' });
    reply
      .header('content-type', 'application/zip')
      .header('content-disposition', 'attachment; filename="scenri-library.zip"');
    return reply.send(buf);
  });

  /**
   * The danger zone. `shots` keeps brands, cast and scenes and only drops what
   * was generated; `all` empties the home directory. Scoped to SCENRI_HOME,
   * never a path from the request.
   */
  app.delete('/api/data', async (req, reply) => {
    const scope = String((req.query as any)?.scope ?? '');
    if (scope !== 'shots' && scope !== 'all') return reply.status(400).send({ error: 'scope must be shots or all' });
    if (scope === 'shots') {
      let removed = 0;
      for (const brand of core.store.listBrands()) {
        // the sets go with the shots: a set that survives a wipe is a name with
        // nothing behind it, which reads as work that quietly went missing
        for (const set of core.store.listSets(brand.id)) core.store.deleteSet(set.id);
        for (const project of core.store.listProjects(brand.id)) {
          core.store.deleteProject(project.id);
          removed++;
        }
      }
      return { ok: true, scope, projects: removed };
    }
    core.close();
    // User data by explicit name — never the whole home dir: ~/.scenri/app
    // holds the staged application versions, and one of them may be the code
    // answering this very request.
    for (const name of ['scenri.db', 'scenri.db-wal', 'scenri.db-shm', 'images', 'backups']) {
      // Retries are for Windows, where an open handle (a streaming image, an
      // antivirus pass) makes unlink fail transiently; a throw here would
      // leave the process alive with the database already closed.
      rmSync(join(core.home, name), { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
    return { ok: true, scope };
  });
}
