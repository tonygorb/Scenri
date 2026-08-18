import type { FastifyInstance } from 'fastify';
import type { Core } from '@scenri/core';
import { SCHEMA_VERSION } from '@scenri/core';
import { classify, type UpdateChecker } from '../update/check.js';
import { findNpm, stageVersion } from '../update/stage.js';
import { compareSemver, newestStaged } from '../update/versionsDir.js';
import { RELEASES, isNewsworthy, releaseFor } from '../release/notes.data.js';
import { repoSlug, type Meta } from '../meta.js';
import type { InstallKind } from '../server.js';

export function registerUpdateRoutes(
  app: FastifyInstance,
  deps: {
    core: Core;
    meta: Meta;
    updates: UpdateChecker;
    runtime: { installKind: InstallKind; supervised: boolean; launcherProtocol?: number };
    stageImpl?: typeof stageVersion;
    exitImpl?: (code: number) => void;
    /** In-flight generations + imports + asset builds, for the never-over-live-work gate. */
    busyCount: () => number;
  },
): void {
  const { core, meta, updates, runtime } = deps;
  app.get('/api/version', async () => ({
    name: meta.name,
    version: meta.version,
    schema: SCHEMA_VERSION,
    installKind: runtime.installKind,
    supervised: runtime.supervised,
    home: core.home,
  }));

  // ---- updates: check (npm dist-tags, daily, cached) + notes (GitHub release)
  const ghSlug = repoSlug(meta.repository);
  /** The version a build carries before release-please has ever bumped it. */
  const UNRELEASED = '0.0.0';

  // The apply state machine: idle → staging → ready | error. 'ready' also
  // covers a version staged by `scenri update` in a terminal before this boot.
  let applyState: { phase: 'idle' | 'staging' | 'ready' | 'error'; version: string | null; error: string | null } = {
    phase: 'idle',
    version: null,
    error: null,
  };
  const effectiveApply = () => {
    if (applyState.phase === 'idle') {
      const staged = newestStaged(core.home, meta.name);
      if (staged && compareSemver(staged, meta.version) > 0) {
        return { phase: 'ready' as const, version: staged, error: null };
      }
    }
    return applyState;
  };

  /** Why one-click cannot run here, or null when it can. The manual `scenri update` always remains. */
  const REQUIRED_PROTOCOL = 1;
  let npmProbe: boolean | null = null;
  const blockReason = (): 'dev' | 'unsupervised' | 'launcher-too-old' | 'no-npm' | null => {
    if (runtime.installKind === 'dev') return 'dev';
    if (!runtime.supervised) return 'unsupervised';
    if ((runtime.launcherProtocol ?? 1) < REQUIRED_PROTOCOL) return 'launcher-too-old';
    if (deps.stageImpl) return null; // injected staging carries its own npm story
    npmProbe ??= findNpm() !== null;
    return npmProbe ? null : 'no-npm';
  };

  const updateStatus = async (force = false) => {
    const r = await updates.check(force);
    const kind = r.latest ? classify(meta.version, r.latest) : null;
    const apply = effectiveApply();
    return {
      enabled: updates.enabled(),
      current: meta.version,
      latest: r.latest,
      available: kind !== null,
      kind,
      // Pre-1.0, release-please folds breaking changes into minors
      // (bump-minor-pre-major), so only a real major asks for attention.
      attention: kind === 'major',
      checkedAt: r.checkedAt,
      notesUrl: r.latest && ghSlug ? `https://github.com/${ghSlug}/releases/tag/v${r.latest}` : null,
      error: apply.phase === 'error' ? apply.error : r.error,
      canApply: blockReason() === null,
      blockReason: blockReason(),
      phase: apply.phase,
      stagedVersion: apply.version,
    };
  };

  app.get('/api/update/status', async () => updateStatus());
  app.post('/api/update/check', async () => updateStatus(true));

  app.post('/api/update/apply', async (_req, reply) => {
    // Never over live work: a restart mid-generation is the one way this
    // system could cost someone an image.
    const busy = deps.busyCount();
    if (busy > 0) {
      return reply.status(409).send({ error: `work is still running (${busy} task${busy === 1 ? '' : 's'})` });
    }
    const block = blockReason();
    if (block)
      return reply.status(409).send({ error: `one-click update cannot run here (${block})`, blockReason: block });
    if (applyState.phase === 'staging') return reply.status(409).send({ error: 'an update is already staging' });

    const r = await updates.check();
    const kind = r.latest ? classify(meta.version, r.latest) : null;
    if (!r.latest || kind === null) return reply.status(409).send({ error: 'nothing newer to install' });

    const target = r.latest;
    applyState = { phase: 'staging', version: target, error: null };
    void (deps.stageImpl ?? stageVersion)({
      home: core.home,
      pkg: meta.name,
      source: { version: target },
      keep: new Set([meta.version]),
    })
      .then((res) => {
        applyState = res.ok
          ? { phase: 'ready', version: res.version, error: null }
          : { phase: 'error', version: null, error: `${res.reason}: ${res.detail}` };
      })
      .catch((err) => {
        applyState = { phase: 'error', version: null, error: String((err as Error)?.message ?? err) };
      });
    return { ok: true, staging: target };
  });

  app.post('/api/update/restart', async (_req, reply) => {
    const apply = effectiveApply();
    if (apply.phase !== 'ready') return reply.status(409).send({ error: 'no staged update to restart into' });
    if (!runtime.supervised) {
      return reply.status(409).send({ error: 'not supervised — restart scenri yourself', blockReason: 'unsupervised' });
    }
    // Answer first, then go: the browser needs this reply to start its
    // reconnect overlay before the socket disappears.
    reply.send({ ok: true });
    const exit = deps.exitImpl ?? ((code: number) => process.exit(code));
    setTimeout(() => {
      let done = false;
      setTimeout(() => {
        if (!done) exit(75);
      }, 5000).unref();
      void app
        .drain()
        .then(() => {
          done = true;
          exit(75);
        })
        .catch(() => {
          done = true;
          exit(75);
        });
    }, 50);
  });
  // ---- what's new: the version this build IS, from data shipped inside it.
  // Deliberately not the update routes' business. Those answer "there is a
  // newer scenri" and ask you to act; this one answers "here is what you got"
  // and asks nothing. Fusing them is what made the old notes route describe a
  // version the user did not have, then vanish the moment they installed it.
  app.get('/api/release/notes', async () => {
    // A fresh install must not open a modal explaining changes to someone who
    // has never seen the app. The first boot of a new home stamps both keys,
    // so `seen` already equals the running version and nothing pops. The cost
    // is one-time and known: the release that introduces this will not
    // announce itself on an install that predates the marker.
    if (!core.store.getSetting('install.firstVersion')) {
      core.store.setSetting('install.firstVersion', meta.version);
      core.store.setSetting('whatsnew.seen', meta.version);
    }
    return {
      version: meta.version,
      entry: releaseFor(meta.version),
      seen: core.store.getSetting('whatsnew.seen') || null,
      // 0.0.0 is the placeholder release-please has not bumped yet. No tag has
      // ever existed for it, and the releases index of a project that has not
      // released is an empty page, so there is nowhere honest to point: null.
      // Its absence is also what tells the dialog it is looking at a
      // development build rather than a release nobody wrote notes for.
      // Every other version a user can be running was published, and
      // publishing is what creates the tag.
      changelogUrl:
        ghSlug && meta.version !== UNRELEASED ? `https://github.com/${ghSlug}/releases/tag/v${meta.version}` : null,
      // Where everything before the three in the dialog lives. The index, not
      // a tag: this one is the archive, and it outlives the version running.
      // Gated on there being an archive at all, so a project that has never
      // published does not offer a link to an empty page. Never use it to
      // decide whether *this build* was released — `changelogUrl` answers that.
      releasesUrl: ghSlug && RELEASES.some(isNewsworthy) ? `https://github.com/${ghSlug}/releases` : null,
    };
  });

  app.post('/api/release/seen', async (req) => {
    // The version is the client's, not ours: it acknowledges what it was shown,
    // which is the version it loaded. Anything else and a restart mid-read
    // could mark the wrong release as read.
    const v = (req.body as { version?: unknown } | undefined)?.version;
    core.store.setSetting('whatsnew.seen', typeof v === 'string' && v ? v : meta.version);
    return { ok: true };
  });
}
