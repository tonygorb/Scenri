import type { FastifyInstance } from 'fastify';
import type { Core } from '@scenri/core';
import { SCHEMA_VERSION } from '@scenri/core';
import { classify, type CheckResult, type UpdateChecker } from '../update/check.js';
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
  // The internal era: published to npm, unpublished 2026-08-17, tags never
  // created. See the note above RELEASES in ../release/notes.data.ts.
  const UNTAGGED = new Set(['0.1.0', '0.1.1']);

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

  /** The one place staging starts. Sets the phase synchronously; the install itself runs in the background. */
  const startStaging = (target: string): void => {
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
  };

  /**
   * Background staging: a real registry answer naming a newer version
   * downloads it next to the running one, so the only question left for a
   * person is when to restart. Synchronous from guard to kickoff — no await
   * may sit between reading applyState and writing it. A failed stage waits
   * for the next real answer (the daily cadence, or a click in About) rather
   * than looping. A staged-and-ready version is replaced only by something
   * strictly newer; restarting into a just-obsoleted staged build is allowed,
   * the next boot's check discovers the newer one.
   */
  const maybeAutoStage = (r: CheckResult): void => {
    if (applyState.phase === 'error') applyState = { phase: 'idle', version: null, error: null };
    if (!updates.enabled()) return;
    if (!r.latest || classify(meta.version, r.latest) === null) return;
    if (blockReason() !== null) return;
    if (deps.busyCount() > 0) return;
    const apply = effectiveApply();
    if (apply.phase === 'staging') return;
    if (apply.phase === 'ready' && compareSemver(r.latest, apply.version ?? '') <= 0) return;
    startStaging(r.latest);
  };
  updates.onResult(maybeAutoStage);
  // The daily cadence only fetches once the cache has gone stale, so a boot
  // inside the 24h window would never hear onResult and a known update could
  // sit unstaged for a day. One deferred look at the cached answer covers it;
  // when the cache was stale after all, the subscriber fires too and the
  // staging-phase guard makes the second call a no-op.
  setTimeout(() => void updates.check().then(maybeAutoStage), 15_000).unref();

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

    const r = await updates.check();
    const kind = r.latest ? classify(meta.version, r.latest) : null;
    if (!r.latest || kind === null) return reply.status(409).send({ error: 'nothing newer to install' });

    // The check above may itself have kicked off auto-staging through the
    // subscriber. Same target: the click succeeded, the work is simply
    // already underway (or done). A different in-flight version keeps its 409.
    const target = r.latest;
    const current = effectiveApply();
    if ((current.phase === 'staging' || current.phase === 'ready') && current.version === target) {
      return { ok: true, staging: target };
    }
    if (current.phase === 'staging') return reply.status(409).send({ error: 'an update is already staging' });

    startStaging(target);
    return { ok: true, staging: target };
  });

  app.post('/api/update/restart', async (_req, reply) => {
    const apply = effectiveApply();
    if (apply.phase !== 'ready') return reply.status(409).send({ error: 'no staged update to restart into' });
    // Same doctrine as apply: never over live work. A restart mid-generation
    // is the one way this system could cost someone an image.
    const busy = deps.busyCount();
    if (busy > 0) {
      return reply
        .status(409)
        .send({ error: `work is still running (${busy} task${busy === 1 ? '' : 's'})`, blockReason: 'busy' });
    }
    if (!runtime.supervised) {
      return reply.status(409).send({ error: 'not supervised; restart Scenri yourself', blockReason: 'unsupervised' });
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
  // newer Scenri" and ask you to act; this one answers "here is what you got"
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
      // publishing is what creates the tag. The exceptions are the internal
      // 0.1.x builds: published, unpublished, never tagged. Their numbers are
      // burned on npm and a tag link would 404.
      changelogUrl:
        ghSlug && meta.version !== UNRELEASED && !UNTAGGED.has(meta.version)
          ? `https://github.com/${ghSlug}/releases/tag/v${meta.version}`
          : null,
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
