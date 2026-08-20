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

The server binds `127.0.0.1` by default and is reachable only from the machine it runs on.

Setting `SCENRI_HOST=0.0.0.0` opens it to your local network so you can use it from a phone. There is no account system, so that path is gated two ways:

- A `Host` header allowlist, which rejects requests arriving under any hostname other than loopback or the LAN addresses printed at startup. This is what blocks DNS rebinding, where a page in any open browser tab resolves an attacker-controlled domain to your loopback address and drives the local API.
- A random per-session access token, printed in the startup URL and required on every request. It is new on every run and never written to disk.

Treat LAN mode as convenience on a network you trust, not as a security boundary.

Browsers name cross-site requests via `Sec-Fetch-Site`, and the server rejects them (except top-level navigations, which is a user clicking a link to their own studio). That is the guard against drive-by CSRF from a page open in the same browser.

## Known limitations, stated on purpose

- The brand-from-URL and catalog importers fetch the URL you give them, follow redirects, and do not block private-IP destinations. They can only be invoked by the person at the keyboard (or with the LAN token), fetching from their own machine, which `curl` could do too. Treated as a non-goal for now; a report showing these reachable **without** local access is very much in scope.
- Updates are staged with `npm install`, so integrity rests on npm's own tarball checksums plus two checks of our own: the staged manifest must match the requested name and version, and the staged version must boot and answer `verify` before it is promoted. There is no additional signature layer.
- The library imagery archive is fetched once over HTTPS from this repository's GitHub Releases. There is no separate checksum yet; it contains imagery only and is never executed.
- One dependency override exists, in the root `package.json`: `tsup>esbuild` is held at `>=0.28.1`, because the version tsup would otherwise resolve carries an advisory affecting esbuild's development server on Windows. It is scoped to tsup deliberately. Vite resolves its own, older esbuild that predates the affected range, and the fixed release cannot compile to the browser targets the studio builds for, so applying the override globally breaks the build rather than securing anything.
