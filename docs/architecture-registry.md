# Architecture Registry — `@chiefaia/architecture-registry`

**Track:** ARCH-001 → ARCH-009
**Status:** ✅ Complete (2026-04-28)
**Owner of the source of truth doc:**
`~/Documents/projects/reports/architecture-registry-architecture-2026-04-28.md`

The Architecture Registry — internally the **Architecture Knowledge Graph
(AKG)** — is a structured, embeddings-augmented index of every
architectural artifact in the CAIA monorepo and the websites: services,
APIs, components, themes, plugins, packages, schemas, migrations,
integrations, domain modules, observability signals, and ADRs. It is the
data layer that lets the EA Agent produce concrete, codebase-grounded
**per-domain architectural instructions** on every story.

This document is the entry point for builders working on or with the AKG.
For the long-form architectural rationale, schema design, and tooling
comparisons, see the report linked above.

## Why it exists

When the user submits a prompt, the pipeline decomposes it into stories,
enriches them, and routes them to a developer agent. For the developer
agent to be productive, the story it picks up must already say:

- "Use existing component `LeaderboardPage` at
  `apps/dashboard/components/leaderboard.tsx`." (reuse)
- "Extend `GET /leaderboard` to also return `last_login`. Schema delta:
  add `last_login` column to `users`." (enhance)
- "Create a new `UserProfilePage` at `apps/dashboard/components/profile.tsx`
  with props `{ userId: string }` following the design-system `page` tier."
  (create)

Without an AKG, the EA Agent would need to re-scan the codebase on every
story (slow, token-expensive, unreliable). The AKG pre-extracts every
artifact via AST/introspect/scan, embeds each row locally with
`nomic-embed-text` via Ollama, and stores everything in `sqlite-vec`
alongside the orchestrator's own database. Per-story EA queries take
~250ms total and consume **zero Claude tokens**.

## Pipeline integration

Per Prakash's 2026-04-28 directive, the pipeline order is:

```
prompt → PO → BA → EA (with AKG) → Validator → Test-Design → Task Manager
       → bucket → Coding → Test Runner → done
```

EA runs **after BA**, not between PO and BA, so it has BA's enriched
acceptance criteria + cross-agent inputs as context when querying the
AKG. The relevant pipeline stages, in order:

```
ingested → scaffolded → po_decomposed → ba_enriched → ea_decomposed
        → validated → test_designed → bucket_placed → ready_for_pickup
```

The `ea_decomposed` stage is owned by `runEAAgent` in
`apps/orchestrator/src/agents/ea-agent.ts`. After the BUCKET-003 taxonomy
classification (techSubDomains, risk, effort, claims), the agent runs a
second pass — `runEaAkgInstructor` in
`apps/orchestrator/src/agents/ea-akg-instructor.ts` — which queries the
AKG per story and writes `architecturalInstructions[]` onto
`stories.architectural_instructions_json`.

## Schema

### `arch_artifacts` (12 kinds)

Every architectural artifact lives in this single table. The `kind` column
distinguishes them:

| Kind                    | Source                | Examples |
| ----------------------- | --------------------- | -------- |
| `service`               | apps/<svc> scanner    | orchestrator, executor, dashboard |
| `api`                   | ts-morph (Hono routes)| `GET /leaderboard`, `POST /events` |
| `component`             | ts-morph              | `LeaderboardPage`, `Avatar`, `Button` |
| `theme`                 | future scanner        | design-system tokens, palettes |
| `plugin`                | future scanner        | analytics, dev-inspector |
| `package`               | package.json scanner  | `@chiefaia/logger`, `react`, `zod` |
| `schema`                | drizzle introspect    | `users`, `stories`, `arch_artifacts` |
| `migration`             | drizzle introspect    | `0028_feature_registry.sql` |
| `integration`           | future ADR scanner    | Vault, GitHub, Cloudflare |
| `domain_module`         | future ADR scanner    | auth, billing, gameplay |
| `observability_signal`  | future scanner        | log streams, metrics, alerts |
| `adr`                   | future ADR scanner    | ADR-001, ADR-002, … |

Each row carries:

- Identity: `id`, `kind`, `project`, `name`, `description`,
  `keySignature`, `dedupKey` (UNIQUE).
- Locator fields (any may be absent): `filePaths[]`, `entryPath`,
  `routeSignature`, `tableName`, `owningService`, `packageName`,
  `designSystemTier`.
- Domain tagging: `techSubDomains[]` (canonical BUCKET-001 enum), `tags[]`.
- Per-kind metadata: `metadataJson` — JSON-stringified payload validated
  against per-kind Zod schemas (`ComponentMetadata`, `ApiMetadata`,
  `SchemaMetadata`, `MigrationMetadata`, `PackageMetadata`, etc.).
