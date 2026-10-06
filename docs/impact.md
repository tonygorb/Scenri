# Docs impact

Public docs live in this repo, under `docs/`, and on the website as the pages in `scenri-website/docs.manifest.json`. This file is not one of those pages.

A release note does not update a guide. What's New says what changed. The docs say how the product works now.

## Classes

**Docs required.** A person using Scenri would do something differently, or a page would be wrong if left alone. New or removed workflow, navigation, install requirement, provider, platform, Product, Person, Place, import, local data, CLI command, or a renamed concept.

**Docs maybe.** A user might notice, and someone has to look. Wording, an error message, a limit, a default.

**No public docs impact.** Internal refactor, tests, or a performance change with the same behavior. Say why, in one sentence: `No public docs impact: <reason>`. A missing reason is not this class.

`docs:` commits do not cut an npm release. After they merge, the website's `docs.lock` moves to that commit. The site does not wait for the next `feat` or `fix`.

## Map

The script `packages/cli/scripts/docs-impact.mjs` reads the lines below. One area, then the path prefixes that suggest it. A match is a reminder, not a verdict.

- Install: packages/cli/src/desktop, packages/cli/src/index.ts, packages/cli/package.json, docs/INSTALL.md, docs/TROUBLESHOOTING.md, docs/QUICKSTART.md, docs/OVERVIEW.md
- Products: apps/studio/src/views/Product, apps/studio/src/create/Product, packages/catalog, packages/cli/src/catalogImport, packages/cli/src/routes/catalogImport, docs/PRODUCTS.md
- People: apps/studio/src/create/presenter, apps/studio/src/views/Presenter, docs/PEOPLE.md
- Places: apps/studio/src/create/scene, apps/studio/src/views/Scene, docs/PLACES.md
- Create: apps/studio/src/composer, apps/studio/src/views/Create, docs/CREATE.md, docs/CONCEPTS.md
- Refine: apps/studio/src/layout/detail, apps/studio/src/layout/rendering, docs/REFINE.md
- Keepers: apps/studio/src/feedRules.ts, apps/studio/src/views/create, docs/KEEPERS.md
- Brand: apps/studio/src/views/settings/Brand, apps/studio/src/brand, apps/studio/src/views/BrandSetup, packages/brand-spec, docs/BRAND.md, docs/brand-marks.md
- Files: docs/FILES.md, PRIVACY.md
- Providers: packages/engines, apps/studio/src/views/ProviderSetup, apps/studio/src/engines, docs/CONNECT.md, docs/FAQ.md

When a UI area changes, search the docs for a screenshot of that area before assuming prose is enough. Do not add a screenshot unless the step is spatial.

`docs/updates.md`, `docs/presenter-lifecycle.md`, `docs/RELEASING.md`, and `docs/A11Y-BACKLOG.md` are not public pages.
