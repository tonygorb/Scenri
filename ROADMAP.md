# Roadmap

What scenri is for, what it does today, and what comes next. This is a solo side project, so treat the ordering as intent rather than as dates.

Have an opinion on any of it? Open an issue. The ordering below is not fixed, and what people actually hit changes it.

## The shape of the thing

scenri is a **local-first** studio for brand-consistent AI visuals. Three commitments hold across every release:

1. **Your data stays yours.** Brands, images, and history live in `~/.scenri`, in SQLite and plain files. No account, no telemetry, no upload.
2. **Your AI, your cost.** Generation runs on your own Codex CLI session or your own API keys, at raw provider price.
3. **The format is open.** `.brand` is documented and Apache-2.0 licensed, so any tool can read and write it without taking on copyleft.

Anything that would break one of those is out of scope, however useful it sounds.

## Working today

- Brand kits, drafted from a website URL or built from scratch
- The `.brand` open format, with a JSON Schema and a validator
- Products and characters as locked reference photos
- Product catalog import: Shopify, WooCommerce, Webflow, and a generic sitemap and JSON-LD reader
- Ten photographic looks with previews, plus a brief composer with `@` and `#` tokens
- The version tree: generate, branch an edit from any node, keep the winners
- Drift-diff, a pixel heatmap between a node and its parent
- A text overlay editor whose headlines stay editable layers, not baked pixels
- Export packs, and a per-engine cost ledger with monthly spend caps
- Five engines: Demo, Codex CLI, OpenRouter, Replicate, fal

## Next

**Make the first five minutes undeniable.** The gap between `npx scenri` and a shot worth keeping is still too wide. Better first-run guidance, faster URL to brand kit, clearer messaging when an engine is missing or a key is wrong.

**Fill in the looks.** Only one of the ten looks currently ships generated reference frames, and only two carry text zones. All ten should have both.

**Accessibility.** [docs/A11Y-BACKLOG.md](docs/A11Y-BACKLOG.md) lists every known defect with file and line. Keyboard reachability and label association come first.

**Make adapters easy to write.** An engine adapter is one file behind one interface. It should be documented well enough that adding a provider is an afternoon, and it is the contribution the project most wants.

## Later

- Mask-based local edits, so a change can be scoped to a region rather than a whole frame
- Batch generation across a product catalog
- A documented plugin surface for looks and export presets
- A published `.brand` spec site, so the format can be adopted independently of this app

## Not planned

- **Video.** A different craft with different tooling. Not in `0.x`.
- **Publishing to social platforms.** Export is the boundary. What you do with a PNG is your business.
- **Accounts, teams, or sharing in the local app.** The local app has no accounts at all, and adding them would break the first commitment above.
- **Telemetry.** Not on by default, not off by default. Not present.

## About a hosted version

A hosted version may exist later for people who cannot or do not want to run things locally. If it does: the local app stays free, fully featured, and open source, and it will never require an account. Hosted compute would be priced at what the API actually costs, because the whole objection this project was built around is credits that burn on a generation you did not want.

Nothing about that is built, and none of it is promised.