- Provenance: `source` (`ast_extract` | `drizzle_introspect` | `package_scan`
  | `adr_scan` | `manual`), `contentHash`, `extractedAtCommit`.
- Embedding metadata: `embeddingModel`, `embeddingDim`, `embeddingVersion`.

### `arch_edges` (10 relations)

Directed dependency edges between artifacts. UNIQUE on
`(from_id, to_id, relation)`:

- `depends_on` — A imports B
- `consumes` — A consumes B's output (service → API)
- `exposes` — A exposes B (service → API; module → component)
- `extends` — A extends/specializes B (theme override, schema migration)
- `overrides` — plugin override of default
- `uses_component` — page/feature uses component
- `persists_to` — service writes to schema
- `emits_event` — service emits event type
- `subscribes_to` — service subscribes to event type
- `documented_by` — artifact documented by ADR

### `arch_extract_runs`

One row per extractor invocation. Powers the dashboard's "last extracted"
panel. Tracks: extractor name, timing, commit SHA, counts (inserted /
updated / unchanged), errors.

### Virtual tables (sqlite-vec / FTS5)

- `arch_artifacts_vec` — vec0 virtual table holding 768-dim Float32 embeddings.
- `arch_artifacts_fts` — FTS5 virtual table over name + description +
  key_signature + locator hints + tags + tech_sub_domains.

Bootstrapped per-connection via `bootstrapVectorTables(db, dim)` —
idempotent CREATE-IF-NOT-EXISTS, safe to call after FREG's bootstrap on
the same connection.

## Extractors (ARCH-002 + ARCH-003)

All extractors are pure transformations: `(sources) → ExtractionResult`.
No DB writes; the storage layer (ARCH-004) handles persistence.

### ts-morph (TypeScript AST)

- **`extractComponentsFromFiles`** / `extractComponentsFromInMemorySources`
  — emits one `arch_artifacts` row per React component plus
  `depends_on` edges per imported library.
- **`extractApisFromFiles`** / `extractApisFromInMemorySources` — Hono
  route detection; one row per `app.<method>('path', ...)`. Captures
  middleware chain + auth detection.
- **`extractServicesFromAppsRoot`** — one row per `apps/<svc>/` folder
  with a `package.json`. Port detection from `serve({port:...})`;
  background-loop detection from pump/worker/loop/poller filenames.

### drizzle introspect

- **`extractSchemasFromFile`** / `extractSchemasFromInMemorySource` —
  walks a drizzle `schema.ts` and emits one row per `sqliteTable()`
  with column metadata (name, type, nullable, default, primary key,
  unique) + indexes. Primary keys correctly marked NOT NULL.
- **`extractMigrationsFromMigrationsDir`** — walks every `*.sql` file
  in a drizzle migrations folder + reads `meta/_journal.json`. Captures
  sequence number, sha256 checksum, parsed `affectsTables`, applied/
  pending status.

### package scanner

- **`extractPackagesFromMonorepo`** — walks `apps/*`, `packages/*`,
  `templates/*`. Emits one row per workspace member + one row per
  unique external dependency. Computes reverse-deps (`consumers`).
  Emits `depends_on` edges for every consumer-→-dep pair.

### Per-kind tech_sub_domain inference

Every extractor tags rows with one or more values from the canonical
`TECH_SUB_DOMAINS` enum (in `@chiefaia/ticket-template`). Examples:

| Artifact path / name pattern             | Tags                            |
| ---------------------------------------- | ------------------------------- |
| `apps/dashboard/...`                     | `frontend`                      |
| `packages/ui/src/primitive/...`          | `frontend` + `design-system`    |
| `apps/orchestrator/src/api/routes/...`   | `bff` + maybe `observability`   |
| `apps/orchestrator/src/db/schema.ts` + `sqliteTable(...)` | `database`     |
| `apps/<n>/migrations/*.sql`              | `database` + `data-migration`   |
| `@chiefaia/logger`                       | `observability`                 |
| `@chiefaia/feature-registry`             | `ml-ai` + `agent-runtime`       |

## Storage + retrieval (ARCH-004)

- **`upsertArtifactRow(db, row, embedding)`** — atomic 3-table write
  (`arch_artifacts` + `arch_artifacts_vec` + `arch_artifacts_fts`) inside
  one SQLite transaction. Idempotent on `dedup_key`.
- **`upsertEdgeRow(db, row)`** — UPSERT keyed on
  `(from_id, to_id, relation)`. Resolves placeholder package targets
  (the form `pkg::<name>` from the component extractor) to canonical
  artifact IDs.
- **`queryDense(db, vec, opts)`** — top-K cosine-nearest-neighbors via
  sqlite-vec. Filters by kind / project / tech_sub_domain.
- **`querySparse(db, queryText, opts)`** — top-K BM25 hits via FTS5.
  Same filter shape.
