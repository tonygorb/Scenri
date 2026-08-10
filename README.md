<div align="center">

# scenri

**The open studio for brand-consistent AI visuals.**

Define a client's brand once. Then generate, branch, and art-direct on-brand images through a version tree, running entirely on your own machine and your own AI accounts.

[![CI](https://github.com/tonygorb/scenri/actions/workflows/ci.yml/badge.svg)](https://github.com/tonygorb/scenri/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/scenri)](https://www.npmjs.com/package/scenri)
[![License: AGPL v3](https://img.shields.io/badge/license-AGPL--3.0-blue)](LICENSE)

```bash
npx scenri
```

<!-- BEFORE LAUNCH: record a 10 to 15 second loop showing generate, branch an
     edit, compare the drift, keep the winner. Save to docs/media/demo.gif,
     then uncomment the img below. This is the single highest-leverage asset
     on the page, so it stays commented out rather than rendering broken. -->

<!-- <img src="docs/media/demo.gif" alt="Generating a shot, branching an edit, and comparing the drift" width="820"> -->

</div>

---

## What it is

Most AI image tools give you a prompt box and a slot machine. scenri gives you the part that actually takes the time: **art direction**.

Every shot is a node in a tree. Branch an edit from any node, put the two side by side, and a drift-diff shows you exactly where the model changed your product when it should not have.

It runs as a local server on `127.0.0.1`. Your brands, your images, and your keys stay on your disk.

## Run it

```bash
npx scenri
```

That is the whole install. It opens `http://127.0.0.1:4747`. If you already have the **Codex CLI** on your PATH, generation works on your existing session with **no API key and no per-image cost**.

Requires **Node 20 or newer**. Two dependencies (`better-sqlite3` and `sharp`) ship native binaries, so on recent npm you may be asked to approve their install scripts once.

<details>
<summary>Run from source</summary>

```bash
git clone https://github.com/tonygorb/scenri.git
cd scenri
pnpm install
pnpm build        # builds the studio UI, required before the first run
pnpm dev          # starts the server on 127.0.0.1:4747
```

</details>

## First five minutes

1. **Paste a website URL.** scenri reads the public page and drafts the kit: name, palette, logo, tone.
2. **Describe a shot.** `@` pulls in a product or a person, `#` picks a look. The composer compiles a brief you can inspect before it runs.
3. **Generate on Codex CLI.** Runs on your existing session — no key, no per-image cost.
4. **Branch an edit** from any shot, then hit compare. The heatmap shows what moved.
5. **Add a real engine** in Settings when you want output you can ship.

## Why it is built this way

- **Iteration is the product.** A version tree, not a prompt box. Branch, compare, keep the winners.
- **Your brands are files, not hostages.** `.brand` is an open, documented format under a permissive license. Email one to a client. Any tool can adopt it.
- **Your AI, your cost.** Bring your own Codex CLI session or an API key. Experiments cost raw API price, or nothing at all on a local session. No credits that burn on a miss.
- **Local first, and it means it.** No account, no telemetry, no upload. The server binds to your machine only.
- **Text you can still edit.** Headlines land as real layers on the image, not baked pixels. Restyle and re-export without regenerating.

## Engines

| Engine | Cost | Needs |
|---|---|---|
| **Codex CLI** | free on your existing session | `codex` on your PATH |
| OpenRouter | about $0.04 a generation | API key |
| Replicate | about $0.003 a generation | API token |
| fal | about $0.003 a generation | API key |

Keys are stored in your local library folder, sent only to that provider, and never returned by the API. Set a monthly spend cap per engine in Settings.

## Configuration

| Variable | Default | What it does |
|---|---|---|
| `SCENRI_HOME` | `~/.scenri` | where brands, images, and keys live |
| `SCENRI_PORT` | `4747` | port |
| `SCENRI_HOST` | `127.0.0.1` | this machine only, see the note below |
| `SCENRI_NO_OPEN` | unset | set to `1` to skip opening a browser |

`OPENROUTER_API_KEY`, `REPLICATE_API_TOKEN` and `FAL_KEY` are read from the environment as an alternative to entering them in Settings.

**Before you change `SCENRI_HOST`:** scenri has no accounts, so anyone who can reach the port can spend your API keys and delete your library. Setting `SCENRI_HOST=0.0.0.0` opens it to your local network so you can use it from a phone. That path prints a URL carrying a one-time access token, refuses every request without it, and rejects unfamiliar `Host` headers. Treat it as convenience on a network you trust, not as a security boundary.

## Layout

| Package | Purpose |
|---|---|
| `packages/cli` | the `scenri` command: local server, engine detection, browser open |
| `packages/brand-spec` | the `.brand` schema, validator, and URL auto-builder |
| `packages/core` | brands, projects, version tree, image store, cost ledger (SQLite) |
| `packages/catalog` | product catalog import: Shopify, WooCommerce, Webflow, generic |
| `packages/engines/*` | engine adapters: `codex`, `openrouter`, `replicate`, `fal`, `demo` |
| `apps/studio` | the React studio the CLI serves |

One package publishes to npm: **`scenri`**, the CLI, which bundles everything else. The rest are internal.

## Contributing

Start with [CONTRIBUTING.md](CONTRIBUTING.md). Engine adapters are the friendliest surface: one file, one interface, well covered by tests.

Looking for a first contribution? [docs/A11Y-BACKLOG.md](docs/A11Y-BACKLOG.md) lists real accessibility defects with exact file and line numbers.

Found a security problem? Please report it privately. See [SECURITY.md](SECURITY.md).

## Status

Early. The version is `0.x` and interfaces can still move. Everything documented above works today. [ROADMAP.md](ROADMAP.md) says what is next.

## License

The application is [AGPL-3.0-only](LICENSE). The `.brand` format, its schema, and its validator live in [packages/brand-spec](packages/brand-spec) under Apache-2.0, so any tool may implement or reuse them without taking on copyleft. Contributions require a [CLA](CLA.md).

---

Built in public by **Tony Gorb** · bytonygorb@gmail.com
