# How Scenri updates itself

`npx scenri` starts a small supervising launcher. The launcher looks in
`~/.scenri/app/versions/` for a newer staged copy of Scenri, runs the newest
one it finds (or the copy it shipped with), and restarts it when an update
asks for a restart. Application code and your library never share a directory:

```
~/.scenri/
  scenri.db, images/, backups/     your work, no update touches these
  app/
    staging/next/                  npm's workbench while an update downloads
    versions/<version>/            installed app versions, newest wins
  launcher/                        the desktop icon's bootstrap and record (see below)
  logs/                            launcher.log and scenri.log, for a start with no terminal
```

`rm -rf ~/.scenri/app` is always safe. It removes staged app versions only;
the next `npx scenri` rebuilds it.

Installs first run before 0.4.1 cached a launcher that never actually
supervised on macOS and Linux (an argv symlink bug), and npx keeps reusing
that cache. One `npx scenri@latest` replaces it; everything on this page works
from then on.

## Seeing it as a user

A source checkout deliberately never updates itself, so contributors normally
only ever see the pull-and-rebuild row. To sit in the user's seat anyway, run
`pnpm build` and then:

```bash
node packages/cli/test/update-demo.mjs
```

A real supervised Scenri boots on a scratch home, sees 99.0.0 on a local
fixture registry, downloads and verifies it in the background, offers
the one-click Update, and really restarts into it when clicked. Ctrl-C ends
the demo and removes every temporary file; your checkout, your library and
your dev server are never touched.

## The update check

Every six hours, the running server asks the npm registry for the latest
published version: one GET of the dist-tags document, nothing else sent, 5
seconds max, silent when offline. A laptop that slept through a check catches
up within minutes of waking. It and the one-time library download below are
Scenri's only self-initiated network requests, and each is disclosed once in
the console (the update check also in Settings → Updates).

When the check finds a newer version on a supervised install, Scenri also
downloads that release from npm in the background and stages it next to the
running copy, verified and waiting. The download is part of the same choice:
the toggle and the variable below turn both off together. Restarting into the
staged version is always yours to click, and never happens over running work.

Turning it off (either works):

- Settings → Updates → "Check for updates automatically" → Turn off
- `SCENRI_NO_UPDATE_CHECK=1`

