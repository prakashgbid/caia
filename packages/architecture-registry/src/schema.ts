/**
 * @chiefaia/architecture-registry — schema (ARCH-001)
 *
 * Architecture Knowledge Graph (AKG): the canonical, Zod-validated shape of
 * every architectural artifact in the CAIA monorepo + sites — services,
 * APIs, components, themes, plugins, packages, schemas, migrations,
 * integrations, domain modules, observability signals — plus the edge
 * relationships that connect them (dependency, expose, uses_component,
 * persists_to).
 *
 * Sister track to @chiefaia/feature-registry. Where FREG catalogs *user-
 * visible features* at story-completion time, the AKG catalogs *building
 * blocks* extracted from the source code itself. Both share the same
 * sqlite-vec embedding infrastructure (see ARCH-004) and the same DB file.
 *
 * EA Agent integration (ARCH-006): per story, EA queries the AKG by tech
 * sub-domain and produces concrete `architecturalInstructions` ("use
 * existing component X" or "create new API Y at path Z").
 *
 * Keep this file dependency-free aside from `zod` so it can be imported by
 * the orchestrator, dashboard, EA Agent, and tooling alike without dragging
 * in SQLite/Ollama transitive deps.
 */

import { z } from 'zod';
import { PROJECT_SLUGS, TECH_SUB_DOMAINS } from '@chiefaia/ticket-template';

// ─── Constants ───────────────────────────────────────────────────────────────

export const ARCHITECTURE_REGISTRY_VERSION = 'v1' as const;

/**
 * Default embedding model. Shared with FREG for vector-DB co-tenancy.
 * Stored on each row so a future model swap can detect-and-backfill stale
 * rows without rebuilding the whole index from scratch.
 */
export const DEFAULT_EMBEDDING_MODEL = 'nomic-embed-text' as const;
export const DEFAULT_EMBEDDING_DIM = 768 as const;
export const DEFAULT_EMBEDDING_VERSION = 'v1.5' as const;

/**
 * Provenance of a row: distinguishes auto-extracted artifacts (which can
 * be safely re-extracted without losing curation) from human-curated ones
 * (which a re-extraction should not overwrite).
 */
export const ARCH_REGISTRY_SOURCES = [
  'ast_extract', // ts-morph AST extraction (ARCH-002)
  'drizzle_introspect', // drizzle schema introspection (ARCH-003)
  'package_scan', // package.json + pnpm-workspace scanner (ARCH-003)
  'adr_scan', // ADR markdown frontmatter scanner
  'manual', // hand-curated row (do not overwrite on re-extract)
] as const;
export type ArchRegistrySource = (typeof ARCH_REGISTRY_SOURCES)[number];

/**
 * The kind of architectural artifact. Drives which extractor populates the
 * row + which `arch_*` table it lives in. Per-domain queries pivot on this.
 */
export const ARTIFACT_KINDS = [
  'service', // backend service (e.g. orchestrator, executor)
  'api', // HTTP/WS endpoint (route, method, request/response schema)
  'component', // UI React component (path, props, exports)
  'theme', // design-system theme tokens, palettes, typography
  'plugin', // site/agent plugin (analytics, dev-inspector, etc.)
  'package', // npm package, internal `@chiefaia/*` or third-party
  'schema', // DB table (columns, indexes, FKs)
  'migration', // drizzle migration with up/down + applied state
  'integration', // third-party integration (Vault, GitHub, Cloudflare)
  'domain_module', // DDD bounded context (auth, billing, gameplay, etc.)
  'observability_signal', // log stream, metric, dashboard, alert
  'adr', // architecture decision record
] as const;
export type ArtifactKind = (typeof ARTIFACT_KINDS)[number];

/**
 * The kind of edge (dependency relationship). All edges live in one
 * `arch_edges` table; the `relation` column distinguishes them.
 */
export const EDGE_RELATIONS = [
  'depends_on', // import-graph dependency (A imports B)
  'consumes', // A consumes B's output (e.g. service → API)
  'exposes', // A exposes B (service → API; module → component)
  'extends', // A extends/specializes B (theme override, schema migration)
  'overrides', // A overrides B (plugin override of default)
  'uses_component', // page/feature uses component
  'persists_to', // service writes to schema
  'emits_event', // service emits event type
  'subscribes_to', // service subscribes to event type
  'documented_by', // artifact documented by ADR
] as const;
export type EdgeRelation = (typeof EDGE_RELATIONS)[number];

