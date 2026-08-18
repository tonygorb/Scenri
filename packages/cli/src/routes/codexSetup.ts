import type { FastifyInstance } from 'fastify';
import { createCodexSetup, type CodexSetup } from '@scenri/engine-codex';

export function registerCodexSetupRoutes(app: FastifyInstance, deps: { codexSetup?: CodexSetup }): void {
  // ---- codex setup (the guided path for people who have never opened a terminal)
  //
  // These run two official commands on the user's own machine: a global npm
  // install, and `codex login`, which opens their browser. No credential is
  // read, copied or stored here — the session lands in codex's own config and
  // stays there. Both are gated by the same access guard as everything else.
  const codexSetup: CodexSetup = deps.codexSetup ?? createCodexSetup();
  /** One install/login at a time: two concurrent npm installs fight over the same prefix. */
  let codexSetupBusy: 'install' | 'login' | null = null;

  app.get('/api/engines/codex/status', async () => codexSetup.status());

  app.post('/api/engines/codex/install', async (_req, reply) => {
    if (codexSetupBusy) return reply.status(409).send({ error: `already running: ${codexSetupBusy}` });
    codexSetupBusy = 'install';
    try {
      const res = await codexSetup.install();
      const { state } = await codexSetup.status();
      return { ...res, state };
    } finally {
      codexSetupBusy = null;
    }
  });

  app.post('/api/engines/codex/login', async (_req, reply) => {
    if (codexSetupBusy) return reply.status(409).send({ error: `already running: ${codexSetupBusy}` });
    codexSetupBusy = 'login';
    try {
      const res = await codexSetup.login();
      const { state } = await codexSetup.status();
      return { ...res, state };
    } finally {
      codexSetupBusy = null;
    }
  });
}