- **`readArtifactById`** / **`readArtifactsByIds`** /
  **`readEdgesFrom`** / **`readEdgesTo`** — convenience reads.
- **`recordExtractRun(db, row)`** — extractor-invocation observability.

## Per-domain query API (ARCH-005)

Hybrid search (cosine + BM25 RRF) over the AKG. The EA Agent's primary
entry point.

```ts
import {
  archSearch,
  findUIArtifacts,
  findBackendArtifacts,
  findDBArtifacts,
  findPackageArtifacts,
  findIntegrationArtifacts,
  findAcrossDomains,
} from '@chiefaia/architecture-registry';

// UI hits: components / themes / plugins, tagged frontend / design-system / a11y
const ui = await findUIArtifacts(
  'leaderboard page rendering top players',
  { topK: 5, minScore: 0.5 },
  { db, embedder },
);

// Backend hits: APIs / services
const be = await findBackendArtifacts(
  'GET /leaderboard endpoint',
  { topK: 5 },
  { db, embedder },
);

// DB hits: schemas / migrations
const dbHits = await findDBArtifacts(
  'users table with chips_total column',
  { topK: 5 },
  { db, embedder },
);

// All-kind semantic search (long-tail domains)
const all = await findAcrossDomains(
  'session replay analytics integration',
  { topK: 5 },
  { db, embedder },
);
```

Each result is an `ArchSearchResult` with:

- `hits[]` — ranked `ArchSearchHit` objects, each carrying the full row
  plus `scoreDense`, `scoreSparse`, `scoreFused`, `matchType`.
- `topMatch` — convenience handle for the top hit.
- `latencyMs`, `embedderTokens` — telemetry.
- `kindsSearched`, `techSubDomainsFiltered` — what was filtered.

### Resilience

- Embedder unavailable (Ollama down, model not pulled) → `archSearch`
  falls through to sparse-only. EA gets a degraded but useful result
  instead of a hard error.
- AKG empty → no hits → EA falls back to `create` instructions.

## EA Agent integration (ARCH-006)

After BA enrichment, the EA Agent runs `runEaAkgInstructor` per story:

1. Read the BA-enriched ticket (acceptanceCriteria, scope, context,
   techSubDomains).
2. For every techSubDomain on the story, route to the matching per-domain
   helper:
   - `frontend` / `design-system` / `accessibility` / `web-analytics`
     → `findUIArtifacts`
   - `bff` / `backend` / `api-gateway` / `agent-runtime` /
     `event-driven` / `auth` / `observability` → `findBackendArtifacts`
   - `database` / `data-migration` → `findDBArtifacts`
   - `cms` / `crm` / `payments` / `email` / `search` / `secrets-management`
     / `monitoring-alerting` / `feature-flags` / `file-storage` /
     `cron-scheduling` → `findIntegrationArtifacts`
   - everything else → `findAcrossDomains`
3. Convert the top-K hit per domain into an `ArchitecturalInstruction`:
   - `score >= 0.85` → action=`reuse`, `referencedArtifactIds=[topId]`
   - `0.65 <= score < 0.85` → action=`enhance`, `enhancementOfArtifactId`
   - `score < 0.65` → action=`create` with `proposedPath` +
     `proposedSignature` synthesized from the techSubDomain
4. Persist into `stories.architectural_instructions_json`.
5. Stamp `stories.ea_decomposed_at`. Advance pipeline stage to
   `ea_decomposed`. Emit `ea-agent.akg.complete`.

The `ArchitecturalInstruction` schema lives in `@chiefaia/ticket-template`
(mirrored from the AKG package to avoid a circular dep). The
`TicketTemplateV1` schema carries `architecturalInstructions: z.array(...)`.

### Downstream consumers

