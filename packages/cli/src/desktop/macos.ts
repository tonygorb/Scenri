/**
 * The macOS launcher: a plain app bundle on the Desktop whose main executable
 * is a constant shell script. Finder runs it through LaunchServices with no
 * Terminal, the bundle carries the real icon, and because every byte is
 * written locally there is no quarantine attribute for Gatekeeper to act on.
 * Unsigned and unnotarised, and the docs say so.
 *
 * The script is a constant on purpose: paths, versions and the node to use
 * come from files under ~/.scenri/launcher (`node-path`, `launcher.json`),
 * never from text interpolated into shell syntax.
 */
import { chmodSync, copyFileSync, existsSync, mkdirSync, renameSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const MAC_BUNDLE_ID = 'co.scenri.desktop-launcher';
export const MAC_MARKER = 'scenri-launcher.json';

/**
 * Finder hands the script $HOME and a four-entry PATH, nothing from the login
 * shell. The recorded node comes first; then PATH; then where nvm, fnm, Volta,
 * Homebrew and the installer put node. The dialog is the last resort, and the
 * message is an argument to osascript, never part of its script.
 */
export const MAC_SCRIPT = `#!/bin/sh
# Scenri desktop launcher. Written by Scenri; deleting it removes only this icon.
L="$HOME/.scenri/launcher"
if [ ! -f "$L/launch.mjs" ]; then
  /usr/bin/osascript -e 'on run argv' \\
    -e 'display dialog (item 1 of argv) with title "Scenri" buttons {"OK"} default button 1 with icon stop' \\
    -e 'end run' -- "Scenri's launcher files are missing. Open Terminal and run: npx scenri desktop"
  exit 1
fi
NODE=""
MAJOR=""
if [ -r "$L/node-major" ]; then IFS= read -r MAJOR < "$L/node-major" || MAJOR=""; fi
# Native modules were built for the node that installed the icon. When that
# node is gone, a node of the same major runs them and another major refuses,
# so: every candidate once demanding that major, then once taking any.
candidates() {
  if [ -r "$L/node-path" ]; then IFS= read -r c < "$L/node-path" && echo "$c"; fi
  command -v node 2>/dev/null || true
  echo /opt/homebrew/bin/node
  echo /usr/local/bin/node
  echo "$HOME/.volta/bin/node"
  echo "$HOME/.local/share/fnm/aliases/default/bin/node"
  echo "$HOME/Library/Application Support/fnm/aliases/default/bin/node"
  for c in "$HOME"/.nvm/versions/node/*/bin/node; do echo "$c"; done
}
pick() {
  want="$1"
  candidates | while IFS= read -r c; do
    [ -n "$c" ] && [ -x "$c" ] || continue
    if [ -n "$want" ]; then
      v="$("$c" -p 'process.versions.node.split(".")[0]' 2>/dev/null)" || continue
      [ "$v" = "$want" ] || continue
    fi
    echo "$c"
  done | tail -n 1
}
if [ -n "$MAJOR" ]; then NODE="$(pick "$MAJOR")"; fi
if [ -z "$NODE" ]; then NODE="$(pick "")"; fi
if [ -z "$NODE" ] || [ ! -x "$NODE" ]; then
  /usr/bin/osascript -e 'on run argv' \\
    -e 'display dialog (item 1 of argv) with title "Scenri" buttons {"OK"} default button 1 with icon stop' \\
    -e 'end run' -- "Scenri needs Node.js, and none was found on this Mac. Install it from nodejs.org, then open Terminal and run: npx scenri"
  exit 1
fi
exec "$NODE" "$L/launch.mjs"
`;

export function macPlist(opts: { version: string; schema: number }): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key>
  <string>en</string>
  <key>CFBundleDisplayName</key>
  <string>Scenri</string>
  <key>CFBundleExecutable</key>
  <string>Scenri</string>
  <key>CFBundleIconFile</key>
  <string>Scenri.icns</string>
  <key>CFBundleIdentifier</key>
  <string>${MAC_BUNDLE_ID}</string>
  <key>CFBundleInfoDictionaryVersion</key>
  <string>6.0</string>
  <key>CFBundleName</key>
  <string>Scenri</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>${opts.version}</string>
  <key>CFBundleVersion</key>
  <string>${opts.schema}</string>
  <key>LSMinimumSystemVersion</key>
  <string>12.0</string>
  <key>LSUIElement</key>
  <true/>
  <key>NSHighResolutionCapable</key>
  <true/>
</dict>
</plist>
`;
}

/** Ours: a bundle that carries the marker we wrote. Anything else is the user's. */
export const isOurMacBundle = (bundle: string): boolean =>
  existsSync(join(bundle, 'Contents', 'Resources', MAC_MARKER));

/**
 * Build beside the target, then swap: a half-written bundle never sits on the
 * Desktop. The final touch nudges Finder to reread the icon.
 */
export function writeMacBundle(opts: { path: string; icns: string; version: string; schema: number }): void {
  const tmp = `${opts.path}.tmp-${process.pid}`;
  rmSync(tmp, { recursive: true, force: true });
  const contents = join(tmp, 'Contents');
  mkdirSync(join(contents, 'MacOS'), { recursive: true });
  mkdirSync(join(contents, 'Resources'), { recursive: true });
  writeFileSync(join(contents, 'Info.plist'), macPlist(opts));
  writeFileSync(join(contents, 'PkgInfo'), 'APPL????');
  const script = join(contents, 'MacOS', 'Scenri');
  writeFileSync(script, MAC_SCRIPT);
  chmodSync(script, 0o755);
  copyFileSync(opts.icns, join(contents, 'Resources', 'Scenri.icns'));
  writeFileSync(
    join(contents, 'Resources', MAC_MARKER),
    `${JSON.stringify({ scenri: 'desktop-launcher', schema: opts.schema, version: opts.version }, null, 2)}\n`,
  );
  rmSync(opts.path, { recursive: true, force: true });
  mkdirSync(dirname(opts.path), { recursive: true });
  renameSync(tmp, opts.path);
  const now = new Date();
  utimesSync(opts.path, now, now);
}
