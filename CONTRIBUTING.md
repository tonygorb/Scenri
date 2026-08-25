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

## Working on the UI

The command above serves the studio the CLI has already built, so a source edit
only shows up after another `pnpm build`. For design work, run the Vite server
alongside it and iterate there instead:

```bash
pnpm dev        # the backend and your real library, on http://127.0.0.1:4747
pnpm dev:ui     # the studio with hot reload, on http://127.0.0.1:5173
```

Port 5173 proxies every `/api` call through to 4747, so it is the same app and
the same data, with CSS and components hot swapping in about a tenth of a second.
Build and reload on 4747 only when you need what the browser suites need: the E2E
run, `pnpm test:visual`, or a video capture.

## Before you open a pull request

```bash
pnpm typecheck && pnpm exec biome ci . && pnpm test
```

Use `biome ci`, not `biome lint`. Only the first checks formatting, and CI will
fail on a file that is merely unformatted.

If you changed how the studio behaves, run the browser suite too. It serves the
built studio rather than source, so the build has to come first:

```bash
pnpm build && pnpm --filter @scenri/studio test:e2e
```

While a change is still visual, the closest single spec is usually enough
(`pnpm --filter @scenri/studio exec playwright test e2e/composer.spec.ts`). The
full suite is what the pull request runs for you.

## What CI runs

Every pull request runs typecheck, lint, unit tests (Node 22 and 24) and a
secret scan. The browser (E2E) suite runs unless every changed file is
documentation: markdown, `docs/`, LICENSE, issue templates, the Dependabot
config. Code, workflows, build configs and the lockfile always trigger it. Draft pull requests skip E2E
until marked ready for review. The single required check is "CI gate"; it goes
green only when everything that was supposed to run passed.

## Ground rules

- Conventional commits. The released version is generated from them, so the prefix decides the bump: `fix:` is a patch, `feat:` is a minor, and `chore:`, `docs:`, `refactor:`, `test:`, `ci:` release nothing.
- Behaviour changes come with tests.
- Keep packages focused. A new top-level package is worth discussing first.
- Never commit a credential. If one slips out, rotate it. A key that reached a repository is burned whether or not the commit was later removed.

## The CLA

Scenri is AGPL-3.0 with a dual-licensing model that funds its development. The same code may one day power a hosted service running API-priced engines, and Scenri never pools user plans.

Every contributor signs the Contributor License Agreement once, through the CLA bot on your first pull request. It grants the maintainer the right to relicense contributed code. You keep your copyright and every right to use your contribution anywhere else. The full text is in [CLA.md](CLA.md).