/**
 * Lifecycle state of a stored ADR. Mirrors MADR/log4brains conventions.
 */
export const ADR_STATUSES = [
  'proposed',
  'accepted',
  'deprecated',
  'superseded',
  'rejected',
] as const;
export type AdrStatus = (typeof ADR_STATUSES)[number];

// ─── Bounded ────────────────────────────────────────────────────────────────

export const MAX_NAME_LENGTH = 200;
export const MAX_DESCRIPTION_LENGTH = 4000;
export const MAX_KEY_SIGNATURE_LENGTH = 8000;
export const MAX_TAGS = 20;
export const MAX_FILE_PATHS = 50;

// Project slug must match the canonical taxonomy from ticket-template.
const ProjectSlugEnum = z.enum(PROJECT_SLUGS);
const TechSubDomainEnum = z.enum(TECH_SUB_DOMAINS);

// ─── Per-row schema (entities) ──────────────────────────────────────────────

/**
 * A single architectural artifact. One row per service / API / component /
 * theme / plugin / package / schema / migration / integration / domain
 * module / observability signal / ADR.
 *
 * The shape is intentionally union-like: every artifact lives in this one
 * table, with kind-specific metadata in `metadataJson`. This keeps the
 * embedding + edge-traversal layers uniform while preserving per-kind
 * detail.
 */
