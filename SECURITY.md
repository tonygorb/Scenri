# Security policy

## Reporting a vulnerability

Please report privately, not in a public issue.

- Preferred: GitHub private vulnerability reporting, via the **Security** tab on this repository.
- Fallback: security@scenri.co.

Include what you did, what happened, and what you expected. A proof of concept helps a lot. You will get a first response within 5 working days, and an assessment within 14 days. This is a solo-maintained project, so please allow for that in your disclosure timeline.

Do not test against anyone else's machine or account. Everything here runs locally, so a local reproduction is always possible.

## Supported versions

The latest published `0.x` release is supported. There are no backports to earlier `0.x` versions while the project is pre-1.0.

## Threat model

This is a **local-first** application. It runs on your machine, stores data on your disk, and talks to AI providers using credentials you supply. There is no hosted service, no account system, and no telemetry.

**In scope:**

- The local HTTP server binding wider than intended, or accepting requests from an origin it should refuse
- API credentials leaking out of their store: into responses, logs, the browser bundle, exported files, or a `.brand` file
- Path traversal or arbitrary file read and write through the API, image store, or export routes
- Command injection through the `codex-cli` engine adapter, which spawns a local process
- Server-side request forgery through the brand-from-URL importer or the catalog importer, both of which fetch attacker-influenceable URLs
- A malicious `.brand` file causing code execution or file access when validated or opened

**Out of scope:**

- Anything requiring an attacker to already have local shell access as your user. At that point they can read `~/.scenri` directly.
- Cost incurred by your own generations, or a provider bill from your own usage
- Output of the AI models themselves, including the content of generated images
- Vulnerabilities in AI providers (OpenRouter, Replicate, fal) or in the Codex CLI
- Denial of service against your own local server

## How credentials are handled

Worth stating plainly, because it is the question people ask first.

- API keys are stored in the SQLite database under `$SCENRI_HOME` (default `~/.scenri`), **outside the repository**.
- Keys are write-only over the API. `GET /api/settings` returns a boolean per key indicating whether one is set, never the value. This is enforced by `SECRET_KEYS` in `packages/cli/src/server.ts` and asserted by a test in `packages/cli/test/server.test.ts`.
- No key is ever sent to the browser. There is no build-time env inlining anywhere in the studio bundle.
- `.brand` files never contain credentials, by design. See `packages/brand-spec/SPEC.md`: a `.brand` must always be safe to email to a client.

If you find a path that violates any of the four statements above, that is a vulnerability. Please report it.

## Network exposure

The studio's own listener binds `127.0.0.1`. Beside it, on the same port, Scenri listens on this machine's private Wi-Fi and Ethernet addresses, so a phone on the same network can open it (Settings, Local access). It never listens on a VPN, container, virtual or IPv6 address, and it follows the machine to a new network by checking its addresses again every half minute. There is no account system, so every request passes three gates:

- A `Host` header check, which accepts loopback names and IPv4 addresses and rejects every other hostname. This is what blocks DNS rebinding, where a page in any open browser tab resolves an attacker-controlled domain to your loopback address and drives the local API. An IPv4 address cannot be rebound: a page whose origin is an address is already that address.
- Browsers name cross-site requests via `Sec-Fetch-Site`, and the server rejects them (except top-level navigations, which is a user clicking a link to their own studio). That is the guard against drive-by CSRF from a page open in the same browser.
- A six-digit access code on every request from any device other than this computer (this computer being a loopback connection that names a loopback host). It is minted once, kept in the library's settings table, and carried inside the QR code and the link; a device that brings it gets a functional cookie for 400 days, so a phone stays signed in across restarts. Ten different wrong codes from one address within ten minutes lock that address out until the ten minutes pass, and a hundred from every address together make every device other than this computer wait, so many addresses cannot add up to fast guessing: at most a hundred guesses in ten minutes, which puts a million codes months away. Someone who keeps guessing can make phones wait; this computer is never affected. **New code** in Settings > Local access (this computer only) replaces the code and signs every device out, for a code shown on a shared screen or a lost phone. Reveal, Add to desktop, New code and Allow Scenri act on the computer running Scenri, so the server refuses them from any other device. Digits, like a code by text message, so a phone offers its number pad. Someone who can read your Wi-Fi traffic does not need to guess, which is the limit below.

When the QR code opens, Scenri reads this computer's firewall (read-only: `socketfilterfw` on macOS, the network profile and node.exe's rules on Windows). If the firewall would stop a phone, Settings offers **Allow Scenri**, which only this computer can press and which runs through the operating system's own prompt, a password on macOS or UAC on Windows. On macOS it adds node to the firewall's allowed apps (`socketfilterfw --add`, then `--unblockapp`). On Windows it removes the inbound Block rules on this node.exe (pressing Cancel on Windows' own prompt writes them, and a Block rule beats every Allow rule), then adds one rule, `Scenri-<port>`: inbound TCP on Scenri's port, from the local subnet only, on every network profile. Delete that rule in Windows Defender Firewall to undo it.

`SCENRI_HOST=127.0.0.1` turns the phone listeners off. `SCENRI_HOST=0.0.0.0` binds the studio's own listener to every interface instead, behind the same gates.

Over plain http the code and the cookie travel unencrypted, like everything else. On a network where others can read your traffic (an open Wi-Fi), treat phone access as convenience, not as a security boundary.

## Known limitations, stated on purpose

- The brand-from-URL and catalog importers fetch the URL you give them and follow redirects. They refuse private-network destinations unless `SCENRI_SCRAPE_ALLOW_PRIVATE=1`, and they can only be invoked by the person at the keyboard or a device holding the access code. A report showing these reachable **without** local access is very much in scope.
- Updates are staged with `npm install`, so integrity rests on npm's own tarball checksums plus two checks of our own: the staged manifest must match the requested name and version, and the staged version must boot and answer `verify` before it is promoted. There is no additional signature layer.
- The library imagery archive is fetched once over HTTPS from this repository's GitHub Releases. There is no separate checksum yet; it contains imagery only and is never executed.
- One dependency override exists, in the root `package.json`: `tsup>esbuild` is held at `>=0.28.1`, because the version tsup would otherwise resolve carries an advisory affecting esbuild's development server on Windows. It is scoped to tsup deliberately. Vite resolves its own, older esbuild that predates the affected range, and the fixed release cannot compile to the browser targets the studio builds for, so applying the override globally breaks the build rather than securing anything.
