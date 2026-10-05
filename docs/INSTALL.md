# Install Scenri

Scenri is a local app. You install Node.js once, then start Scenri with one command. It opens in your browser and keeps your work on this computer.

## What you need

- **Node.js 22 or newer.** Check with `node --version`. Scenri does not run on Node 18 or 20.
- **A paid ChatGPT plan, or an API key**, when you want to make pictures. Scenri itself has no account and no fee. [Connect image generation](CONNECT.md) is a separate step, after the app is open.
- **A network connection** for the download, and later for generation.

Scenri does not ask for an administrator password. The Node.js installer may.

## Install Node.js

Download it from [nodejs.org](https://nodejs.org). Use the version marked LTS.

**macOS.** Download the macOS installer. It works on Apple silicon and Intel. Open Terminal with Command-Space, type `terminal`, and press Return.

**Windows.** Download the Windows installer and accept the defaults. Open PowerShell from the Start menu. If PowerShell was already open before you installed Node, close it and open a new window. A window from before the install cannot see Node yet.

If PowerShell says `running scripts is disabled on this system`, that is a Windows default. Use `npx.cmd scenri`, or Command Prompt. [Troubleshooting](TROUBLESHOOTING.md) has the detail.

**Linux.** Install Node.js 22 or newer from [nodejs.org](https://nodejs.org/en/download) or from your distribution, then check `node --version`. Distribution packages are sometimes older than 22. There is no desktop icon on Linux. You start Scenri from the terminal.

## Run Scenri

```bash
npx scenri
```

What happens:

1. npm asks `Ok to proceed? (y)` the first time. Type `y`. A few `npm warn deprecated` lines are harmless.
2. The first run downloads Scenri. Later starts are faster.
3. The terminal prints the address and where your data lives:

   ```
   Scenri Studio → http://127.0.0.1:4747
   data dir      → /Users/you/.scenri
   Keep this window open while Scenri is running.
   ```

   On Windows the data folder is `C:\Users\you\.scenri`.

4. Your browser opens that address. If it does not, paste it in yourself.

A second line may show a phone address and a six-digit code. That is [Local access](FILES.md#a-phone-on-the-same-network): a phone on the same Wi-Fi can open Scenri. It is absent when the computer is not on a network.

Keep the terminal window open. Closing it stops Scenri. Nothing you made is lost. The same command starts it again.

The first launch also downloads the example library in the background. Home fills in as it arrives.

## First launch

Scenri asks you to point it at a Brand.

- Paste a website. Scenri reads the public page and drafts a name, a logo, and colours. If the site sells things, it can look for Products next. [Brand kit](BRAND.md) says what that read does and does not do.
- Or choose **Start from scratch** and name the Brand.

Then [make a Shot](QUICKSTART.md).

## Open it again

On macOS and Windows, the first run asks once, after Scenri is already open:

```
Add Scenri to your desktop? Then you can open it without a terminal. [Y/n]
```

Say yes and a Scenri icon lands on your desktop. Double-click it later. If Scenri is not running, a "Starting Scenri" page holds the browser for a few seconds, then the studio opens. If it is already running, the browser opens on it. The icon does not need a network of its own. Generation still does.

Said no, or deleted the icon? Settings, then **Local access**, then **Add to desktop**. Or:

```bash
npx scenri desktop
```

Linux does not offer the icon. Open a terminal and run `npx scenri`.

Without the icon, the terminal command is how you start it. Your Brands and Shots are still in `.scenri`.

To stop a Scenri you started from the terminal, close the window or press Control-C. Started from the icon, there is no window: open the brand menu and choose **Shut down Scenri**.

## Update

Scenri checks npm every six hours, and only for the version number. When a newer version exists, it downloads in the background and a notice offers **Update**. One click restarts into it. From the terminal:

```bash
npx scenri update
```

If a start behaves oddly after an update, run `npx scenri@latest` once.

The desktop icon starts the newest installed copy. You do not replace the icon by hand.

Settings, then **Updates**, can turn the check off. `SCENRI_NO_UPDATE_CHECK=1` does the same.

People working on Scenri from a git checkout are on a different path. That is written up in [updates.md](updates.md), and a source checkout never offers to overwrite itself.

## Remove Scenri

Scenri installs nothing global. It is not running unless a terminal or the desktop icon started it.

- The download lives in npm's cache. There is no uninstaller.
- The icon, if you added one, is `Scenri.app` on macOS or `Scenri.lnk` on Windows, plus files in `~/.scenri/launcher`. Drag the icon to the bin, or run `npx scenri desktop --remove`.
- Your library, `.scenri` in your home folder, holds Brands, images, and keys. Scenri does not delete it. Delete that folder only when you want all of that gone. Export first: Settings, then **Library**, then **Export everything**.

## When something fails

[Troubleshooting](TROUBLESHOOTING.md) covers Node, Windows PowerShell, npm 12, a busy port, Codex, and a desktop icon that does nothing.
