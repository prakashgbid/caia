/**
 * Shared test fixtures — synthetic AKG rows + a deterministic stub
 * embedder. Used by every test file.
 */

import type {
  ArchArtifactRow,
  ArchSearchHit,
  ArchSearchResult,
  EmbeddingClient,
  EmbedResult,
} from '@chiefaia/architecture-registry';

/**
 * Build a synthetic AKG artifact row with sensible defaults. Override
 * any field via `over`.
 */
export function row(over: Partial<ArchArtifactRow>): ArchArtifactRow {
  const now = 1716000000000;
  return {
    id: 'arch_test_1',
    kind: 'adr',
    project: 'caia',
    name: 'Test artifact',
    description: 'A synthetic row for tests.',
    filePaths: [],
    techSubDomains: [],
    tags: [],
    metadataJson: '{}',
    source: 'manual',
    embeddingModel: 'nomic-embed-text',
    embeddingDim: 768,
    embeddingVersion: 'v1.5',
    createdAt: now,
    updatedAt: now,
    dedupKey: '0'.repeat(40),
    ...over,
  } as ArchArtifactRow;
}

/**
 * Build a search hit wrapping a row, with fused score and match-type.
 */
export function hit(
  artifact: ArchArtifactRow,
  scoreFused = 0.9,
  matchType: ArchSearchHit['matchType'] = 'both',
): ArchSearchHit {
  return {
    row: artifact,
    scoreDense: 0.85,
    scoreSparse: 0.8,
    scoreFused,
    matchType,
  };
}

/**
 * Build a complete ArchSearchResult from a hits array.
 */
export function result(hits: ArchSearchHit[]): ArchSearchResult {
  return {
    hits,
    topMatch: hits[0] ?? null,
    thresholdUsed: 0.6,
    latencyMs: 1,
    embedderTokens: 42,
    kindsSearched: [],
    techSubDomainsFiltered: [],
  };
}

/**
 * The canonical example hit set described in the Layer 3 spec
 * preamble (lines 651-672). Used by the renderer + api tests.
 */
export function canonicalHits(): ArchSearchHit[] {
  return [
    hit(
      row({
        id: 'arch_adr_011',
        name: 'ADR-011 Event-first state with database as projection',
        kind: 'adr',
      }),
      0.92,
    ),
    hit(
      row({
        id: 'arch_adr_028',
        name: 'ADR-028 Architecture Knowledge Graph via sqlite-vec + nomic-embed',
        kind: 'adr',
      }),
      0.88,
    ),
    hit(
      row({
        id: 'arch_adr_038',
        name: 'ADR-038 EA Reviewer (per-ticket) vs EA Architect (platform-level) scope',
        kind: 'adr',
      }),
      0.85,
    ),
    hit(
      row({
        id: 'arch_p3',
        name: 'P3 No timelines, ever',
        kind: 'adr',
        tags: ['principle'],
      }),
      0.83,
    ),
    hit(
      row({
        id: 'arch_l01',
        name: 'L01 Pixel-perfect calibration (85%/95% diff thresholds)',
        kind: 'adr',
        tags: ['lesson'],
      }),
      0.79,
    ),
    hit(
      row({
        id: 'arch_fb_cdp',
        name: 'feedback-continuous-discipline-problem',
        kind: 'adr',
        tags: ['feedback'],
        entryPath: 'agent-memory/2026-05-24-continuous-discipline-problem.md',
      }),
      0.75,
    ),
  ];
}

/**
 * A deterministic stub embedder satisfying the full `EmbeddingClient`
 * interface (embed + embedBatch + modelName + modelDim).
 */
export function stubEmbedder(dim = 768): EmbeddingClient {
  return {
    modelName(): string {
      return 'stub-test';
    },
    modelDim(): number {
      return dim;
    },
    async embed(text: string): Promise<EmbedResult> {
      return {
        embedding: new Float32Array(dim).fill(0.01),
        tokens: text.length,
        latencyMs: 0,
      };
    },
    async embedBatch(texts: string[]): Promise<EmbedResult[]> {
      return texts.map((t) => ({
        embedding: new Float32Array(dim).fill(0.01),
        tokens: t.length,
        latencyMs: 0,
      }));
    },
  };
}
