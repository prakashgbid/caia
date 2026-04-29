/**
 * @chiefaia/architecture-registry — public exports
 *
 * ARCH-001: schema + dedup key + per-kind metadata payload schemas.
 * ARCH-002: ts-morph AST extractor for components / APIs / services.
 * ARCH-003: drizzle introspect + package.json scanner.
 * ARCH-004: embeddings layer (reuses FREG infra).
 * ARCH-005: per-domain query API.
 * ARCH-006: EA Agent integration (architecturalInstructions ticket field).
 * ARCH-007: dashboard /architecture page.
 */

export {
  // Constants + enums
  ARCHITECTURE_REGISTRY_VERSION,
  DEFAULT_EMBEDDING_MODEL,
  DEFAULT_EMBEDDING_DIM,
  DEFAULT_EMBEDDING_VERSION,
  ARCH_REGISTRY_SOURCES,
  ARTIFACT_KINDS,
  EDGE_RELATIONS,
  ADR_STATUSES,
  MAX_NAME_LENGTH,
  MAX_DESCRIPTION_LENGTH,
  MAX_KEY_SIGNATURE_LENGTH,
  MAX_TAGS,
  MAX_FILE_PATHS,
  // Row schemas
  ArchArtifactRowSchema,
  ArchEdgeRowSchema,
  // Per-kind metadata schemas
  ComponentMetadataSchema,
  ApiMetadataSchema,
  SchemaMetadataSchema,
  MigrationMetadataSchema,
  PackageMetadataSchema,
  ServiceMetadataSchema,
  ThemeMetadataSchema,
  PluginMetadataSchema,
  IntegrationMetadataSchema,
  DomainModuleMetadataSchema,
  ObservabilitySignalMetadataSchema,
  AdrMetadataSchema,
  // Search schemas
  ArchSearchHitSchema,
  ArchSearchResultSchema,
  ArchQueryOptsSchema,
  // EA integration schemas
  ArchitecturalInstructionSchema,
  ArchitecturalInstructionsSchema,
} from './schema';

export type {
  ArchRegistrySource,
  ArtifactKind,
  EdgeRelation,
  AdrStatus,
  ArchArtifactRow,
  ArchEdgeRow,
  ComponentMetadata,
  ApiMetadata,
  SchemaMetadata,
  MigrationMetadata,
  PackageMetadata,
  ServiceMetadata,
  ThemeMetadata,
  PluginMetadata,
  IntegrationMetadata,
  DomainModuleMetadata,
  ObservabilitySignalMetadata,
  AdrMetadata,
  ArchSearchHit,
  ArchSearchResult,
  ArchQueryOpts,
  ArchitecturalInstruction,
  ArchitecturalInstructions,
} from './schema';

export { computeArtifactDedupKey, computeEdgeDedupKey } from './dedup-key';
export type { ArtifactDedupKeyInput, EdgeDedupKeyInput } from './dedup-key';

// ARCH-002: ts-morph AST extractors.
export {
  extractComponentsFromFiles,
  extractComponentsFromInMemorySources,
  extractComponentsFromProject,
  extractApisFromFiles,
  extractApisFromInMemorySources,
  extractApisFromProject,
  extractServicesFromAppsRoot,
  sha256,
} from './extractors';
export type { ExtractionResult, ExtractorOptions } from './extractors';

// ARCH-003 — drizzle introspect + package scanner.
export {
  extractSchemasFromInMemorySource,
  extractSchemasFromFile,
  extractMigrationsFromMigrationsDir,
  extractPackagesFromMonorepo,
} from './extractors';

// ARCH-004 — storage layer (sqlite-vec + FTS5; reuses FREG infra).
export {
  bootstrapVectorTables,
  buildArtifactFtsText,
  upsertArtifactRow,
  upsertEdgeRow,
  queryDense,
  querySparse,
  readArtifactById,
  readArtifactsByIds,
  readEdgesFrom,
  readEdgesTo,
  recordExtractRun,
} from './storage';
export type {
  BootstrapResult,
  DenseHit,
  SparseHit,
  DenseQueryOpts,
  SparseQueryOpts,
  ExtractRunRow,
} from './storage';

// Re-export the shared embedding client from FREG so AKG callers don't
// need a second import path. Same Ollama daemon, same model.
export {
  OllamaEmbeddingClient,
  StubEmbeddingClient,
  EmbedderUnavailableError,
} from '@chiefaia/feature-registry';
export type {
  EmbeddingClient,
  EmbedResult,
  OllamaClientOpts,
} from '@chiefaia/feature-registry';
