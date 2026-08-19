# Contributing

Thanks for considering it. Issues with clear reproduction steps are as welcome as code, and a screenshot of something that looks wrong is a perfectly good contribution.

## Where to start

- **Engine adapters** (`packages/engines/*`) are the friendliest surface. One package is one provider implementing the `EngineAdapter` interface from `@scenri/core`, and they are well covered by tests. If your provider is not listed yet, open an "adapter wanted" issue first so we can agree on the shape.
- **The `.brand` spec** takes changes as RFC issues against `packages/brand-spec/SPEC.md`. That package is Apache-2.0 and additive-only within 0.x, because other tools are meant to be able to read the format.
- **Bugs and UX.** This project treats UX papercuts as real bugs, so please file them as such.

## Setup

```bash
pnpm install
git config core.hooksPath .githooks   # enables the secret-scan pre-commit hook
brew install gitleaks                 # or see github.com/gitleaks/gitleaks
pnpm build && pnpm dev                # studio on http://127.0.0.1:4747
```

Please run that `git config` line once. Git will not enable hooks for you, so the
hook is opt-in per clone. It refuses any commit containing something shaped like
a credential, and if gitleaks is not installed it says so and steps aside rather
than giving you false confidence.

The full test suite compiles prompts against the library imagery, which the repo
deliberately does not carry. Hydrate it once, about a 95 MB download, cached
under `~/.scenri/content`:

```bash
pnpm exec tsx packages/cli/scripts/pull-content.mts
```

## Before you open a pull request

```bash
pnpm typecheck && pnpm exec biome ci . && pnpm test
```

Use `biome ci`, not `biome lint`. Only the first checks formatting, and CI will
fail on a file that is merely unformatted.

If you touched `apps/studio`, run the browser suite too. It serves the built
studio rather than source, so the build has to come first:

```bash
pnpm build && pnpm --filter @scenri/studio test:e2e
```

## Ground rules

- Conventional commits. The released version is generated from them, so the prefix decides the bump: `fix:` is a patch, `feat:` is a minor, and `chore:`, `docs:`, `refactor:`, `test:`, `ci:` release nothing.
- Behaviour changes come with tests.
- Keep packages focused. A new top-level package is worth discussing first.
- Never commit a credential. If one slips out, rotate it. A key that reached a repository is burned whether or not the commit was later removed.

## The CLA

scenri is AGPL-3.0 with a dual-licensing model that funds its development. The same code may one day power a hosted service running API-priced engines, and scenri never pools user plans.

Every contributor signs the Contributor License Agreement once, through the CLA bot on your first pull request. It grants the maintainer the right to relicense contributed code. You keep your copyright and every right to use your contribution anywhere else. The full text is in [CLA.md](CLA.md).
