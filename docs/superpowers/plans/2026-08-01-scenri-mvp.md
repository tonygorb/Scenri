# Scenri MVP v0.1 Implementation Plan

> Autonomous execution (user waived reviews). Inline + parallel-agent execution with adversarial review workflow at the end. Tests per package (vitest); UI verified live in browser.

**Goal:** Working local product: `pnpm dev` (later `npx scenri`) → studio UI → brand kits (manual + URL auto-build) → generate/edit images via engines → version tree with compare + drift-diff → spend caps + cost dashboard → export zip.

**Architecture:** Fastify server (packages/cli) owns core + engines, serves REST + built studio SPA. Core = better-sqlite3 at `$SCENRI_HOME` (default `~/.scenri`) + content-addressed image store. Engines behind `EngineAdapter` (core/src/engine.ts). Studio = Vite React + @radix-ui/themes, polls REST.

**Stack:** Node ≥20, pnpm, TS, tsup, vitest, fastify@5 + @fastify/static, better-sqlite3, sharp, pixelmatch + pngjs, jszip, ajv (2020), cheerio, React 18 + Vite 6 + @radix-ui/themes@3.

## Global constraints

- AGPL headers not required per-file; package licenses as scaffolded (brand-spec = Apache-2.0).
- No telemetry. No secrets in `.brand`. Keys: env vars or `$SCENRI_HOME/config.json` (`settings` API).
- `codex-cli` adapter `localOnly: true`, cost 0, never required — every flow must work with `mock` engine (always available, renders brand-colored placeholder via sharp; labeled "Demo").
- All HTTP adapters take injectable `fetchImpl`; codex adapter takes injectable `spawnImpl`. Tests never hit network.
- Data dir override via `SCENRI_HOME` in every test.

## File map

- `packages/core/src/{db.ts, imageStore.ts, brands.ts, projects.ts, tree.ts, ledger.ts, settings.ts, engine.ts(exists), index.ts}` + tests
- `packages/brand-spec/src/{validate.ts, buildFromUrl.ts, index.ts}` + fixtures + tests
- `packages/engines/mock/src/index.ts` (new pkg) — demo adapter
- `packages/engines/{openrouter,replicate,fal,codex-cli}/src/index.ts` + tests
- `packages/cli/src/{server.ts, routes/*.ts, engines.ts(registry), diff.ts, exportPack.ts, index.ts(bin)}` + tests (fastify inject)
- `apps/studio/src/{main.tsx, api.ts, App.tsx, views/{BrandsSidebar,BrandEditor,Workspace,TreeView,NodeCard,ComparePanel,GenerateBar,CostPanel,SettingsPage,ExportDialog}.tsx}`

## Interfaces (locked)

- Tree node: `{id, projectId, parentId|null, kind:'root'|'generation'|'edit', prompt, engineId, status:'running'|'done'|'error', images:string[] (hashes), costUsd, kept:boolean, error?, createdAt}`
- REST: `/api/brands` CRUD + `POST /api/brands/from-url`; `/api/projects` CRUD + `/api/projects/:id/tree`; `POST /api/nodes` `{projectId,parentId?,kind,prompt,engineId,count?,width?,height?}` → node (async fill); `GET /api/nodes/:id`; `POST /api/nodes/:id/keep`; `GET /api/engines`; `GET/PUT /api/caps`; `GET /api/costs/summary`; `GET /api/images/:hash`; `POST /api/diff` `{imageA,imageB}` → `{score, heatmapHash}`; `POST /api/export` → zip; `GET/PUT /api/settings`
- Ledger: `recordCost(engineId,nodeId,usd)`, `monthlySpend(engineId)`, `capFor(engineId)`, `assertUnderCap(engineId, nextEstimate)` throws `SpendCapError`.

## Phases

1. **P1 core** — db schema+migrations, image store (sha256 files), brands/projects/tree/ledger/settings modules. Tests: tree branching, cap enforcement, store dedupe. Commit.
2. **P2 brand-spec** — ajv validate (schema file exists), buildFromUrl (cheerio: title/og name, meta description, theme-color + top hex colors from inline/linked css, icon/og:image download via fetchImpl → imageStore). Fixture HTML tests. Commit.
3. **P3 engines** — mock (sharp placeholder w/ brand palette) inline; then openrouter (chat completions, modalities image, base64 out), replicate (models/{m}/predictions, Prefer: wait, poll fallback), fal (fal.run sync), codex-cli (spawn `codex exec` in temp workdir, collect PNGs, availability probe) — 4 adapters built by parallel agents against locked interface, each with mocked tests. Commit.
4. **P4 server** — fastify routes wiring core+registry, async node execution, diff (pixelmatch score + heatmap PNG), exportPack (sharp resize presets: ig-post 1080², ig-story 1080×1920, banner 1200×628, original; jszip). Inject tests with mock engine. Commit.
5. **P5 studio** — Vite+Radix app per file map; poll running nodes; compare w/ diff overlay; cost panel; settings (keys, caps). Build passes. Commit.
6. **P6 integrate** — CLI bin serves studio dist; full run; browser walkthrough: brand → project → generate(mock) → branch edit → compare+diff → keeper → export zip download; screenshots. Fix inline. Commit.
7. **P7 review** — ultracode workflow: parallel finders (correctness, security, ToS-boundary, UX-flow) → adversarial verify → fix confirmed → re-test. Commit.
8. **P8 wrap** — README quickstart update, memory update, final report.

## Self-review notes

- Spec coverage vs STRATEGY §11: brand kit ✓(P2/P5) generate+edit ✓(P3/P4) tree/compare/drift ✓(P1/P4/P5) adapters ✓(P3) caps+dashboard ✓(P1/P5) export ✓(P4/P5) polish ✓(P5/P6). Excluded per spec: video, publishing, teams, cloud.
- Risk: OpenRouter/fal/replicate payload shapes drift → adapters tolerant + tests lock our parsing only.
- Risk: sharp/better-sqlite3 native builds — verify at P0 install before proceeding.