export const ArchArtifactRowSchema = z
  .object({
    // ─── Identity ──────────────────────────────────────────────────────────
    /** `arch_<nanoid12>`. Stable across re-extracts (keyed on dedup_key). */
    id: z.string().min(1),

    /** What kind of artifact. Drives extractor + per-domain routing. */
    kind: z.enum(ARTIFACT_KINDS),

    project: ProjectSlugEnum,

    /** Short human-readable name (component name, route path, table name). */
    name: z.string().min(1).max(MAX_NAME_LENGTH),

    /**
     * Free-form description. Primary embedding input alongside
     * keySignature. For auto-extracted rows: JSDoc summary line, README
     * blurb, or a synthesized one-line summary.
     */
    description: z.string().min(1).max(MAX_DESCRIPTION_LENGTH),

    /**
     * The "shape" of the artifact in code: function signature, route
     * spec, prop interface, schema columns, etc. Embedded alongside name
     * + description so semantic search can match on signature shape.
     */
    keySignature: z.string().max(MAX_KEY_SIGNATURE_LENGTH).optional(),

    // ─── Locator fields (any may be absent) ────────────────────────────────
    /**
     * Repo-relative file paths implementing this artifact. Empty for
     * conceptual artifacts (e.g. domain modules, ADRs without files).
     */
    filePaths: z.array(z.string().min(1)).max(MAX_FILE_PATHS).default([]),

    /** Repo-relative entry point (single canonical path). */
    entryPath: z.string().optional(),

    /** API route + method (`'GET /api/leaderboard'`) for `kind=api`. */
    routeSignature: z.string().optional(),

    /** Table name (`'feature_registry'`) for `kind=schema|migration`. */
    tableName: z.string().optional(),

    /**
     * Service / package owning this artifact (e.g. 'orchestrator',
     * '@chiefaia/feature-registry'). Used to traverse from artifact →
     * owning service. Aligns with arch_services.id when known.
     */
    owningService: z.string().optional(),

    /**
     * For `kind=package`: the npm package name (e.g. '@chiefaia/logger',
     * 'better-sqlite3'). For internal packages this duplicates `name`;
     * for external it disambiguates.
     */
    packageName: z.string().optional(),

    /** Design-system tier: 'primitive' | 'pattern' | 'feature' | 'page'. */
    designSystemTier: z
      .enum(['primitive', 'pattern', 'feature', 'page'])
      .optional(),

    // ─── Domain tagging ────────────────────────────────────────────────────
    /**
     * One or more `tech_sub_domain` slugs (from BUCKET-001 taxonomy).
     * Drives per-domain queries: `arch.findUIArtifacts` filters by
     * `frontend|design-system|accessibility`, etc.
     */
    techSubDomains: z.array(TechSubDomainEnum).default([]),

    /**
     * Free-form tags. Union of business sub-domains, quality tags, and
     * extractor-emitted classifiers. Useful for filtering search results.
     */
    tags: z.array(z.string().min(1)).max(MAX_TAGS).default([]),

    // ─── Kind-specific metadata (JSON-serialized payload) ──────────────────
    /**
     * Free-form per-kind metadata. Extractors populate kind-appropriate
     * shapes:
     *
     *   kind=component → { props: [{ name, type, required, default? }],
     *                      exports: string[], jsDocSummary? }
     *   kind=api       → { method, path, requestSchema?, responseSchema?,
     *                      authRequired }
     *   kind=schema    → { columns: [{ name, type, nullable, default? }],
     *                      indexes: [{ name, columns, unique }],
     *                      foreignKeys: [...] }
     *   kind=migration → { upSql?, downSql?, checksum }
     *   kind=package   → { version, dependencies: string[], internal: bool }
     *   kind=adr       → { status: AdrStatus, decisionDate, supersedes? }
     *   ...
     *
     * Stored as JSON to avoid an explosion of nullable columns. Per-kind
     * Zod schemas in `metadata-schemas.ts` validate when extractors
     * write — call sites that read a row should `.parse` against the
     * matching schema.
     */
    metadataJson: z.string().default('{}'),

    // ─── Provenance ────────────────────────────────────────────────────────
    source: z.enum(ARCH_REGISTRY_SOURCES),

    /**
     * SHA-256 of the source content (for AST-extracted rows: the file
     * contents at extraction time). Lets the incremental extractor skip
     * rows whose source hasn't changed.
     */
    contentHash: z.string().min(8).max(80).optional(),

    /** Git commit SHA at extraction time (8-char short or full 40-char). */
    extractedAtCommit: z.string().optional(),

    // ─── Embedding metadata ────────────────────────────────────────────────
    embeddingModel: z.string().default(DEFAULT_EMBEDDING_MODEL),
    embeddingDim: z.number().int().positive().default(DEFAULT_EMBEDDING_DIM),
    embeddingVersion: z.string().default(DEFAULT_EMBEDDING_VERSION),

    // ─── Audit ─────────────────────────────────────────────────────────────
    createdAt: z.number().int().nonnegative(),
    updatedAt: z.number().int().nonnegative(),

    /**
     * sha256 of (project, kind, name, locator). UNIQUE — re-running an
     * extractor upserts the row idempotently. Locator preference:
     * routeSignature → entryPath → packageName → tableName → first(filePaths).
     */
    dedupKey: z.string().min(40).max(80),
  })
  .strict();

export type ArchArtifactRow = z.infer<typeof ArchArtifactRowSchema>;

// ─── Edges ──────────────────────────────────────────────────────────────────

/**
 * One row per directed relationship between two artifacts. Multi-relation
 * (A might both `depends_on` and `documented_by` B); UNIQUE on
 * (fromId, toId, relation).
 */
export const ArchEdgeRowSchema = z
  .object({
    id: z.string().min(1),

    /** arch_artifacts.id of the source artifact. */
    fromId: z.string().min(1),

    /** arch_artifacts.id of the target artifact. */
    toId: z.string().min(1),

    relation: z.enum(EDGE_RELATIONS),

    /** Optional weight for ranked traversals (e.g. import frequency). */
    weight: z.number().nonnegative().default(1.0),

    /** Free-form per-edge metadata (JSON). */
    metadataJson: z.string().default('{}'),

    source: z.enum(ARCH_REGISTRY_SOURCES),

    createdAt: z.number().int().nonnegative(),
    updatedAt: z.number().int().nonnegative(),
  })
  .strict();

export type ArchEdgeRow = z.infer<typeof ArchEdgeRowSchema>;

// ─── Per-kind metadata payload schemas ──────────────────────────────────────
//
// Optional but encouraged: extractors should validate against these before
// JSON-serializing into `metadataJson`. Readers can `.parse` the JSON back
// out to a typed shape when the kind is known.

