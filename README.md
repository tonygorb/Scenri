<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/tonygorb/scenri/main/docs/media/logo-on-dark.svg">
  <img src="https://raw.githubusercontent.com/tonygorb/scenri/main/docs/media/logo-on-light.svg" alt="Scenri" width="200">
</picture>
<br><br>

**The open-source AI photo studio that remembers your products, people and places.**<br>
Save a brand's products from real photos, the people in its shots and its places once. Then each shot is one line, and every shot keeps its recipe, so you can refine it or make the next one match. It runs on your own computer and sends your pictures to the image model you already use.

[![CI](https://github.com/tonygorb/scenri/actions/workflows/ci.yml/badge.svg)](https://github.com/tonygorb/scenri/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/scenri)](https://www.npmjs.com/package/scenri)
[![License: AGPL v3](https://img.shields.io/badge/license-AGPL--3.0-blue)](https://github.com/tonygorb/scenri/blob/main/LICENSE)

**Get started.** You need [Node.js](https://nodejs.org) 22 or newer, and a paid ChatGPT plan (used through Codex CLI, which Scenri sets up for you) or an [OpenRouter](https://openrouter.ai) API key to make pictures. Scenri itself has no account and no fees.

<sub>If `npm --version` prints 12, run `npm config set allow-scripts=better-sqlite3 --location=user` once first ([why](https://github.com/tonygorb/scenri/blob/main/docs/TROUBLESHOOTING.md)). Then:</sub>

```bash
npx scenri
```

<sub>The first start downloads the Scenri library of example imagery, about 155 MB. New to any of this? The [install guide](https://github.com/tonygorb/scenri/blob/main/docs/INSTALL.md) walks through every step.</sub>

<img src="https://raw.githubusercontent.com/tonygorb/scenri/main/docs/media/demo.gif" alt="Scenri's Create page: in the composer a dollar sign picks the product Cropped Puffer, an at sign picks the presenter Kwame, a slash picks the Container Blue scene, and a line of written direction follows the three chips. Generate turns a new card into a dithered swirl where the picture is being made, the swirl develops into a man in an orange puffer jacket leaning on a cobalt shipping container, and the shot opens beside the prompt that made it" width="820">

<sub>Pick a product, pick a presenter, pick a scene, then write the direction. That is the prompt.</sub>

</div>

---

## What it is

Most AI image tools give you a prompt box and a slot machine. Scenri gives you the part that actually takes the time: **art direction**.

You save a brand's ingredients once: its products from real photos, the people who appear in its shots (Scenri calls them Presenters), its places (Scenes) and its brand kit. Then a shot is one line. In the composer, `$` picks a product (what), `@` a person (who) and `/` a scene (where), and you write the direction in the same line. Open the shot, say what to change, and **Refine** keeps every step on a trail under the picture, so the original and every step stay one click apart.

Every shot also keeps its recipe: the prompt, the chips and the settings that made it. Refine any step again, or use **Reuse setup** to start a new shot from the same prompt and chips, so the next one matches.

Scenri trains nothing. It sends your saved photos with each shot as reference images, and the image model draws the product and the person from them, so a shot comes close to the real thing rather than pasting it in, and small lettering can drift. When you refine one part of a finished shot, or change its shape, Scenri keeps the original picture's own pixels wherever it can.

It runs as a local server on your own computer. Your brands, your images, and your keys stay on your disk. To use it from a phone or tablet on the same Wi-Fi, open Settings, Local access, and scan the QR code.

The words Scenri uses are defined once in [Concepts](https://github.com/tonygorb/scenri/blob/main/docs/CONCEPTS.md), and the questions people ask first, from LoRAs to cost, are answered in the [FAQ](https://github.com/tonygorb/scenri/blob/main/docs/FAQ.md).

## What a prompt produces

The film above ends on one of the examples from the Home wall: the Cropped Puffer product, the presenter Kwame, the Container Blue scene, and a short paragraph of written direction, of which the film types the first line. The chips carry the identity; the words do the art direction. Here are eight more shots from the Home wall, each built the same way from chips and written direction:

<!-- One paragraph, no whitespace between the tags: a newline here renders as
a fixed word-space, and 4 x 24.5% plus three spaces overflows a phone screen
and wraps 3+1. With zero gaps the rows stay four wide at every width. --><p align="center"><img src="https://raw.githubusercontent.com/tonygorb/scenri/main/docs/media/readme-paper-garden.jpg" title="Collagen in a paper garden" alt="A lilac Tanner Fielding collagen pouch standing among giant cut-paper flowers in coral, yellow and violet" width="24.5%"><img src="https://raw.githubusercontent.com/tonygorb/scenri/main/docs/media/readme-foil-jump.jpg" title="Mid-air in the foil tent" alt="A woman in an orange puffer jacket jumping inside a tent of crinkled silver foil" width="24.5%"><img src="https://raw.githubusercontent.com/tonygorb/scenri/main/docs/media/readme-ruby-pour.jpg" title="Aperitivo under a ruby pour" alt="A Fenner Ross aperitivo bottle on a pale pink ledge while a thick ruby syrup pours into a glass of ice beside it and drips over the edge" width="24.5%"><img src="https://raw.githubusercontent.com/tonygorb/scenri/main/docs/media/readme-pink-smoke.jpg" title="Gold hoops in pink smoke" alt="A woman in profile with a low bun and a chunky gold hoop earring, wrapped in clouds of pink smoke" width="24.5%"><img src="https://raw.githubusercontent.com/tonygorb/scenri/main/docs/media/readme-travertine-chair.jpg" title="Oak lounge chair in travertine light" alt="An oak lounge chair with cream boucle cushions beside a travertine block, window light striping the wall" width="24.5%"><img src="https://raw.githubusercontent.com/tonygorb/scenri/main/docs/media/readme-balloon-knot.jpg" title="Headphones in the balloon knot" alt="A man with his eyes closed in pale blue over-ear headphones, sunk in a tangle of pink, orange and blue balloons" width="24.5%"><img src="https://raw.githubusercontent.com/tonygorb/scenri/main/docs/media/readme-boulder-runner.jpg" title="Trail shoe on lichened granite" alt="A white and orange trail running shoe resting on lichen-covered granite high above a mountain valley" width="24.5%"><img src="https://raw.githubusercontent.com/tonygorb/scenri/main/docs/media/readme-arch-lean.jpg" title="Leaning into the green arch" alt="A woman in cobalt trousers leaning inside a lime green arch on a sky blue set, holding a violet can" width="24.5%"></p>

All 110 examples on the Home wall work the same way. Open one and it loads back into the composer as the prompt that made it, ready to change.

## What you get out of the box

<img src="https://raw.githubusercontent.com/tonygorb/scenri/main/docs/media/library.gif" alt="Scenri's Home for a new brand: the four ways to start and the example tabs over the wall of finished shots, a slow scroll down the wall, then the Presenters library and the Scenes library, each opening with its offer to make your own above the catalog" width="820">

A library of 42 scenes, 19 presenters and 30 demo products, so the app is useful before you have uploaded anything of your own. Filter by category and star what fits the brand. Add your own products from their photos, and make your own presenters and scenes in a short conversation: describe a person or a place, or start from photos, and approve what Scenri draws before it is saved.

The brand kit lives in Settings and is the part that keeps output consistent. Name, mark, palette and rules, set once and carried into every shot that asks for them.

## Run it

Node.js 22 or newer, then:

```bash
npx scenri
```

The [install guide](https://github.com/tonygorb/scenri/blob/main/docs/INSTALL.md) covers macOS, Windows, and Linux, including the desktop icon and the PowerShell case. The [quick start](https://github.com/tonygorb/scenri/blob/main/docs/QUICKSTART.md) is the shortest path to one Shot. Generation is a separate step: [connect Codex or a provider key](https://github.com/tonygorb/scenri/blob/main/docs/CONNECT.md). If `npm --version` prints 12, see [troubleshooting](https://github.com/tonygorb/scenri/blob/main/docs/TROUBLESHOOTING.md) before the first run.

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

## Why it is built this way

- **Iteration is the product.** Not a prompt box: every shot keeps its trail of refinements, and the ones you mark collect in Keepers.
- **Your brands are files, not hostages.** `.brand` is an open, documented format under a permissive license. Email one to a client. Any tool can adopt it.
- **Your AI, your cost.** Bring your own ChatGPT plan through Codex CLI, or an API key. You pay the provider directly, at its own price. Scenri sells no credits and adds no markup.
- **Local first, and it means it.** No account, no telemetry, nothing uploaded to us. Scenri runs on this computer, and answers other devices on your own network only when they bring its six-digit code (Settings, Local access). It makes exactly two requests on its own behalf: a version-number check against npm every six hours so updates can announce themselves (and, when one is found, the download of that release from npm, staged locally until you choose to restart), and the download of the library imagery archive from GitHub, once for each library version a release pins. Nothing about you or your work is sent in either, and both turn off: in Settings or `SCENRI_NO_UPDATE_CHECK=1` for the first, `SCENRI_NO_CONTENT_FETCH=1` for the second ([how updates work](https://github.com/tonygorb/scenri/blob/main/docs/updates.md), [what goes where](https://github.com/tonygorb/scenri/blob/main/PRIVACY.md)).

Providers, costs, and what each one can carry are in [Connect image generation](https://github.com/tonygorb/scenri/blob/main/docs/CONNECT.md).

## Configuration

| Variable | Default | What it does |
|---|---|---|
| `SCENRI_HOME` | `~/.scenri` | where brands, images, and keys live |
| `SCENRI_PORT` | `4747` | port |
| `SCENRI_HOST` | `127.0.0.1` | the studio's own listener; `127.0.0.1` given explicitly also turns off phone access, see the note below |
| `SCENRI_NO_OPEN` | unset | set to `1` to skip opening a browser |
| `SCENRI_NO_UPDATE_CHECK` | unset | set to `1` to never ask npm for the latest version |
| `SCENRI_REGISTRY` | npmjs | registry for the update check and downloads (mirrors, forks, airgaps) |
| `SCENRI_NO_CONTENT_FETCH` | unset | set to `1` to never download the library imagery archive |
| `SCENRI_CONTENT_URL` | GitHub releases | where the library archive comes from (mirrors, forks, airgaps) |
| `SCENRI_CONTENT_PIN` | unset | a pin for a different archive at `SCENRI_CONTENT_URL`, checked file by file ([how](https://github.com/tonygorb/scenri/blob/main/docs/updates.md)) |

`OPENROUTER_API_KEY`, `REPLICATE_API_TOKEN` and `FAL_KEY` are read from the environment as an alternative to entering them in Settings.

**Phones and tablets.** Scenri also answers on this computer's Wi-Fi or Ethernet address, so a phone on the same network can open it: Settings, Local access shows a QR code. Scenri has no accounts, so every device other than this computer has to bring a six-digit code, which rides inside the QR code and the link; typing the bare address asks for it, ten wrong guesses from one device lock it out for ten minutes, and **New code** signs every device out. The first time, macOS or Windows may ask whether Node may accept incoming connections: allow it, or phones cannot reach Scenri. Setting `SCENRI_HOST=127.0.0.1` keeps Scenri to this computer alone. Over plain http the code travels unencrypted, like everything else, so treat phone access as convenience on a network you trust.

## Layout

| Package | Purpose |
|---|---|
| `packages/cli` | the `scenri` command: local server, engine detection, browser open |
| `packages/brand-spec` | the `.brand` schema, validator, and URL auto-builder |
| `packages/core` | brands, shot history, the version tree, image store, cost ledger (SQLite) |
| `packages/catalog` | product catalog import: Shopify, WooCommerce, Webflow, generic |
| `packages/engines/*` | engine adapters: `codex`, `openrouter`, `replicate`, `fal`, and `demo`, a placeholder used by the tests |
| `apps/studio` | the React studio the CLI serves |

One package publishes to npm: **`scenri`**, the CLI, which bundles everything else. The rest are internal.

## Contributing

Start with [CONTRIBUTING.md](https://github.com/tonygorb/scenri/blob/main/CONTRIBUTING.md). Engine adapters are the friendliest surface: one file, one interface, well covered by tests.

Accessibility is tracked in [docs/A11Y-BACKLOG.md](https://github.com/tonygorb/scenri/blob/main/docs/A11Y-BACKLOG.md). Biome's recommended accessibility rules run at `error`, so the backlog is currently empty and a new defect fails CI rather than joining a list.

Found a security problem? Please report it privately. See [SECURITY.md](https://github.com/tonygorb/scenri/blob/main/SECURITY.md).

## Status

Early. The version is `0.x` and interfaces can still move. Everything documented above works today. [ROADMAP.md](https://github.com/tonygorb/scenri/blob/main/ROADMAP.md) says what is next.

## License

The application is [AGPL-3.0-only](https://github.com/tonygorb/scenri/blob/main/LICENSE). The `.brand` format, its schema, and its validator live in [packages/brand-spec](https://github.com/tonygorb/scenri/tree/main/packages/brand-spec) under Apache-2.0, so any tool may implement or reuse them without taking on copyleft; the npm package carries that license text as `LICENSE-APACHE-2.0-brand-spec`. Contributions require a [CLA](https://github.com/tonygorb/scenri/blob/main/CLA.md).

The bundled imagery and curated content are licensed separately under [ASSETS-LICENSE.md](https://github.com/tonygorb/scenri/blob/main/docs/ASSETS-LICENSE.md): free to use within Scenri, commercial work included; no redistribution or rebundling. The npm package's `license` field describes the code; the starter imagery inside it stays under those asset terms.

The name and the mark are not part of the code license: [TRADEMARKS.md](https://github.com/tonygorb/scenri/blob/main/TRADEMARKS.md) says what a fork may and may not call itself. What the app does and does not send anywhere is written down in [PRIVACY.md](https://github.com/tonygorb/scenri/blob/main/PRIVACY.md).

---

Built in public by **Tony Gorb** · [tonygorb.com](https://tonygorb.com) · [hello@scenri.co](mailto:hello@scenri.co)
