<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/tonygorb/scenri/main/docs/media/logo-on-dark.svg">
  <img src="https://raw.githubusercontent.com/tonygorb/scenri/main/docs/media/logo-on-light.svg" alt="scenri" width="200">
</picture>
<br><br>

**The open studio for brand-consistent AI visuals.**<br>
Define a client's brand once. Then generate, branch, and art-direct on-brand images through a version tree, running entirely on your own machine and your own AI accounts.

[![CI](https://github.com/tonygorb/scenri/actions/workflows/ci.yml/badge.svg)](https://github.com/tonygorb/scenri/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/scenri)](https://www.npmjs.com/package/scenri)
[![License: AGPL v3](https://img.shields.io/badge/license-AGPL--3.0-blue)](LICENSE)

**Get started:** one command, no account.

```bash
npx scenri
```

<img src="https://raw.githubusercontent.com/tonygorb/scenri/main/docs/media/demo.gif" alt="The scenri composer: a dollar sign opens a product picker and Selvedge Trucker is chosen, an at sign picks the presenter Maren, a slash picks the Editorial Walk scene, a line of written direction is typed after the three chips, the shot renders as a card in the wall, and it opens to show the picture beside the brief that made it" width="820">

<sub>Pick a product, pick a presenter, pick a scene, then write the direction. That is the brief.</sub>

</div>

---

## What it is

Most AI image tools give you a prompt box and a slot machine. scenri gives you the part that actually takes the time: **art direction**.

Every shot keeps its lineage. Branch an edit from any shot, put the two side by side, and the drift heatmap shows you exactly where the model changed your product when it should not have.

It runs as a local server on `127.0.0.1`. Your brands, your images, and your keys stay on your disk.

## What a brief produces

The film above ends on the shot its brief made: the Selvedge Trucker product, the presenter Maren, the Editorial Walk scene, and a paragraph of written direction. The chips carry the identity; the prose does the art direction. Here are eight more shots from the home wall, each built exactly that way:

<!-- One paragraph, no whitespace between the tags: a newline here renders as
a fixed word-space, and 4 x 24.5% plus three spaces overflows a phone screen
and wraps 3+1. With zero gaps the rows stay four wide at every width. --><p align="center"><img src="https://raw.githubusercontent.com/tonygorb/scenri/main/docs/media/readme-serum-dew.jpg" title="Serum on the dew bed" alt="An amber Aurelia serum bottle nested in dew-covered succulent leaves, a droplet falling toward it" width="24.5%"><img src="https://raw.githubusercontent.com/tonygorb/scenri/main/docs/media/readme-drivers-window.jpg" title="Leaning into the driver's window" alt="A man in a selvedge denim jacket leaning into the open driver's window of a car on a coastal road" width="24.5%"><img src="https://raw.githubusercontent.com/tonygorb/scenri/main/docs/media/readme-under-surface.jpg" title="Under the surface, looking up" alt="A glass soda bottle standing on rippled sand underwater, shot from below looking up through the surface" width="24.5%"><img src="https://raw.githubusercontent.com/tonygorb/scenri/main/docs/media/readme-sling-chair.jpg" title="Sling chair in the travertine atrium" alt="A leather sling chair alone in a travertine atrium, raking sunlight across the stone" width="24.5%"><img src="https://raw.githubusercontent.com/tonygorb/scenri/main/docs/media/readme-yuzu-spin.jpg" title="Yuzu can, mid-spin" alt="A woman mid-stride against a magenta backdrop, spinning a yellow can that throws off a fine spray" width="24.5%"><img src="https://raw.githubusercontent.com/tonygorb/scenri/main/docs/media/readme-spa-ledge.jpg" title="Morning at the spa ledge" alt="A frosted Solenne cream jar with a brushed gold lid on a poolside travertine ledge, steam rising behind" width="24.5%"><img src="https://raw.githubusercontent.com/tonygorb/scenri/main/docs/media/readme-pearls-silk.jpg" title="Pearls through ivory silk" alt="A single pearl on a fine gold chain, drawn across folds of deep green silk" width="24.5%"><img src="https://raw.githubusercontent.com/tonygorb/scenri/main/docs/media/readme-two-drops.jpg" title="Two drops, morning routine" alt="A man holding an open Aurelia serum bottle toward the camera, a drop falling from the raised pipette" width="24.5%"></p>

All 97 examples on the home wall work the same way. Open one and it loads back into the composer as the brief that made it, ready to change.

## What you get out of the box

<img src="https://raw.githubusercontent.com/tonygorb/scenri/main/docs/media/library.gif" alt="A slow scroll down the scenri home wall: rows of finished example shots across product categories, with the composer docked at the bottom of the screen" width="820">

A library of scenes, presenters and demo products, so the app is useful before you have uploaded anything of your own. Filter by category, bookmark what fits the brand, or build your own from a few reference photos.

The brand kit sits one gesture away in Settings and is the part that keeps output consistent. Name, mark, palette and rules, set once and carried into every shot that asks for them.

## Run it

```bash
npx scenri
```

That is the whole install. It opens `http://127.0.0.1:4747`.

Generation runs on **Codex CLI**, an official helper from OpenAI that draws on your own ChatGPT plan. No API key to paste, and scenri never charges you. Each image draws on your plan's Codex usage. You do not have to set it up by hand: if it is missing, scenri offers to install it and to sign you in, both from the app. No ChatGPT plan? Add your own key from an image provider in Settings instead, see [Engines](#engines).

Requires **Node 22 or newer**. Two dependencies (`better-sqlite3` and `sharp`) ship native binaries, so on recent npm you may be asked to approve their install scripts once.

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
2. **Describe a shot.** In the composer, `$` reaches for a product, `@` for a presenter, `/` for a scene, and `#` for a colour. Everything between them is your own words. The composer compiles a brief you can inspect before it runs.
3. **Generate on Codex CLI.** Runs on your own ChatGPT plan, so there is no key and no per-image charge from us.
4. **Branch an edit** from any shot, then hit compare. The heatmap shows what moved.
5. **Add your own key** in Settings to run on OpenRouter, Replicate or fal instead.

## Why it is built this way

- **Iteration is the product.** A version tree, not a prompt box. Branch, compare, keep the winners.
- **Your brands are files, not hostages.** `.brand` is an open, documented format under a permissive license. Email one to a client. Any tool can adopt it.
- **Your AI, your cost.** Bring your own Codex CLI session or an API key. Experiments cost raw API price, or nothing at all on a local session. No credits that burn on a miss.
- **Local first, and it means it.** No account, no telemetry, no upload. The server binds to your machine only. scenri makes exactly two requests on its own behalf: a daily version-number check against npm so updates can announce themselves, and a one-time download of the library imagery archive, cached locally forever after. Nothing about you or your work is ever sent, and both turn off: in Settings or `SCENRI_NO_UPDATE_CHECK=1` for the first, `SCENRI_NO_CONTENT_FETCH=1` for the second ([how updates work](docs/updates.md)).

## Engines

| Engine | What it costs you | Needs | Carries a Product or Presenter |
|---|---|---|---|
| **Codex CLI** | your ChatGPT plan | a ChatGPT account; the app installs and signs in for you | yes, up to 6 references |
| OpenRouter | about $0.04 a generation | API key | yes, up to 4 references |
| Replicate | about $0.003 a generation | API token | no |
| fal | about $0.003 a generation | API key | no |

Codex CLI is the default because it needs no key and because it carries the most reference images: a shot that has to keep both a product and a person accurate needs the room.

It is not free. Every ChatGPT plan comes with some Codex usage and each image spends a little of it. OpenAI meters that, not scenri, so spend caps do not apply to this engine.

**Without a ChatGPT plan**, use your own provider key. OpenRouter is the one to pick if your shots name a Product or a Presenter. Replicate and fal take no reference images, so scenri refuses those briefs on them rather than generating something that only looks right.

Keys are stored in your local library folder, sent only to that provider, and never returned by the API. Set a monthly spend cap per engine in Settings.

Your Codex session is yours: scenri runs the official `codex` commands on your machine and never reads, copies or stores the credential. That is also why scenri never pools user plans: a plan is licensed to the person who pays for it, not to a service reselling it to other people. Any hosted version of scenri, if one ever exists, would run API-priced engines only.

## Configuration

| Variable | Default | What it does |
|---|---|---|
| `SCENRI_HOME` | `~/.scenri` | where brands, images, and keys live |
| `SCENRI_PORT` | `4747` | port |
| `SCENRI_HOST` | `127.0.0.1` | this machine only, see the note below |
| `SCENRI_NO_OPEN` | unset | set to `1` to skip opening a browser |
| `SCENRI_NO_UPDATE_CHECK` | unset | set to `1` to never ask npm for the latest version |
| `SCENRI_REGISTRY` | npmjs | registry for the update check and downloads (mirrors, forks, airgaps) |
| `SCENRI_NO_CONTENT_FETCH` | unset | set to `1` to never download the library imagery archive |
| `SCENRI_CONTENT_URL` | GitHub releases | where the library archive comes from (mirrors, forks, airgaps) |

`OPENROUTER_API_KEY`, `REPLICATE_API_TOKEN` and `FAL_KEY` are read from the environment as an alternative to entering them in Settings.

**Before you change `SCENRI_HOST`:** scenri has no accounts, so anyone who can reach the port can spend your API keys and delete your library. Setting `SCENRI_HOST=0.0.0.0` opens it to your local network so you can use it from a phone. That path prints a URL carrying a one-time access token, refuses every request without it, and rejects unfamiliar `Host` headers. Treat it as convenience on a network you trust, not as a security boundary.

## Layout

| Package | Purpose |
|---|---|
| `packages/cli` | the `scenri` command: local server, engine detection, browser open |
| `packages/brand-spec` | the `.brand` schema, validator, and URL auto-builder |
| `packages/core` | brands, shot history, the version tree, image store, cost ledger (SQLite) |
| `packages/catalog` | product catalog import: Shopify, WooCommerce, Webflow, generic |
| `packages/engines/*` | engine adapters: `codex`, `openrouter`, `replicate`, `fal`, `demo` |
| `apps/studio` | the React studio the CLI serves |

One package publishes to npm: **`scenri`**, the CLI, which bundles everything else. The rest are internal.

## Contributing

Start with [CONTRIBUTING.md](CONTRIBUTING.md). Engine adapters are the friendliest surface: one file, one interface, well covered by tests.

Accessibility is tracked in [docs/A11Y-BACKLOG.md](docs/A11Y-BACKLOG.md). Every Biome a11y rule runs at `error`, so the backlog is currently empty and a new defect fails CI rather than joining a list.

Found a security problem? Please report it privately. See [SECURITY.md](SECURITY.md).

## Status

Early. The version is `0.x` and interfaces can still move. Everything documented above works today. [ROADMAP.md](ROADMAP.md) says what is next.

## License

The application is [AGPL-3.0-only](LICENSE). The `.brand` format, its schema, and its validator live in [packages/brand-spec](https://github.com/tonygorb/scenri/tree/main/packages/brand-spec) under Apache-2.0, so any tool may implement or reuse them without taking on copyleft; the npm package carries that license text as `LICENSE-APACHE-2.0-brand-spec`. Contributions require a [CLA](CLA.md).

The bundled imagery and curated content are licensed separately under [ASSETS-LICENSE.md](docs/ASSETS-LICENSE.md): free to use within scenri, commercial work included; no redistribution or rebundling. The npm package's `license` field describes the code; the starter imagery inside it stays under those asset terms.

The name and the mark are not part of the code license: [TRADEMARKS.md](TRADEMARKS.md) says what a fork may and may not call itself. What the app does and does not send anywhere is written down in [PRIVACY.md](PRIVACY.md).

---

Built in public by **Tony Gorb** · [tonygorb.com](https://tonygorb.com) · [hello@scenri.co](mailto:hello@scenri.co)