export const ComponentMetadataSchema = z
  .object({
    props: z
      .array(
        z.object({
          name: z.string(),
          type: z.string(),
          required: z.boolean().default(false),
          defaultValue: z.string().optional(),
          description: z.string().optional(),
        }),
      )
      .default([]),
    exports: z.array(z.string()).default([]),
    jsDocSummary: z.string().optional(),
    isDefaultExport: z.boolean().default(false),
    /** 'function' | 'class' | 'memo' | 'forwardRef'. */
    componentForm: z.string().optional(),
    /** Higher-order things: hooks used, libraries imported. */
    hooksUsed: z.array(z.string()).default([]),
    importedLibraries: z.array(z.string()).default([]),
  })
  .strict();
export type ComponentMetadata = z.infer<typeof ComponentMetadataSchema>;

export const ApiMetadataSchema = z
  .object({
    method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', 'WS']),
    path: z.string(),
    /** JSON-stringified Zod schema description (best-effort). */
    requestSchemaSummary: z.string().optional(),
    responseSchemaSummary: z.string().optional(),
    authRequired: z.boolean().default(false),
    middlewareChain: z.array(z.string()).default([]),
    /** Hono app the route is registered on (e.g. 'orchestrator'). */
    appName: z.string().optional(),
  })
  .strict();
export type ApiMetadata = z.infer<typeof ApiMetadataSchema>;

export const SchemaMetadataSchema = z
  .object({
    tableName: z.string(),
    columns: z
      .array(
        z.object({
          name: z.string(),
          type: z.string(),
          nullable: z.boolean().default(true),
          defaultValue: z.string().optional(),
          isPrimaryKey: z.boolean().default(false),
          isUnique: z.boolean().default(false),
        }),
      )
      .default([]),
    indexes: z
      .array(
        z.object({
          name: z.string(),
          columns: z.array(z.string()),
          unique: z.boolean().default(false),
        }),
      )
      .default([]),
    foreignKeys: z
      .array(
        z.object({
          column: z.string(),
          referencesTable: z.string(),
          referencesColumn: z.string(),
        }),
      )
      .default([]),
  })
  .strict();
export type SchemaMetadata = z.infer<typeof SchemaMetadataSchema>;

export const MigrationMetadataSchema = z
  .object({
    /** Migration filename, e.g. '0028_feature_registry.sql'. */
    fileName: z.string(),
    /** Sequence number parsed from the filename prefix. */
    sequenceNumber: z.number().int().nonnegative(),
    /** SHA-256 of the SQL contents. */
    checksum: z.string(),
    /** Tables / indexes touched (best-effort SQL parse). */
    affectsTables: z.array(z.string()).default([]),
    /** True if `_journal.json` lists it as applied. */
    isApplied: z.boolean().default(false),
  })
  .strict();
export type MigrationMetadata = z.infer<typeof MigrationMetadataSchema>;

export const PackageMetadataSchema = z
  .object({
    /** semver string from package.json. */
    version: z.string(),
    /** True if internal (workspace:* or @chiefaia/*). */
    internal: z.boolean().default(false),
    /** Direct dependencies. */
    dependencies: z.array(z.string()).default([]),
    /** Direct devDependencies. */
    devDependencies: z.array(z.string()).default([]),
    /** Apps + packages that depend on this one (reverse-deps). */
    consumers: z.array(z.string()).default([]),
    /** Whether `private:true` in package.json. */
    isPrivate: z.boolean().default(false),
    /** package.json `main` / `types` entry. */
    entryPoint: z.string().optional(),
  })
  .strict();
export type PackageMetadata = z.infer<typeof PackageMetadataSchema>;

export const ServiceMetadataSchema = z
  .object({
    /** Hono app name (e.g. 'orchestrator', 'executor'). */
    appName: z.string().optional(),
    /** Listening port (if HTTP). */
    port: z.number().int().positive().optional(),
    /** Routes exposed by the service (list of arch_artifacts.id). */
    exposedApis: z.array(z.string()).default([]),
    /** Schemas the service writes to. */
    persistsToSchemas: z.array(z.string()).default([]),
    /** Events the service emits. */
    emitsEvents: z.array(z.string()).default([]),
    /** Whether the service has a worker / background loop. */
    hasBackgroundLoop: z.boolean().default(false),
  })
  .strict();
