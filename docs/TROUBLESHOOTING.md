# Troubleshooting

Failures that have actually happened. Each one ends in a working Scenri, or in a Shot that can be sent.

## Node and the first command

**`npm: command not found` or `'npx' is not recognized`.** Node.js is not installed, or the terminal is older than the installation. Install Node.js from [nodejs.org](https://nodejs.org), then open a new terminal.

**`node --version` prints v18, v20, or anything under v22.** Install the current LTS from [nodejs.org](https://nodejs.org). It replaces the old one. Open a new terminal afterwards.

**`npx.ps1 cannot be loaded because running scripts is disabled on this system.`** Windows ships PowerShell with scripts off, and npm installs its commands as scripts. Nothing is wrong with the computer. You do not need an administrator. Either:

- run `npx.cmd scenri`, or
- use Command Prompt: Windows key, type `cmd`, then `npx scenri`.

To allow scripts for your account only: `Set-ExecutionPolicy RemoteSigned -Scope CurrentUser`. Leave the machine-wide setting alone.

**`npm error EACCES: permission denied`** (or `EPERM` on Windows). npm could not write its global folder, so the Codex CLI install was refused.

- On macOS or Linux: `sudo npm install -g @openai/codex`, then your password. This is npm's folder, not Scenri's.
- On Windows this is usually not permissions. Close Codex and any terminal using it, then try again. If it keeps failing, use OpenAI's installer, which does not go through npm:

  ```powershell
  powershell -ExecutionPolicy ByPass -c "irm https://chatgpt.com/codex/install.ps1 | iex"
  ```

Then reopen setup in Scenri.

**`Scenri could not start: a native component failed to load.`** Two causes.

If `npm --version` prints 12, npm skipped the install script for `better-sqlite3`. Allow it once, clear the cached copy, and start again:

```bash
npm config set allow-scripts=better-sqlite3 --location=user
npm cache npx rm --force
npx scenri
```

The npm that ships with current Node (npm 11) does not need this. The same setting lets in-app updates install under npm 12.

Otherwise Node changed after Scenri was installed, usually a Node upgrade. Install the current LTS, then run `npx scenri@latest`.

## The server

**`Port 4747 is in use by another app.`** The message prints the command that starts Scenri on the next port.

**`Scenri is already running`.** Not an error. Another terminal already started it, and this one opened the browser.

**The browser did not open.** Paste `http://127.0.0.1:4747`, or the address the terminal printed.

**You closed the terminal.** Nothing is lost. Run `npx scenri` again.

## A phone cannot open Scenri

Open Settings, **Local access**. If the firewall would stop a phone, it says so and offers **Allow Scenri**. Answer the computer's own prompt.

Usual causes, most likely first:

- The phone is on another network, or on a guest network.
- macOS or Windows asked whether Node may accept connections, and that was denied. Allow Scenri fixes it.
- The phone's browser asked to find devices on the local network. Allow it.

## Codex

**Codex is not installed, or not signed in.** Settings, **Providers**, **Set up**. If sign-in keeps failing, the dialog shows the terminal command.

**"Codex CLI needs an update", or the CLI is too old for its model.** Scenri needs 0.157.1 or newer. It turns away a CLI older than 0.145.0 immediately. A version between those two can look ready until the connection check, or until the first Shot if you never opened setup. Update with `npm install -g @openai/codex@latest`, or run OpenAI's installer again, then press **Check again**.

**Windows, four cases.**

- You installed Codex while Scenri was running. Quit Scenri and run `npx scenri` again. A running program cannot always see a command installed after it started.
- Scenri could not verify Codex. Press **Check again**. If it persists, see what `where.exe codex` prints, and that `codex --version` answers.
- Codex needs the update above. The standalone installer on Windows is the PowerShell line in the npm section.
- Shots fail with "Codex could not start its tool host". A non-default Windows setting stops the helper. In PowerShell:

  ```powershell
  reg query "HKLM\SYSTEM\CurrentControlSet\Control\Session Manager" /v SafeDllSearchMode
  ```

  If it reports `0`, set it to `1` (the Windows default) and restart the computer.

A generation Codex cannot finish fails with a reason instead of running forever. Cancel stops the Codex process.

**A provider did not accept your API key.** Keys expire. Create a fresh one, open Settings, **Providers**, and paste it again. [Connect image generation](CONNECT.md) has the links.

## The desktop icon

The icon exists on macOS and Windows only.

**The icon could not be added.** Scenri says so and keeps running. Try again from Settings, **Local access**, **Add to desktop**, or `npx scenri desktop`. Scenri only writes your own Desktop folder. A failure here is usually a Desktop that moved, including OneDrive taking it over, or security software holding the file.

**macOS asks whether Terminal may access your Desktop.** Allow it. If you refused: System Settings, Privacy & Security, Files and Folders, Desktop Folder, on for your terminal, then add the icon again.

**The icon does nothing, or says Scenri's app files are missing.** It starts the copy in `~/.scenri/app`. If that folder was removed, run `npx scenri` once. The same start rebuilds the copy after a Node major upgrade. Every double-click writes `~/.scenri/logs/launcher.log` (`%USERPROFILE%\.scenri\logs\launcher.log` on Windows). A server started from the icon writes `scenri.log` beside it. Those two files are what to send with a report.

**The icon says Node.js was not found.** It remembers the Node that installed it. If that Node was removed, install Node again or run `npx scenri` once from a terminal where `node` works.

Anything else: [open an issue](https://github.com/tonygorb/scenri/issues) with the exact text the terminal printed.
