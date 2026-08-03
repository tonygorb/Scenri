## What this changes

<!-- One or two sentences. What is different after this merges? -->

## Why

<!-- The problem, not the patch. Link an issue if there is one. -->

## Checks

- [ ] `pnpm typecheck` passes
- [ ] `pnpm exec biome ci .` passes
- [ ] `pnpm test` passes
- [ ] Commits follow Conventional Commits (`feat:`, `fix:`, `docs:`, …). The version bump is generated from these, so the prefix matters.
- [ ] I have signed the CLA (a bot will comment on the first PR)

## If this touches the UI

- [ ] Checked in a browser, not only in tests
- [ ] Checked in both light and dark themes

## If this touches the composer

The brief line has its own DOM layer (`apps/studio/src/composer/line.ts`) because caret behaviour cannot be reproduced with synthetic events.

- [ ] `pnpm --filter @scenri/studio test:e2e` passes against a running server
