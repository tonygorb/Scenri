# Contributing

Thanks for considering a contribution.

## CLA

This project is AGPL-3.0 with a dual-licensing model that funds its development (the same code powers a future hosted service). All contributors must sign the Contributor License Agreement once, via the CLA bot on your first pull request. The CLA grants the maintainer the right to relicense contributed code; you retain copyright and all rights to use your contribution elsewhere. See [CLA.md](CLA.md).

## Where to contribute

- **Engine adapters** (`packages/engines/*`) — the friendliest surface. One package = one provider implementing the `EngineAdapter` interface from `@scenri/core`. Open an "adapter wanted" issue first if the provider isn't listed.
- **`.brand` spec** — propose changes as RFC issues against `packages/brand-spec/SPEC.md`. The spec itself is Apache-2.0 and additive-only within 0.x.
- **Bugs and UX** — issues with reproduction steps; screenshots welcome, this project treats UX papercuts as real bugs.

## Ground rules

- Conventional commits.
- Tests accompany behavior changes (`pnpm test`).
- Keep packages focused; new top-level packages need a maintainer discussion first.