- **Story Validator (VAL-###)** — verifies that every
  `referencedArtifactIds[]` entry resolves to a real
  `arch_artifacts.id`.
- **Test-Design Agent (TEST-###)** — scopes test cases to the AKG-
  identified surfaces.
- **Developer agent** — implements the instructions directly. No
  architectural thinking required.

## Dashboard (ARCH-007)

`/architecture` page — five panels:

1. **Summary cards** — total artifacts, total edges, kind / project /
   source breakdowns, recent extract-run count.
2. **Per-domain browser** — chip selector for every canonical
   `tech_sub_domain` → table of matching artifacts.
3. **Recent artifacts** — most-recently extracted/upserted rows.
4. **Recent extract runs** — extractor invocations + timing + counts.
5. **(Edge inspector)** — inline in summary; full DAG visualizer planned.

Polls every 30s. Fail-soft: any panel that 404s/500s renders an empty
card with "data unavailable".

API routes (orchestrator, prefix `/api/architecture`):

- `GET /summary`
- `GET /recent?limit=N&kind=...&project=...`
- `GET /by-domain?techSubDomain=frontend`
- `GET /extract-runs?limit=N`
- `GET /edges?fromId=arch_x|toId=arch_y`

## Coordination with FREG

The Feature Registry (`@chiefaia/feature-registry`, FREG-### track) and
the AKG share infrastructure but operate on different surfaces:

- **FREG** — user-feature granularity; populated when stories reach
  `done`; powers PO Agent's `lifecycle ∈ {new | enhance | …}`
  classification.
- **AKG** — artifact granularity (component, API, schema, …);
  auto-extracted from source code; powers EA Agent's per-domain
  instructions.

Shared:

- **Same Ollama daemon** (`localhost:11434`).
- **Same embedding model** (`nomic-embed-text`, 768-dim).
- **Same SQLite database file** — two separate vec0 / FTS5 virtual
  tables (`feature_registry_vec` + `arch_artifacts_vec`).
- **Same `EmbeddingClient` interface** — re-exported from `@chiefaia/
  feature-registry`; AKG callers don't need a second import path.

## How to run the extractors

The extractors are pure functions; the orchestrator's startup wiring
calls them on demand. For a one-time backfill:

```ts
import {
  extractServicesFromAppsRoot,
  extractApisFromFiles,
  extractComponentsFromFiles,
  extractSchemasFromFile,
  extractMigrationsFromMigrationsDir,
  extractPackagesFromMonorepo,
  upsertArtifactRow,
  upsertEdgeRow,
  recordExtractRun,
  StubEmbeddingClient,
  OllamaEmbeddingClient,
} from '@chiefaia/architecture-registry';

const repoRoot = '/Users/MAC/Documents/projects/caia';
const opts = {
  repoRoot,
  defaultProject: 'caia',
  now: Date.now(),
  extractedAtCommit: '<commit-sha>',
};

const embedder = new OllamaEmbeddingClient({});
// ... or the StubEmbeddingClient for tests.

const services = extractServicesFromAppsRoot(opts);
const packages = extractPackagesFromMonorepo(opts);
// + glob-based extractApisFromFiles + extractComponentsFromFiles
// + extractSchemasFromFile + extractMigrationsFromMigrationsDir

for (const row of [...services.artifacts, ...packages.artifacts /* ... */]) {
  const { embedding } = await embedder.embed(`${row.name}\n${row.description}`);
  upsertArtifactRow(db, row, embedding);
}
for (const edge of [...services.edges, ...packages.edges /* ... */]) {
  upsertEdgeRow(db, edge);
}
recordExtractRun(db, { /* ... timing + counts ... */ });
```

A scheduled re-extract on `pull_request.merged` (incremental, file-watcher-
driven for local dev) is a future enhancement.

## Token cost

**Zero Claude tokens** at every search. Every embedding query consumes
~50–200 local Ollama tokens (recorded in the search log for
auditability).

## Failure modes + mitigations

| Failure                              | Mitigation                                  |
| ------------------------------------ | ------------------------------------------- |
| Ollama daemon down                   | `archSearch` falls through to sparse-only    |
| AKG empty (fresh DB before backfill) | EA produces all-create instructions          |
| Stale extract (file changed since extraction) | `contentHash` lets re-extractor skip unchanged rows; full re-extract on PR merge |
| Embedding model upgrade              | `embeddingVersion` column lets a re-embed sweep find rows that need refreshing |
| pnpm-workspace name collision        | Dedup key is `(project, kind, name, locator)` — fully qualified |
| TS path alias resolution             | `ts-morph` resolves via `tsconfig.json`     |

## Implementation history

All 9 ARCH PRs merged to `main`:

- **ARCH-001** — package skeleton + Zod schemas + migration 0030 → PR #125
- **ARCH-002** — ts-morph extractors (components, APIs, services) → PR #127
- **ARCH-003** — drizzle introspect + package scanner → PR #131
- **ARCH-004** — sqlite-vec storage + EmbeddingClient → PR #128
- **ARCH-005** — per-domain query API + RRF fusion → PR #130
- **ARCH-006** — EA Agent integration + pipeline reorder → PR #138
- **ARCH-007** — dashboard `/architecture` + API routes → PR #141
- **ARCH-008** — E2E test → PR #143
- **ARCH-009** — this documentation

## See also

- `~/Documents/projects/reports/architecture-registry-architecture-2026-04-28.md`
  — full architecture rationale, schema design, tooling comparisons,
  implementation roadmap.
- `caia/packages/architecture-registry/README.md` — package overview.
- `caia/packages/feature-registry/README.md` — sister-track package
  (user-feature granularity).
- `~/Library/Application Support/Claude/.../agent/memory/architecture_registry_directive.md`
  — original directive (Prakash 2026-04-28).
- `~/Library/Application Support/Claude/.../agent/memory/po_taxonomy_directive.md`
  — canonical `tech_sub_domain` enum.