export type ServiceMetadata = z.infer<typeof ServiceMetadataSchema>;

export const ThemeMetadataSchema = z
  .object({
    /** Theme tokens: name → CSS value. */
    tokens: z.record(z.string()).default({}),
    /** Color palette names. */
    palettes: z.array(z.string()).default([]),
    /** Typography scale step names. */
    typographySteps: z.array(z.string()).default([]),
    /** True for light/dark base themes. */
    isBaseTheme: z.boolean().default(false),
  })
  .strict();
export type ThemeMetadata = z.infer<typeof ThemeMetadataSchema>;

export const PluginMetadataSchema = z
  .object({
    /** Plugin kind (e.g. 'analytics', 'dev-inspector', 'cms'). */
    pluginKind: z.string(),
    /** Hooks/extension points it implements. */
    extensionPoints: z.array(z.string()).default([]),
    /** Sites that use the plugin. */
    consumers: z.array(z.string()).default([]),
  })
  .strict();
export type PluginMetadata = z.infer<typeof PluginMetadataSchema>;

export const IntegrationMetadataSchema = z
  .object({
    /** Vendor (e.g. 'github', 'cloudflare', 'vault'). */
    vendor: z.string(),
    /** API surface used. */
    apiSurface: z.array(z.string()).default([]),
    /** Auth mechanism (e.g. 'oauth', 'pat', 'api-key', 'approle'). */
    authMechanism: z.string().optional(),
    /** Secret paths used (vault locators). */
    secretPaths: z.array(z.string()).default([]),
  })
  .strict();
export type IntegrationMetadata = z.infer<typeof IntegrationMetadataSchema>;

export const DomainModuleMetadataSchema = z
  .object({
    /** DDD bounded-context name (e.g. 'auth', 'billing'). */
    boundedContext: z.string(),
    /** Components+services participating. */
    participants: z.array(z.string()).default([]),
    /** Upstream / downstream contexts. */
    upstreamContexts: z.array(z.string()).default([]),
    downstreamContexts: z.array(z.string()).default([]),
  })
  .strict();
export type DomainModuleMetadata = z.infer<typeof DomainModuleMetadataSchema>;

export const ObservabilitySignalMetadataSchema = z
  .object({
    /** 'log_stream' | 'metric' | 'trace' | 'alert' | 'dashboard'. */
    signalKind: z.string(),
    /** Event types / metric names emitted. */
    emitterIds: z.array(z.string()).default([]),
    /** Severity / threshold info. */
    severity: z.string().optional(),
  })
  .strict();
export type ObservabilitySignalMetadata = z.infer<typeof ObservabilitySignalMetadataSchema>;

export const AdrMetadataSchema = z
  .object({
    status: z.enum(ADR_STATUSES),
    decisionDate: z.string().optional(), // ISO yyyy-mm-dd
    supersedes: z.array(z.string()).default([]),
    supersededBy: z.string().optional(),
    /** Artifacts the ADR governs. */
    governs: z.array(z.string()).default([]),
  })
  .strict();
export type AdrMetadata = z.infer<typeof AdrMetadataSchema>;

// ─── Search-result schemas ──────────────────────────────────────────────────

export const ArchSearchHitSchema = z
  .object({
    row: ArchArtifactRowSchema,
    /** cosine similarity in [0, 1]. -1 if dense retrieval missed. */
    scoreDense: z.number(),
    /** BM25 normalized to [0, 1]. -1 if sparse retrieval missed. */
    scoreSparse: z.number(),
    /** Reciprocal-Rank-Fusion score; higher = better. */
    scoreFused: z.number(),
    matchType: z.enum(['dense', 'sparse', 'both']),
  })
  .strict();
export type ArchSearchHit = z.infer<typeof ArchSearchHitSchema>;

