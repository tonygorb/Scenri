# Install Scenri

Scenri is a local app. It runs on your own computer, keeps everything on your own disk, and opens
in your browser. Getting it running takes two things: Node.js once, then one command.

This guide assumes nothing. If you already have Node.js 22 or newer, skip straight to
[Run Scenri](#run-scenri).

## What you need

- **Node.js 22 or newer.** A free runtime from the makers of the language Scenri is written in.
  You install it once and never touch it again. Not sure whether you have it? Open a terminal
  (below) and type `node --version`. If it prints `v22` or higher, you are done with this step.
- **An internet connection**, for the download and for generating images later.
- **About five minutes.**

Scenri itself never asks for an administrator password. The Node.js installer asks for one once,
the way any installer does.

## Install Node.js

Always download Node.js from the official site: **[nodejs.org](https://nodejs.org)**. Pick the
version marked **LTS**, which is the stable one.

### macOS

1. On [nodejs.org](https://nodejs.org), download the macOS installer (a `.pkg` file). It works on
   both Apple Silicon and Intel Macs.
2. Open the downloaded file and click through the installer. It asks for your Mac password once.
3. Open **Terminal**: press Command and Space together, type `terminal`, press Return.

That white or black window is where the one Scenri command goes.

### Windows

1. On [nodejs.org](https://nodejs.org), download the Windows installer (a `.msi` file).
2. Open it and click through. The defaults are right.
3. Open **PowerShell**: press the Windows key, type `powershell`, press Enter.
   **If PowerShell was already open before you installed Node, close it and open a new one.**
   A window opened before the install cannot see Node yet.

### Linux

Install Node.js 22 or newer from [nodejs.org](https://nodejs.org/en/download) or your
distribution's packages. Check the version first: distribution repositories sometimes carry an
older Node, and Scenri needs 22 or newer. Then continue below; everything else is identical.

## Run Scenri

Paste this into the terminal and press Enter:

```bash
npx scenri
```

What happens next, in order:

1. **npm asks permission once.** It names the `scenri` package and asks `Ok to proceed? (y)`.
   Type `y` and press Enter. It may also ask once to approve build scripts for two components
   named `better-sqlite3` and `sharp`; approve those too. Both questions are normal and appear
   only on the first run.
2. **It downloads.** The first run fetches Scenri and takes a minute or two. Later starts are
   fast.
3. **The terminal shows Scenri is running**, with its address and where your data lives:

   ```
   Scenri Studio → http://127.0.0.1:4747
   data dir        → /Users/you/.scenri
   Keep this window open while Scenri is running.
   ```

   On Windows the data dir reads `C:\Users\you\.scenri`: same folder, same idea.

4. **Your browser opens Scenri by itself.** If it does not, copy the address from the terminal
   into your browser.

Two things worth knowing from day one:

- **Keep the terminal window open.** That window is Scenri running. Closing it stops Scenri;
  nothing is lost, and the same command starts it again.
- **The first launch downloads the Scenri library** of example imagery in the background, about
  95 MB, once. On a slow connection the home wall fills in as it arrives.

## First launch

Scenri opens on one small step: point it at a brand.

- **Paste a website address** and Scenri reads the public pages and drafts the brand kit: name,
  palette, logo, tone. It also starts pulling the site's products into your library.
- Or choose **Start from scratch** and just name the brand.

Everything else, products, presenters, scenes, is already there to explore. The home wall is full
of finished example shots; open any of them and it loads back into the composer as the exact brief
that made it.

## Connect image generation

Running Scenri and generating images are two separate steps. Scenri is the studio; the images are
made by a generation engine you connect once. Until you do, the composer shows a short notice and
the send button waits.

**If you have a ChatGPT plan** (any paid plan): use Codex. Click **Set up** in the composer notice
and Scenri walks you through it, two steps, entirely inside the app: it installs Codex CLI, an
official helper from OpenAI, and signs you in through your browser. Scenri never sees your
password. Images then run on the ChatGPT plan you already pay for; Scenri adds nothing to the
bill.

**Otherwise, paste a key** from an image provider. In Scenri, open Settings, then Providers, pick
one and paste its key. You create the key on the provider's site:

| Provider | Get a key at | Rough cost |
|---|---|---|
| OpenRouter | [openrouter.ai/keys](https://openrouter.ai/keys) | about $0.04 an image |
| fal | [fal.ai/dashboard/keys](https://fal.ai/dashboard/keys) | about $0.003 an image |
| Replicate | [replicate.com/account/api-tokens](https://replicate.com/account/api-tokens) | about $0.003 an image |

Pick OpenRouter if your shots feature a specific product or presenter; it is the key-based engine
that carries reference images. You pay the provider directly, per image. A monthly spend cap per
engine lives in Settings.

One sentence on privacy: Scenri runs on your computer and your images and brands stay there. When
you generate, the brief and its reference images are sent to the one engine you connected, and
nowhere else. The full statement is in [PRIVACY.md](../PRIVACY.md).

## Open it again

Tomorrow, next week, whenever: open the terminal and run the same command.

```bash
npx scenri
```

Your brands, shots and settings are exactly where you left them. They live in a folder named
`.scenri` in your home folder (`%USERPROFILE%\.scenri` on Windows), as plain files you can
back up like anything else.

To stop Scenri, close the terminal window, or press Control and C in it.

## Update

Scenri checks npm every six hours for a newer version, and only for the version number. When there is
one, Scenri downloads it quietly in the background, and a small notice appears with an
**Update** button; one click and Scenri restarts into the new version. You can also update
from the terminal with `npx scenri update`.

If you first ran Scenri before version 0.4.1, run this once; it fetches the current release and
makes in-app updates work from then on:

```bash
npx scenri@latest
```

The same command is the fix whenever a start behaves oddly after an update.

## Prefer a coding assistant?

If you use a coding assistant that can run terminal commands, you can hand it the setup instead of
doing it by hand.

**Never paste API keys or passwords into an assistant chat. Scenri asks for keys only inside the
app.**

<details>
<summary>Copy this prompt into your assistant</summary>

> You are helping me install Scenri, a local app published on npm as the package `scenri`.
> Work step by step and tell me what you find before you change anything.
>
> 1. Determine my operating system.
> 2. Check whether Node.js 22 or newer, npm, and npx are already installed (`node --version`).
> 3. If Node is missing or older than 22, install the current LTS release using the official
>    installer from nodejs.org. Explain what you are about to do first, and do not use
>    administrator rights beyond what that installer itself asks for. Do not install any other
>    software, package manager, or build tool, and do not edit my shell configuration files.
> 4. When Node 22 or newer is available, run `npx scenri@latest`. Approve npm's confirmation
>    prompt for the `scenri` package only.
> 5. Confirm it started: the terminal prints a local address, `http://127.0.0.1:4747`, and a
>    browser tab should open. If the browser did not open, give me the address to click.
> 6. Stop there. Scenri's own window handles everything after this point, including connecting an
>    image provider. Do not ask me for API keys and do not configure any keys in the terminal.
> 7. Tell me in one sentence: keep the terminal window open while I use Scenri, and run the same
>    command to open it again another day.
>
> If any step fails, show me the exact error and the smallest fix, and ask before changing
> anything on my system.

</details>

This depends on what your assistant is allowed to do on your machine, so it is offered as a
convenience, not a guarantee.

## Troubleshooting

The short list, from real failures. Each one ends in a working Scenri.

**`npm: command not found` or `'npx' is not recognized`.** Node.js is not installed, or the
terminal window is older than the installation. Install Node.js from
[nodejs.org](https://nodejs.org), then open a new terminal window and try again.

**`node --version` prints v18, v20, or anything under v22.** Your Node is too old. Install the
current LTS from [nodejs.org](https://nodejs.org); it replaces the old one. Open a new terminal
window afterwards.

**`npm error EACCES: permission denied`** (or `EPERM` on Windows)**.** Your computer keeps
npm's global folder in a place only an administrator may write to, so the Codex CLI install is
refused.

- On macOS or Linux: run `sudo npm install -g @openai/codex` in the terminal and type your
  computer's password when asked (it stays invisible while you type).
- On Windows: open PowerShell as administrator (right-click Start, then "Terminal (Admin)")
  and run `npm install -g @openai/codex` there.

Then reopen the setup window in Scenri.

**`Port 4747 is in use by another app.`** Some other program on your computer answers on Scenri's
port. The message shows the fix: run the command it prints, which starts Scenri on the next port
over.

**`Scenri is already running`.** Not an error. Scenri was already open in another terminal, and
this one just brought you to it. Use the browser tab it opened.

**The browser did not open.** Copy the address the terminal printed, `http://127.0.0.1:4747`, into
any browser on the same computer.

**`Scenri could not start: a native component failed to load.`** Node changed since Scenri was
installed, usually after a Node update. Install the current LTS from
[nodejs.org](https://nodejs.org), then run `npx scenri@latest`.

**Codex is not installed, or not signed in.** Open the composer notice or Settings, then
Providers, then **Set up**, and the in-app steps handle both. If sign-in keeps failing, the dialog
shows the exact terminal command to run instead.

**Codex on Windows.** Four things specific to Windows:

- **Installed Codex while Scenri was running?** Quit Scenri (close its terminal window) and run
  `npx scenri` again. A running program cannot always see a command installed after it started.
- **Scenri says it could not verify Codex.** Something on the machine answered too slowly or not at
  all. Press **Check again** in the setup dialog; if it persists, check what `where.exe codex`
  prints in PowerShell and that `codex --version` answers there.
- **Codex needs an update.** Scenri requires Codex CLI 0.145.0 or newer. Update with
  `npm install -g @openai/codex@latest`, or if you used OpenAI's standalone installer, run it again:
  `powershell -ExecutionPolicy ByPass -c "irm https://chatgpt.com/codex/install.ps1 | iex"`.
- **Shots fail with "Codex could not start its tool host".** Codex runs the tools it needs through a
  helper process, and a non-default Windows setting stops that helper loading. Check it in
  PowerShell:

  ```powershell
  reg query "HKLM\SYSTEM\CurrentControlSet\Control\Session Manager" /v SafeDllSearchMode
  ```

  If it reports `0`, set it to `1` (the Windows default) and restart the computer.

A generation that Codex cannot finish now fails with a plain reason instead of running forever, and
Cancel stops the Codex process for real.

**A provider did not accept your API key.** Keys expire and get revoked. Create a fresh key on the
provider's site (links above), open Settings, then Providers, and paste it again.

**You closed the terminal by accident.** Nothing is lost. Open a new terminal and run `npx scenri`
again.

Anything else: [open an issue](https://github.com/tonygorb/scenri/issues) with the exact text the
terminal printed.

## Remove Scenri

Scenri installs nothing global. Without the terminal window running, it is not running.

- The downloaded copy lives in npm's cache and gets reused or replaced; there is nothing to
  uninstall.
- Your library, the folder `.scenri` in your home folder (`%USERPROFILE%\.scenri` on Windows),
  holds your brands, images and keys. It is never deleted by Scenri. Delete that folder only if you want all of that gone, and export
  anything you care about first (Settings, then Library, then Export everything).
