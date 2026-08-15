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

- **In the app**: the Home banner's Update button (or Settings → About)
  downloads the new version next to the running one, verifies it actually
  loads, and restarts into it. The browser reconnects by itself.
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