export const ArchSearchResultSchema = z
  .object({
    hits: z.array(ArchSearchHitSchema),
    /** null iff hits is empty. */
    topMatch: ArchSearchHitSchema.nullable(),
    /** Cosine threshold actually used. */
    thresholdUsed: z.number(),
    /** Wall-clock ms for the full search call. */
    latencyMs: z.number().nonnegative(),
    /** Local-Ollama tokens. Always 0 in zero-Claude-token paths. */
    embedderTokens: z.number().int().nonnegative(),
    /** What kind(s) of artifact were searched. */
    kindsSearched: z.array(z.enum(ARTIFACT_KINDS)).default([]),
    /** Tech sub-domains the search was filtered by. */
    techSubDomainsFiltered: z.array(TechSubDomainEnum).default([]),
  })
  .strict();
export type ArchSearchResult = z.infer<typeof ArchSearchResultSchema>;

// ─── Per-domain query options ────────────────────────────────────────────────

export const ArchQueryOptsSchema = z
  .object({
    /** Free-form natural-language query (embedded for dense retrieval). */
    query: z.string().min(1),
    /** Restrict to specific artifact kinds. */
    kinds: z.array(z.enum(ARTIFACT_KINDS)).optional(),
    /** Restrict to specific tech sub-domains. */
    techSubDomains: z.array(TechSubDomainEnum).optional(),
    /** Restrict to specific projects. */
    projects: z.array(ProjectSlugEnum).optional(),
    /** Top-K hits to return. */
    topK: z.number().int().positive().max(50).default(10),
    /** Cosine threshold floor (drop hits below). */
    minScore: z.number().min(0).max(1).default(0.5),
  })
  .strict();
export type ArchQueryOpts = z.infer<typeof ArchQueryOptsSchema>;

// ─── EA Agent integration: architecturalInstructions ─────────────────────────
//
// These are the structured outputs the EA Agent attaches to a story's ticket
// template (see ARCH-006 ticket-template Zod schema extension). One per
// (tech_sub_domain) the story touches.

/**
 * A single concrete instruction attached to a story by the EA Agent. It
 * either:
 *   - References an existing artifact ("use X at path Y"), or
 *   - Specifies a new artifact to create ("create new component at path Z
 *     with these props"), or
 *   - Specifies an enhancement to an existing artifact ("extend API X with
 *     a new field Y").
 */
export const ArchitecturalInstructionSchema = z
  .object({
    /** ID — so VAL-### can reference "instruction 3 missing detail". */
    id: z.string().min(1),

    /** Tech sub-domain this instruction targets. */
    techSubDomain: TechSubDomainEnum,

    /** What to do: reuse / enhance / create / no-op. */
    action: z.enum(['reuse', 'enhance', 'create', 'no_op']),

    /** Free-form one-line summary, e.g. "Use existing LeaderboardPage at
     *  apps/site-pokerzeno/app/leaderboard/page.tsx". */
    summary: z.string().min(1).max(500),

    /** Concrete details (file paths, naming, props/spec, design-system
     *  tier compliance, etc.). */
    details: z.string().min(1).max(MAX_DESCRIPTION_LENGTH),

    /** AKG artifact IDs referenced by this instruction. Empty for `create`
     *  with no peer to reference. */
    referencedArtifactIds: z.array(z.string()).default([]),

    /** For `action=create`: where the new artifact should live. */
    proposedPath: z.string().optional(),

    /** For `action=create`: signature/spec the developer agent should
     *  implement. Drives test-design + implementation. */
    proposedSignature: z.string().optional(),

    /** For `action=enhance`: what existing artifact + what delta. */
    enhancementOfArtifactId: z.string().optional(),

    /** Confidence in the AKG match (1.0 = perfect; <0.85 = ambiguous). */
    confidence: z.number().min(0).max(1).default(1.0),
  })
  .strict();
export type ArchitecturalInstruction = z.infer<typeof ArchitecturalInstructionSchema>;

/**
 * The list attached to a story by the EA Agent. ARCH-006 extends the
 * ticket-template Zod schema to carry this; the dashboard renders it; the
 * developer agent reads it; the validator (VAL-###) checks each
 * referenced artifact exists.
 */
export const ArchitecturalInstructionsSchema = z.array(ArchitecturalInstructionSchema);
export type ArchitecturalInstructions = z.infer<typeof ArchitecturalInstructionsSchema>;
