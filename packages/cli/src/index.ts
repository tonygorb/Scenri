#!/usr/bin/env node
import { createCore } from '@scenri/core';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { randomBytes } from 'node:crypto';
import { createEngineRegistry } from './engines.js';
import { createDemoEngine } from '@scenri/engine-demo';
import { buildServer } from './server.js';

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

async function main() {
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

  const onlyThisMachine = LOOPBACK.includes(HOST);
  // Off loopback, "can reach the port" stops meaning "is sitting at this
  // machine", so the URLs we print carry a token that is new on every run.
  const token = onlyThisMachine ? undefined : randomBytes(24).toString('base64url');
  const reachableAt = onlyThisMachine ? [] : HOST === '0.0.0.0' || HOST === '::' ? lanAddresses() : [HOST];

  const app = buildServer({ core, engines, studioDist, access: { allowedHosts: reachableAt, token } });
  await app.listen({ port: PORT, host: HOST });

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

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
