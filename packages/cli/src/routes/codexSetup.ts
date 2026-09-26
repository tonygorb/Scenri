import type { FastifyInstance } from 'fastify';
import { CONFLICT_ENV_KEYS, createCodexSetup, type CodexRunner, type CodexSetup } from '@scenri/engine-codex';
import { fromThisComputer } from '../access.js';

/**
 * Which variables Scenri keeps out of codex's environment, and nothing more.
 * The list is the user's decision, recorded in their own library; the machine
 * itself is never touched, so undoing it is a row, not a repair.
 */
export interface CodexEnvRepair {
  get(): string[];
  set(keys: string[]): void;
}

export function registerCodexSetupRoutes(
  app: FastifyInstance,
  deps: { codexSetup?: CodexSetup; codexRunner?: CodexRunner; envRepair?: CodexEnvRepair },
): void {
  // ---- codex setup (the guided path for people who have never opened a terminal)
  //
  // These run two official commands on the user's own machine: a global npm
  // install, and `codex login`, which opens their browser. No credential is
  // read, copied or stored here — the session lands in codex's own config and
  // stays there. Every one of them acts on this computer, so only this computer
  // may ask: a phone's code travels over plain http and can be overheard.
  const codexSetup: CodexSetup = deps.codexSetup ?? createCodexSetup({ runner: deps.codexRunner });
  /** One install/login/repair at a time: two concurrent npm installs fight over the same prefix. */
  let codexSetupBusy: 'install' | 'login' | 'repair' | null = null;

  /**
   * `force` is the only thing here that deliberately spends a turn of the
   * user's ChatGPT plan: it throws away the stored verdict and runs a real
   * `codex exec` to find out whether generation would work right now. Bare
   * status reads what the last check or the last shot already proved.
   *
   * A GET passes the access guard's cross-site checks, so an <img> on a page
   * at another localhost port, or any site's link opened at the top level,
   * could spend that turn. Only the studio's own Check again (same-origin),
   * the address typed in (none) or a non-browser client (no header) may force.
   */
  app.get('/api/engines/codex/status', async (req) => {
    const site = req.headers['sec-fetch-site'];
    const force =
      (req.query as { force?: string } | undefined)?.force === '1' &&
      (site === undefined || site === 'same-origin' || site === 'none');
    return codexSetup.status({ force });
  });

  app.post('/api/engines/codex/install', async (req, reply) => {
    if (!fromThisComputer(req)) return reply.status(403).send({ error: 'Only on the computer running Scenri.' });
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

  app.post('/api/engines/codex/login', async (req, reply) => {
    if (!fromThisComputer(req)) return reply.status(403).send({ error: 'Only on the computer running Scenri.' });
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

  /**
   * Stop passing named credentials down to codex.
   *
   * Nothing on the machine changes: the variables stay exactly where the user
   * put them, and Scenri simply launches codex without them. Only the names
   * codex itself reads are accepted, so this cannot become a general way to
   * strip a child's environment.
   */
  app.post('/api/engines/codex/repair-env', async (req, reply) => {
    if (!fromThisComputer(req)) return reply.status(403).send({ error: 'Only on the computer running Scenri.' });
    const repair = deps.envRepair;
    if (!repair) return reply.status(501).send({ error: 'not available on this server' });
    const asked = (req.body as { keys?: unknown } | undefined)?.keys;
    if (!Array.isArray(asked) || asked.length === 0) return reply.status(400).send({ error: 'keys required' });
    const keys = asked.map((k) => String(k).trim().toUpperCase());
    const unknown = keys.filter((k) => !(CONFLICT_ENV_KEYS as readonly string[]).includes(k));
    if (unknown.length > 0) return reply.status(400).send({ error: `not a Codex credential: ${unknown.join(', ')}` });
    if (codexSetupBusy) return reply.status(409).send({ error: `already running: ${codexSetupBusy}` });
    codexSetupBusy = 'repair';
    try {
      repair.set([...new Set([...repair.get(), ...keys])]);
      // The stored verdict was about the old environment. Prove the new one.
      return { ok: true, ...(await codexSetup.status({ force: true })) };
    } finally {
      codexSetupBusy = null;
    }
  });

  /** The undo, in the same place as the do. */
  app.post('/api/engines/codex/restore-env', async (req, reply) => {
    if (!fromThisComputer(req)) return reply.status(403).send({ error: 'Only on the computer running Scenri.' });
    const repair = deps.envRepair;
    if (!repair) return reply.status(501).send({ error: 'not available on this server' });
    if (codexSetupBusy) return reply.status(409).send({ error: `already running: ${codexSetupBusy}` });
    codexSetupBusy = 'repair';
    try {
      repair.set([]);
      return { ok: true, ...(await codexSetup.status({ force: true })) };
    } finally {
      codexSetupBusy = null;
    }
  });
}
