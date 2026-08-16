# How scenri updates itself

`npx scenri` starts a small supervising launcher. The launcher looks in
`~/.scenri/app/versions/` for a newer staged copy of scenri, runs the newest
one it finds (or the copy it shipped with), and restarts it when an update
asks for a restart. Application code and your library never share a directory:

```
~/.scenri/
  scenri.db, images/, backups/     your work — no update touches these
  app/
    staging/<version>/             npm's workbench while an update downloads
    versions/<version>/            installed app versions, newest wins
```

`rm -rf ~/.scenri/app` is always safe. It removes staged app versions only;
the next `npx scenri` rebuilds it.

## The update check

Once a day, the running server asks the npm registry for the latest published
version — one GET of the dist-tags document, nothing else sent, 5 seconds max,
silent when offline. It is scenri's only self-initiated network request, and
it is disclosed in Settings → About and once in the console.

Turning it off (either works):

- Settings → About → "Check for updates automatically" → Turn off
- `SCENRI_NO_UPDATE_CHECK=1`

`SCENRI_REGISTRY` points the check *and* the download at a different registry
(a mirror, an airgap proxy, a fork's registry). A fork that renames the
package gets its own updates automatically: the package name and repository
are read from `package.json` at runtime, never hardcoded.

## Applying an update

- **In the app**: the Update button on the floating notice (or Settings →
  About) downloads the new version next to the running one, verifies it
  actually loads, and restarts into it. The browser reconnects by itself.
  "Not now" holds the notice for the rest of the session; the next launch
  offers it again, and updating ends it for good.
- **In a terminal**: `scenri update` (with npx: `npx scenri update`) stages
  the newest version; it runs on the next start. `scenri update --check`
  only reports.
- **From a checkout**: you are on the git workflow — `git pull` and rebuild.
  The app detects a source install and will never offer to overwrite it.

A staged version is installed by npm (with npm's own tarball integrity
checking; releases are published with npm provenance), then proven to load —
including the native modules — by running its own `verify` under the local
node before it is ever handed to the launcher. A version that fails
verification is discarded, and the one that failed to boot is skipped with a
fallback to the build that last worked.

Updates never run while a generation is in flight, and they are always
user-triggered: nothing installs or restarts on its own.

## What's new

Two different sentences, deliberately kept apart:

- **Update available** — "there is a newer scenri." Comes from the check above,
  asks you to act, and lives in the floating notice and Settings → About.
- **What's new** — "here is what changed in the version you now have." Asks for
  nothing. Comes from release notes authored by hand and shipped *inside* the
  build (`packages/cli/src/release/notes.data.ts`), so it answers offline and
  always describes the version actually running.

The dialog is the running version: a headline where there is one, then two to
four product areas. History is the **releases page**, linked once as "All
releases". The generated `CHANGELOG.md` stays what it has always been — the
commit-level history for developers.

The lifecycle is one rule and one stored value (`whatsnew.seen`, in the
settings table):

1. The app reads its own notes once at startup — the running version's record,
   and the releases page to point at.
2. If `whatsnew.seen` is not the running version, the brand menu shows an
   unread dot immediately, and What's New opens itself **once** — but only at a
   safe moment: nothing generating, nothing building, no other dialog open, the
   brand loaded, the tab in front, and a couple of seconds after all of that
   settles. If a safe moment never comes, nothing pops; the dot carries it.
3. Any way out — Escape, the ×, the backdrop, "Got it" — is the
   acknowledgement. It never returns for that version.
4. **What's new** in the brand menu, and the row in Settings → About, reopen it
   at any time. Neither is gated on anything.

### Where the words come from

Nobody writes release prose twice, and nothing generates it behind your back.

release-please owns the version: it reads the conventional commits on `main`,
decides the bump, and writes `CHANGELOG.md` — the commit-level history, for
developers. The *written* record is separate and lives in
`packages/cli/src/release/notes.data.ts`, one entry per published version.

That record is authored with the `release-notes` skill, which reads the real
commits since the last tag, drops everything a user would not notice, groups
what is left into two to four product lines, and writes the entry. Every line
has to trace to a commit in the range; counts like "8 new Scenes" are counted
from added files, never estimated. `releaseNotes.test.ts` validates the result
and fails the release PR until the record matches the version being released,
which is what keeps a version and its notes atomic.

The same record feeds the GitHub release page: `scripts/release-body.ts`
renders it as markdown and `publish.yml` — on `release: published`, after the
package goes out — puts it above release-please's generated notes. If the record
is missing the script prints nothing and the step leaves the generated notes
alone, so a release-note problem can never fail a release.

That step rewrites the release body in place, so running it twice for one tag
stacks a second copy of the record above the first. v0.1.0 is in that state.

A version with nothing user-facing still gets a record, with `sections: []`.
That is a maintenance release saying so on purpose, and the app reads it that
way: no dialog, no dot.

The first boot of a new home stamps `install.firstVersion` and marks the
running version as already seen, so a brand-new install is never met with a
modal explaining changes it has no memory of.

Updates never install or restart on their own — see above. What's New is only
ever a description of what already happened.

## Migrations and backups

The database carries a schema version (`PRAGMA user_version`). Before an
older database is migrated, a consistent snapshot is written to
`~/.scenri/backups/` (the newest three are kept). A database written by a
*newer* scenri is refused with instructions rather than half-read.

## Protocol v1 (frozen)

The launcher a user first ran may be cached by npx for a long time, so the
contract between launcher and app changes only with a protocol bump:

1. Versions live at `$SCENRI_HOME/app/versions/<v>/node_modules/<pkg>/`; a
   dir is valid iff that package.json's `version` matches `<v>` and
   `dist/index.js` exists. Atomic rename from `app/staging/` is the
   completion marker.
2. The launcher starts the app as `node <…>/dist/index.js serve`.
3. Child exit code **75** means "respawn whatever is newest now".
4. SIGINT/SIGTERM are forwarded to the child; a signalled exit never respawns.
5. The child receives `SCENRI_SUPERVISED=1`, `SCENRI_LAUNCHER_PROTOCOL`, and
   `SCENRI_LAUNCHER_VERSION`.

The app refuses one-click updates when it is not supervised, or when the
supervising launcher's protocol is older than it needs — the manual
`scenri update` path always remains.
