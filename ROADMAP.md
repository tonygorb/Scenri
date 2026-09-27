# Roadmap

What Scenri is for, what it does today, and what comes next. This is a solo project, so treat the ordering as intent rather than as dates.

Have an opinion on any of it? Open an issue. The ordering below is not fixed, and what people actually hit changes it.

## The shape of the thing

Scenri is a **local-first** studio for brand-consistent AI visuals. Three commitments hold across every release:

1. **Your data stays yours.** Brands, images, and history live in `~/.scenri`, in SQLite and plain files. No account, no telemetry, no upload.
2. **Your AI, your cost.** Generation runs on your own Codex CLI session or your own API keys, at raw provider price.
3. **The format is open.** `.brand` is documented and Apache-2.0 licensed, so any tool can read and write it without taking on copyleft.

Anything that would break one of those is out of scope, however useful it sounds.

## Working today

- Brand kits, drafted from a website URL (name, logo, palette, and the site's products when it sells any) or built from scratch
- The `.brand` open format, with a JSON Schema and a validator
- Products from your own photos, or imported from a store: Shopify, WooCommerce, Webflow, and a generic sitemap and JSON-LD reader
- Presenters made in a short conversation: describe a person or start from photos of one, approve the face, then the views built from it; edits are saved as revisions
- Scenes made the same way, from a sentence, a few guided questions, pictures of a place or one of your own shots, drawn as the place and the place in use
- A library to start from: demo products, presenters and scenes, and a wall of worked examples on Home that each reopen as the prompt that made them
- A composer where `$` reaches for a product, `@` a presenter, `/` a scene and `#` a colour
- Refinement: say what to change, and every step stays on the shot's trail; star the keepers
- Downloads of any picture, an export of the whole library, and `.brand` export
- The cost of each shot on paid providers, and a monthly spend cap per provider
- Four engines: Codex CLI, OpenRouter, Replicate, fal
- Local access: open Scenri from a phone or tablet on your own network, with a six-digit code
- A desktop icon on macOS and Windows that starts Scenri and opens it in your browser
- Updates that download in the background and wait for you to restart into them
- A guided first shot for someone new, and Learn for everything after it

## Next

**Accessibility.** The known-defect backlog in [docs/A11Y-BACKLOG.md](docs/A11Y-BACKLOG.md) is clear and Biome's recommended accessibility rules run at `error`, so regressions fail CI. What automation cannot see is next: a real screen-reader pass over Create and the shot overlay, and keyboard reachability of the composer's chips.

**Make adapters easy to write.** An engine adapter is one file behind one interface. It should be documented well enough that adding a provider is an afternoon, and it is the contribution the project most wants.

## Later

- Choosing by hand the region an edit may change (today a local edit finds its region itself, and restores everything outside it from the original)
- Batch generation across a product catalog
- A documented plugin surface for scenes
- A published `.brand` spec site, so the format can be adopted independently of this app

## Not planned

- **Video.** A different craft with different tooling. Not in `0.x`.
- **Publishing to social platforms.** Export is the boundary. What you do with a PNG is your business.
- **Accounts, teams, or sharing in the local app.** The local app has no accounts at all, and adding them would break the first commitment above.
- **Telemetry.** Not on by default, not off by default. Not present.

## About a hosted version

A hosted version may exist later for people who cannot or do not want to run things locally. If it does: the local app stays free, fully featured, and open source, and it will never require an account. Hosted compute would be priced at what the API actually costs, because the whole objection this project was built around is credits that burn on a generation you did not want.

Nothing about that is built, and none of it is promised.