`SCENRI_REGISTRY` points the check *and* the download at a different registry
(a mirror, an airgap proxy, a fork's registry). A fork that renames the
package gets its own updates automatically: the package name and repository
are read from `package.json` at runtime, never hardcoded.

## The library download

The npm package carries the complete catalog and every thumbnail, so the whole
library is browsable offline from first launch. The heavy imagery (scene
reference galleries, showcase heroes, product shots, presenter identity sets)
is downloaded once from a versioned archive on the project's GitHub releases,
cached under `~/.scenri/content`, and never fetched again. One GET for one
file, nothing sent, silent when offline (the next launch simply retries).

- `SCENRI_NO_CONTENT_FETCH=1` skips the download entirely; Scenri stays on
  thumbnails.
- `SCENRI_CONTENT_URL` points a fork or an airgap mirror at its own archive.

`~/.scenri/content` is a cache, not user data: deleting it is always safe and
the next launch restores it.

## Applying an update

- **In the app**: a found update downloads and verifies itself in the
  background; the floating notice (and Settings → Updates) then offers one
  click, "Update", which restarts into the new version, and the browser
  reconnects by itself. Where the
  background download could not run, the same button does the whole job on
  click. "Not now" holds the notice for the rest of the session; the next
  launch offers it again, and updating ends it for good.
- **In a terminal**: `scenri update` (with npx: `npx scenri update`) stages
  the newest version; it runs on the next start. `scenri update --check`
  only reports.
- **From a checkout**: you are on the git workflow: `git pull` and rebuild.
  The app detects a source install and will never offer to overwrite it.

A staged version is installed by npm (with npm's own tarball integrity
checking; releases are published with npm provenance), then proven to load,
including the native modules, by running its own `verify` under the local
node before it is ever handed to the launcher. A version that fails
verification is discarded, and the one that failed to boot is skipped with a
fallback to the build that last worked.

Updates never run while a generation is in flight. Downloads happen on their
own when checks are on (that is the point: the update is ready before anyone
asks); restarts never do. Scenri restarts only when a person clicks, and never
over running work.

## What's new

Two different sentences, deliberately kept apart:

- **Update available**: "there is a newer Scenri." Comes from the check above,
  asks you to act, and lives in the floating notice and Settings → Updates.
- **What's new**: "here is what changed in the version you now have, and in
  the few before it." Asks for nothing. Comes from release notes authored by
  hand and shipped *inside* the build (`packages/cli/src/release/notes.data.ts`),
  pictures included, so it answers offline and always describes the version
  actually running.

It has two surfaces, one for each reason to look:

- **The dialog** introduces one update after an update: the newest headline
  update, with its picture, its date and version, its headline and its areas as
  short lines, then "See N more updates" and "Got it".
- **The What's new page** (`/<brand>/whats-new`) is for browsing. It lists the
  recent releases newest first, the newest headline update largest, and ends
  with **Full release notes**, the GitHub releases page, which is the archive for
  everything older and every fix a record left out. Help → What's new and
  Settings → Updates open it. It is not a place in the top bar.

Every record is one of three kinds, and the kind is written into the record:

- **Headline update**: it has a `title`. The only kind that may open the dialog
  by itself, and the only kind that may carry pictures (at most three).
- **Small update**: areas but no title. It marks Help as unread and is a short
  line on the page. It never opens anything.
- **Maintenance**: `sections: []`. It says nothing anywhere.

The page reaches back to the fifth headline update, with the small updates
between them. The generated `CHANGELOG.md` stays what it has always been: the
commit-level history for developers.

The lifecycle is one rule and one stored value (`whatsnew.seen`, in the
settings table):

1. The app reads its own notes once at startup: the running version's record,
   the recent history, which of it is unread, and the releases page to point at.
   Nothing reaches the network.
2. `whatsnew.seen` is a version and is compared as one. Anything newer than it,
   up to the running version, is unread. A rolled-back build shows nothing, and
   `seen` never goes backwards, whoever asks.
3. Anything unread puts the dot on the Help button and marks its "What's new"
   row. An unread **headline** update also opens the dialog by itself **once**,
   but only at a safe moment: nothing generating, nothing building, no other
   dialog in the address, nothing of first use on screen, not on the page
   itself, the brand loaded, the tab in front, and a couple of seconds after all
   of that settles. If a safe moment never comes, nothing pops; the dot carries
   it.
4. Any way out of the dialog, whether Escape, the ×, the backdrop, Back, "Got
   it" or the link to the page, reads everything up to the running version.
   Opening the page does the same.

### Where the words and pictures come from

Nobody writes release prose twice, and nothing generates it behind your back.

release-please owns the version: it reads the conventional commits on `main`,
decides the bump, and writes `CHANGELOG.md`, the commit-level history, for
developers. The *written* record is separate and lives in
`packages/cli/src/release/notes.data.ts`, one entry per published version.

That record is authored with the `release-notes` skill, which reads the real
commits since the last tag, drops everything a user would not notice, decides
the kind (headline, small or maintenance), groups what is left into one to three
product lines, and writes the entry. Every line has to trace to a commit in the
range; counts like "8 new Scenes" are counted from added files, never estimated.
`releaseNotes.test.ts` validates the result and fails the release PR until the
record matches the version being released, which is what keeps a version and
its notes atomic.

A headline update may carry pictures of the real app. They are shot with
`pnpm build && pnpm capture:whatsnew -g <version>` (`apps/studio/capture/`): an
isolated Scenri on an empty library, seeded only with public demo content from
`templates/`, in the dark theme at 1280 by 800. A person looks at every picture
before it is committed with its record. `releasePictures.test.ts` holds the
folder to the pictures the in-app history still shows, and to their size and
shape.

The same record feeds the GitHub release page: `packages/cli/scripts/release-body.ts`
renders it as markdown, pictures linked at the tag, and `publish.yml`, on
`release: published`, after the package goes out, puts it above
release-please's generated notes. If the record is missing the script prints
nothing and the step leaves the generated notes alone, so a release-note
problem can never fail a release. Running the step twice for one tag is
harmless: it recognises the record already on the page and leaves it.

The first boot of a new home stamps `install.firstVersion` and marks the
running version as already read, so a brand-new install is never met with a
dialog explaining changes it has no memory of.

Updates never restart on their own, see above. What's New is only ever a
description of what already happened.

## Migrations and backups

The database carries a schema version (`PRAGMA user_version`). Before an
older database is migrated, a consistent snapshot is written to
`~/.scenri/backups/` (the newest three are kept). A database written by a
*newer* Scenri is refused with instructions rather than half-read.

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
supervising launcher's protocol is older than it needs: the manual
`scenri update` path always remains.

## Desktop bootstrap v1 (frozen)

A Desktop icon (`Scenri.app` on macOS, `Scenri.lnk` on Windows) runs a copy of
`launcher/launch.mjs` from `~/.scenri/launcher`, always beside the *default*
home whatever `SCENRI_HOME` said, because a constant script can find only one
place. Copies of that file live on Desktops indefinitely, so its contract is
as frozen as the launcher's:

1. `launcher.json` beside it records `schema`, the data `home` to boot, the
   `nodePath` that installed it, the `env` to replay (`SCENRI_PORT`,
   `SCENRI_HOST`) and the artifact it made.
2. It picks the newest valid version under `<home>/app/versions/` by the same
   rule as the launcher, and hands off to `node <entry> open`, detached, with
   its output in `<home>/logs/scenri.log`. `open` must exist in every future
   version: it holds every decision (reuse a running server, start the
   supervising launcher hidden, serve the "Starting Scenri" page over loopback
   http while it waits for readiness, show the browser, explain a death in one
   native dialog) and is versioned with the app. Every step writes a line to
   `<home>/logs/launcher.log`, which is what support reads.
3. No valid version means one dialog and exit 1, never a start through npx.

Adding the icon copies the running build into `app/versions/<v>/` once, after
`node <entry> verify` proves the copy loads, so the icon works offline and
after `npm cache clean`. Every start refreshes a stale bootstrap, page or
icon, follows a recorded node that disappeared, and adopts a newer npx build.
It never recreates an icon the user deleted. `SCENRI_NO_DESKTOP=1` silences
the first-run question and the refresh.
