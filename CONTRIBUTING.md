# Contributing

Thanks for considering a contribution.

## CLA

This project is AGPL-3.0 with a dual-licensing model that funds its development (the same code powers a future hosted service). All contributors must sign the Contributor License Agreement once, via the CLA bot on your first pull request. The CLA grants the maintainer the right to relicense contributed code; you retain copyright and all rights to use your contribution elsewhere. See [CLA.md](CLA.md).

## Where to contribute

- **Engine adapters** (`packages/engines/*`) — the friendliest surface. One package = one provider implementing the `EngineAdapter` interface from `@scenri/core`. Open an "adapter wanted" issue first if the provider isn't listed.
- **`.brand` spec** — propose changes as RFC issues against `packages/brand-spec/SPEC.md`. The spec itself is Apache-2.0 and additive-only within 0.x.
- **Bugs and UX** — issues with reproduction steps; screenshots welcome, this project treats UX papercuts as real bugs.

## Setup

```bash
pnpm install
git config core.hooksPath .githooks   # enables the secret-scan pre-commit hook
brew install gitleaks                 # or see github.com/gitleaks/gitleaks
pnpm build && pnpm dev                # studio on http://127.0.0.1:4747
```

The hook refuses any commit containing something shaped like a credential. It is
opt-in per clone because git will not enable hooks for you, so please run that
`git config` line once. If gitleaks is not installed the hook says so and steps
aside rather than giving you false confidence.

Before opening a pull request:

```bash
pnpm typecheck && pnpm exec biome ci . && pnpm test
```

## Ground rules

- Conventional commits. The released version is generated from them, so the prefix decides the bump.
- Tests accompany behavior changes (`pnpm test`).
- Keep packages focused; new top-level packages need a maintainer discussion first.
- Never commit a credential. If one slips out, rotate it. A key that reached a repository is burned, whether or not the commit was later removed.
