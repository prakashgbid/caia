# @chiefaia/architecture-registry

The **Architecture Knowledge Graph (AKG)**: a structured, embeddings-augmented
catalog of every architectural artifact in the CAIA monorepo + sites. Powers
the EA Agent's per-domain technical implementation instructions on every
story.

## Why

The Enterprise Architect (EA) Agent runs after the BA Agent on every story
and produces concrete, per-domain technical instructions (per the
2026-04-28 directive):

- **UI:** which existing component / theme / plugin to use; if a piece is
  missing, what to build (with file paths, naming, design-system tier).
- **Backend / BFF:** existing API to call (route + request/response
  schema), enhancement to existing API (delta), or brand-new API (full
  spec).
- **Database:** schema updates needed (which tables, which migrations).
- **Analytics / CMS / observability / infra / integration:** per-domain
  specifics.

To do that without burning Claude tokens or hallucinating API names, EA
queries this AKG. Each artifact is auto-extracted from the codebase via
AST parsing + drizzle introspect + package.json scanning, embedded
locally with `nomic-embed-text` (Ollama), and stored in `sqlite-vec`
(shared with `@chiefaia/feature-registry`).

## Architecture

- **Auto-extraction:** `ts-morph` for TypeScript components / Hono routes /
  services; drizzle-kit pull for DB schema; package.json + pnpm-workspace
  scanners for packages; ADR scanner for decisions.
- **Storage:** ordinary SQLite tables `arch_artifacts` + `arch_edges` for
  structured rows + relationships.
- **Embeddings:** `nomic-embed-text` via Ollama, stored in a sibling vec0
  virtual table `arch_artifacts_vec`. Hybrid search via FTS5 over name +
  description + key signature.
- **Per-domain query API:** `arch.findUIArtifacts`, `findBackendArtifacts`,
  `findDBArtifacts`, `findAcrossDomains` — ranked, filtered, with full
  metadata.
- **Cost:** zero Claude tokens. All extraction + embedding + retrieval is
  local.

Detailed architecture report:
`~/Documents/projects/reports/architecture-registry-architecture-2026-04-28.md`.

## Public API (ARCH-001)

```ts
import {
  ArchArtifactRowSchema,
  ArchEdgeRowSchema,
  ArtifactKind,
  EdgeRelation,
  computeArtifactDedupKey,
  computeEdgeDedupKey,
  ComponentMetadataSchema,
  ApiMetadataSchema,
  SchemaMetadataSchema,
  ArchitecturalInstructionsSchema,
} from '@chiefaia/architecture-registry';

// Schema validation
const row = ArchArtifactRowSchema.parse({ ... });

// Idempotent dedup keys
const artifactKey = computeArtifactDedupKey({
  project: 'caia',
  kind: 'component',
  name: 'PromptList',
  entryPath: 'apps/dashboard/components/prompt-list.tsx',
});

const edgeKey = computeEdgeDedupKey({
  fromId: 'arch_x',
  toId: 'arch_y',
  relation: 'depends_on',
});
```

## Coordination

- **FREG-### track** ships the local-AI embedding infrastructure (Ollama
  client, sqlite-vec bootstrap, embed cache). AKG consumes those via the
  same `EmbeddingClient` interface — no duplication. Both vector tables
  live in the orchestrator's SQLite DB.
- **VAL-### track** can validate that EA's `architecturalInstructions[]`
  reference real `arch_artifacts.id` rows.
- **TEST-### track** can scope test cases to the AKG-identified surfaces.
- **PO Taxonomy (BUCKET-###)** — every AKG row tags one or more
  `tech_sub_domain` values (canonical enum from `@chiefaia/ticket-template`).
- **Phase 1 pipeline order** — EA runs **after BA**, before Validator
  (per 2026-04-28 reorder directive). EA reads BA's enriched ticket,
  queries the AKG by tech sub-domain, populates `architecturalInstructions[]`
  on the ticket template; Validator then checks each instruction
  references real AKG artifacts.

## DoD compliance

- Unit tests over Zod schemas + dedup keys (ARCH-001)
- AST extractor tests with sample fixtures (ARCH-002)
- Drizzle introspect tests (ARCH-003)
- Embedding write/read cycle integration tests (ARCH-004)
- Search benchmark tests (ARCH-005)
- E2E test driving full pipeline EA → instructions referencing AKG
  (ARCH-008)
