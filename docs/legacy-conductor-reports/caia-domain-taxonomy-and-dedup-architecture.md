# CAIA Domain Taxonomy & Dedup Architecture

**Version:** 1.0  
**Date:** 2026-04-27  
**Status:** Design Proposal

---

## 1. Overview

This document defines the canonical 16-domain taxonomy for CAIA content classification and the three-layer deduplication engine architecture. Together they form the foundation for ingesting, classifying, deduplicating, and routing content across the CAIA platform.

---

## 2. Full 16-Domain Taxonomy

### 2.1 Domain Definitions

The CAIA taxonomy organises all ingestable content into 16 top-level domains. Each domain owns a set of sub-domains that narrow classification to the level of specificity required for routing and retrieval.

| # | Domain Key | Display Name | Description |
|---|---|---|---|
| 1 | `legal` | Legal | Contracts, legislation, case law, compliance frameworks |
| 2 | `finance` | Finance | Accounting, financial statements, investment instruments, tax |
| 3 | `medical` | Medical & Health | Clinical notes, drug information, medical research, patient care |
| 4 | `engineering` | Engineering & Technical | Software, hardware, architecture, systems design |
| 5 | `science` | Science & Research | Academic papers, lab data, experimental results |
| 6 | `hr` | Human Resources | Policies, job descriptions, onboarding, performance |
| 7 | `sales` | Sales & CRM | Proposals, pipelines, customer communications |
| 8 | `marketing` | Marketing | Campaigns, brand guidelines, content calendars, analytics |
| 9 | `operations` | Operations | Runbooks, SOPs, incident reports, supply chain |
| 10 | `product` | Product Management | PRDs, roadmaps, user stories, acceptance criteria |
| 11 | `education` | Education & Training | Curricula, course materials, assessments, certifications |
| 12 | `real_estate` | Real Estate | Property listings, lease agreements, valuations, zoning |
| 13 | `government` | Government & Policy | Regulations, public records, government reports |
| 14 | `media` | Media & Publishing | News articles, editorial content, scripts, transcripts |
| 15 | `logistics` | Logistics & Supply Chain | Shipping, inventory, route optimisation, vendor data |
| 16 | `general` | General / Uncategorised | Catch-all for content that does not fit any specific domain |

### 2.2 Sub-Domain Hierarchy

Each top-level domain expands into sub-domains as follows:

#### `legal`
- `contracts` — NDAs, MSAs, SOWs, employment agreements
- `compliance` — GDPR, SOC 2, HIPAA, ISO frameworks
- `litigation` — case law, court filings, arbitration records
- `ip` — patents, trademarks, copyright documents
- `regulatory` — SEC filings, environmental regulations

#### `finance`
- `accounting` — balance sheets, income statements, audits
- `tax` — corporate tax, VAT, transfer pricing documents
- `investment` — prospectuses, term sheets, cap tables
- `banking` — loan agreements, credit facilities, treasury docs
- `reporting` — quarterly reports, board packs, KPI dashboards

#### `medical`
- `clinical` — clinical notes, discharge summaries, orders
- `pharma` — drug monographs, trial data, formularies
- `imaging` — radiology reports, DICOM metadata
- `research` — systematic reviews, meta-analyses, IRB protocols
- `insurance` — prior auth, claims, EOBs

#### `engineering`
- `software` — source code, API docs, architecture diagrams
- `hardware` — schematics, BOM, test reports
- `infrastructure` — network diagrams, cloud configs, IaC
- `security` — threat models, pentest reports, CVE advisories
- `qa` — test plans, bug reports, coverage reports

#### `science`
- `biology` — genomics, proteomics, ecology studies
- `chemistry` — synthesis protocols, material safety data
- `physics` — experimental data, simulation results
- `data_science` — datasets, notebooks, model cards
- `environmental` — climate data, emissions reports

#### `hr`
- `policy` — employee handbooks, code of conduct
- `recruitment` — job postings, interview guides, offer letters
- `performance` — reviews, OKRs, PIPs
- `benefits` — health plans, pension documents
- `onboarding` — orientation materials, checklists

#### `sales`
- `proposals` — RFP responses, SOWs, quotes
- `contracts` — customer agreements, renewals
- `pipeline` — deal summaries, forecast reports
- `enablement` — battle cards, objection handling guides
- `crm_data` — account records, contact histories

#### `marketing`
- `campaigns` — briefs, ad copy, creative assets metadata
- `brand` — brand guidelines, tone of voice documents
- `content` — blog posts, whitepapers, case studies
- `analytics` — performance reports, attribution data
- `events` — conference materials, webinar scripts

#### `operations`
- `runbooks` — incident playbooks, escalation procedures
- `sop` — standard operating procedures
- `vendor` — supplier contracts, SLAs, vendor assessments
- `facilities` — office management, maintenance logs
- `quality` — ISO audit reports, corrective action records

#### `product`
- `prd` — product requirements documents
- `roadmap` — feature roadmaps, release plans
- `research` — user research, usability studies
- `specs` — technical specifications, API contracts
- `feedback` — customer feedback, NPS data

#### `education`
- `curriculum` — course outlines, learning objectives
- `materials` — lecture notes, slides, textbooks
- `assessment` — exams, rubrics, grading guides
- `certification` — professional certifications, accreditation docs
- `elearning` — SCORM packages, LMS exports

#### `real_estate`
- `listings` — property descriptions, MLS data
- `legal` — title deeds, lease agreements, purchase contracts
- `valuation` — appraisal reports, comparables analysis
- `zoning` — planning permissions, zoning maps
- `management` — maintenance records, tenant communications

#### `government`
- `legislation` — bills, acts, statutory instruments
- `policy` — government white papers, consultation documents
- `records` — FOIA responses, public notices
- `procurement` — RFP/RFQ/RFI documents, award notices
- `defence` — unclassified military doctrines, procurement specs

#### `media`
- `news` — articles, press releases, wire copy
- `editorial` — opinion pieces, longform features
- `broadcast` — scripts, transcripts, closed captions
- `social` — social media exports, community guidelines
- `publishing` — book manuscripts, journal articles

#### `logistics`
- `shipping` — bills of lading, shipping manifests, customs docs
- `inventory` — stock records, warehouse management exports
- `routing` — route optimisation plans, carrier schedules
- `vendor` — freight contracts, 3PL agreements
- `returns` — reverse logistics, RMA documentation

#### `general`
- `miscellaneous` — truly uncategorised content
- `multilingual` — content awaiting language detection
- `legacy` — migrated content with unknown origin

---

## 3. Domain Taxonomy JSON Schema

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://caia.internal/schemas/domain-taxonomy/v1",
  "title": "CAIADomainTaxonomy",
  "type": "object",
  "required": ["domain", "subdomain", "confidence", "version"],
  "properties": {
    "domain": {
      "type": "string",
      "enum": [
        "legal", "finance", "medical", "engineering", "science",
        "hr", "sales", "marketing", "operations", "product",
        "education", "real_estate", "government", "media",
        "logistics", "general"
      ],
      "description": "Top-level domain classification"
    },
    "subdomain": {
      "type": "string",
      "description": "Sub-domain within the top-level domain"
    },
    "confidence": {
      "type": "number",
      "minimum": 0,
      "maximum": 1,
      "description": "Classification confidence score (0.0–1.0)"
    },
    "secondary_domains": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["domain", "confidence"],
        "properties": {
          "domain": { "type": "string" },
          "subdomain": { "type": "string" },
          "confidence": { "type": "number", "minimum": 0, "maximum": 1 }
        }
      },
      "description": "Up to 3 secondary domain matches for cross-domain content"
    },
    "version": {
      "type": "string",
      "pattern": "^\\d+\\.\\d+$",
      "description": "Taxonomy schema version used for classification"
    },
    "classified_at": {
      "type": "string",
      "format": "date-time"
    },
    "classifier_model": {
      "type": "string",
      "description": "Identifier of the model or rule set that produced this classification"
    }
  }
}
```

### 3.1 Example Classification Record

```json
{
  "domain": "legal",
  "subdomain": "contracts",
  "confidence": 0.94,
  "secondary_domains": [
    { "domain": "finance", "subdomain": "banking", "confidence": 0.31 }
  ],
  "version": "1.0",
  "classified_at": "2026-04-27T18:00:00Z",
  "classifier_model": "caia-domain-classifier-v1"
}
```

---

## 4. Deduplication Engine — Three-Layer Funnel

The dedup engine processes every ingested document through three sequential layers before it is committed to the knowledge store. Each layer eliminates a different class of duplicate at increasing computational cost.

```
Ingest Queue
     │
     ▼
┌────────────────────────────────────────┐
│  LAYER 1: Exact Hash Match             │  ~0ms  (DB lookup)
│  SHA-256 fingerprint comparison        │
└────────────────────────────────────────┘
     │ pass-through (no exact match)
     ▼
┌────────────────────────────────────────┐
│  LAYER 2: Near-Duplicate Detection     │  ~5ms  (MinHash / LSH)
│  SimHash + MinHash Locality-Sensitive  │
│  Hashing, Jaccard similarity ≥ 0.85   │
└────────────────────────────────────────┘
     │ pass-through (no near-duplicate)
     ▼
┌────────────────────────────────────────┐
│  LAYER 3: Semantic Dedup               │  ~50ms (vector similarity)
│  Embedding cosine similarity ≥ 0.92   │
│  via sqlite-vec ANN index              │
└────────────────────────────────────────┘
     │ pass-through (semantically unique)
     ▼
Knowledge Store (committed)
```

### 4.1 Layer 1 — Exact Hash Match

**Mechanism:** SHA-256 hash of the normalised document body (after stripping whitespace, metadata headers, and conversion to UTF-8 NFC form).

**Storage:** Hash → document_id lookup in a dedicated `content_hashes` table (B-tree indexed).

**Action on match:** Merge provenance metadata into the existing record; discard the incoming document body. Increment `ingestion_count` on the canonical record.

**Cost:** Single indexed DB read, < 1 ms.

**False positive rate:** Cryptographically negligible (2⁻²⁵⁶).

### 4.2 Layer 2 — Near-Duplicate Detection

**Mechanism:** Two complementary algorithms run in parallel:

1. **SimHash (64-bit)** — Charikar's algorithm over 3-gram token shingles. Hamming distance ≤ 3 bits flags a near-duplicate.
2. **MinHash with LSH** — 128-permutation MinHash; 8 LSH bands of 16 rows each. Candidates with Jaccard similarity ≥ 0.85 are flagged.

**Storage:** SimHash signatures in a `simhash_index` column (integer, B-tree). MinHash band keys in a `minhash_bands` table partitioned by band number.

**Action on match:** Route to a human-review queue if similarity is in [0.85, 0.95); auto-merge if ≥ 0.95. The older or higher-provenance-scored document is kept as canonical.

**Cost:** ~5 ms per document for combined LSH lookup.

**False negative rate (missed duplicates):** < 2% at the 0.85 threshold with 128 permutations.

### 4.3 Layer 3 — Semantic Deduplication

**Mechanism:** Dense vector embedding (1536-dim) compared against existing corpus embeddings using Approximate Nearest Neighbour (ANN) search via sqlite-vec.

**Threshold:** Cosine similarity ≥ 0.92 triggers a dedup candidate; the decision matrix (§5) determines final action.

**Storage:** Vectors stored in sqlite-vec virtual table (see §6).

**Action on match:** If similarity is in [0.92, 0.97), route to domain-expert review. If ≥ 0.97, auto-merge with the canonical record, appending the new document's unique metadata as a provenance annotation.

**Cost:** ~50 ms per document (ANN search over 1 M vectors with HNSW index, 32 ef-search).

---

## 5. Decision Matrix

The decision matrix governs the final action taken when a candidate duplicate is identified. It combines the similarity score, the layer that detected the match, and the document's provenance tier.

| Detection Layer | Similarity Range | Provenance Equal | Provenance Higher (incoming) | Provenance Lower (incoming) |
|---|---|---|---|---|
| L1 — Exact | 1.0 | Merge metadata | Merge metadata | Merge metadata |
| L2 — Near-dup | ≥ 0.95 | Auto-merge, keep older | Auto-merge, keep incoming | Auto-merge, keep existing |
| L2 — Near-dup | [0.85, 0.95) | Human review | Human review | Human review |
| L3 — Semantic | ≥ 0.97 | Auto-merge, keep older | Auto-merge, keep incoming | Auto-merge, keep existing |
| L3 — Semantic | [0.92, 0.97) | Domain-expert review | Domain-expert review | Domain-expert review |
| None | < threshold | **Commit as new** | **Commit as new** | **Commit as new** |

### 5.1 Provenance Tiers

Provenance tiers rank document sources for conflict resolution:

| Tier | Label | Examples |
|---|---|---|
| 1 | Primary Source | Regulatory body, official government publication, court record |
| 2 | Authoritative Secondary | Peer-reviewed journal, audited financial statement |
| 3 | Verified Internal | Company-signed contracts, audited internal docs |
| 4 | Unverified Internal | Draft documents, email attachments |
| 5 | External Unverified | Web scraped content, user-uploaded documents |

---

## 6. sqlite-vec Recommendation

### 6.1 Why sqlite-vec

sqlite-vec is recommended as the vector store layer for CAIA's dedup and retrieval pipeline for the following reasons:

- **Embedded architecture** — runs in-process with the CAIA Node.js runtime; no separate vector DB service to manage or scale.
- **HNSW index** — supports Hierarchical Navigable Small World graph indexing for sub-linear ANN search at production scale.
- **Portability** — the vector store travels with the SQLite database file; trivial to snapshot, replicate, and test.
- **SQLite ecosystem** — joins with relational metadata, provenance tables, and domain classification records in a single query.
- **Open source** — MIT-licensed; no vendor lock-in.

### 6.2 Schema

```sql
-- Enable sqlite-vec extension
SELECT load_extension('./node_modules/sqlite-vec/sqlite-vec.so');

-- Main document store
CREATE TABLE IF NOT EXISTS documents (
  id            TEXT PRIMARY KEY,  -- UUID v7
  domain        TEXT NOT NULL,
  subdomain     TEXT,
  content_hash  TEXT NOT NULL,     -- SHA-256 hex
  simhash       INTEGER,           -- 64-bit SimHash
  content       TEXT,
  provenance_tier INTEGER DEFAULT 5,
  ingestion_count INTEGER DEFAULT 1,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

-- sqlite-vec virtual table for embeddings
CREATE VIRTUAL TABLE IF NOT EXISTS document_embeddings USING vec0(
  document_id TEXT PRIMARY KEY,
  embedding   FLOAT[1536]
);

-- Near-duplicate band index (Layer 2 MinHash LSH)
CREATE TABLE IF NOT EXISTS minhash_bands (
  band_id     INTEGER NOT NULL,   -- 0..7
  band_key    TEXT NOT NULL,      -- hex of band's row hashes
  document_id TEXT NOT NULL,
  PRIMARY KEY (band_id, band_key, document_id)
);

-- Content hash index (Layer 1)
CREATE UNIQUE INDEX IF NOT EXISTS idx_content_hash ON documents(content_hash);

-- SimHash index (Layer 2)
CREATE INDEX IF NOT EXISTS idx_simhash ON documents(simhash);
```

### 6.3 ANN Query Example

```typescript
// Find semantic near-duplicates for an incoming embedding
const candidates = await db.all(`
  SELECT
    d.id,
    d.domain,
    d.provenance_tier,
    vec_distance_cosine(de.embedding, ?) AS distance
  FROM document_embeddings de
  JOIN documents d ON d.id = de.document_id
  WHERE de.embedding MATCH ?
    AND k = 20
  ORDER BY distance ASC
`, [embeddingBuffer, embeddingBuffer]);

const duplicates = candidates.filter(c => (1 - c.distance) >= 0.92);
```

---

## 7. Edge Cases

### 7.1 Cross-Domain Duplicates

**Scenario:** The same document (e.g. a contract with financial schedules) is submitted through two different domain ingestion pipelines — once via the `legal` pipeline and once via `finance`.

**Handling:**
- Layer 1 (exact hash) will catch this before domain routing matters.
- If caught at Layer 2 or 3, the decision matrix resolves on provenance tier; domain metadata is merged into the canonical record's `secondary_domains` field.
- The document is stored once; both domain indexes point to the same canonical id.

### 7.2 Version Updates (Genuine Updates, Not Duplicates)

**Scenario:** A v2 of an NDA is submitted; it is 92% similar to v1 but represents a genuine legal revision.

**Handling:**
- Layer 3 will flag it at the [0.92, 0.97) range, routing to domain-expert review.
- The review UI displays a diff and asks: "Is this a new version or a duplicate?"
- If confirmed as a new version: create a new record, link to the prior version via `supersedes_id` FK, and do not merge.
- If confirmed as a duplicate: merge per the decision matrix.

### 7.3 Translations

**Scenario:** The same document exists in English and French.

**Handling:**
- Normalised text hashes will differ (L1 miss).
- Token-based SimHash will differ significantly (L2 miss at the 0.85 Jaccard threshold).
- Cross-lingual embeddings (e.g. multilingual-e5-large) will produce high cosine similarity (≥ 0.92), triggering L3.
- The decision matrix routes to expert review. The reviewer marks them as translation pairs; both are retained with a `translation_of` link rather than merged.

### 7.4 Template Instances

**Scenario:** 500 near-identical contracts generated from the same template; each has unique names and dates.

**Handling:**
- L1 will miss (content differs).
- L2 SimHash will likely detect high similarity (Hamming distance ≤ 3). Jaccard on 3-grams may be ≥ 0.85.
- Each contract is a genuine independent document; they should NOT be merged.
- **Solution:** Template detection pre-pass before the dedup funnel. If the document matches a registered template fingerprint, skip L2/L3 dedup and commit directly. The template registry is maintained by the Operations team.

### 7.5 Chunked Ingestion

**Scenario:** A 400-page legal brief is ingested as 80 x 5-page chunks for processing; each chunk is also re-submitted later as part of a different workflow.

**Handling:**
- Chunk-level dedup via L1 hash of each chunk.
- Parent document ID is tracked via `parent_document_id` on each chunk record.
- Re-submitted chunks match at L1; provenance metadata is updated.
- The parent document's `ingestion_count` is not inflated by chunk re-ingestion.

### 7.6 OCR Noise Variability

**Scenario:** Two scans of the same physical document produce slightly different OCR outputs due to scan quality.

**Handling:**
- L1 hash will differ.
- L2 SimHash Hamming distance may be > 3 due to character substitution noise.
- L3 semantic embeddings are robust to OCR noise at the sentence level; similarity will typically land in [0.92, 0.99], triggering the dedup funnel correctly.
- Recommendation: Pre-process with OCR confidence filtering; re-run OCR with enhanced resolution before ingestion if confidence < 0.80.

---

## 8. Open-Source Package TypeScript APIs

### 8.1 `caia-classifier` — Domain Classification Package

```typescript
/**
 * caia-classifier
 * Domain taxonomy classification for CAIA content pipelines.
 */

export type DomainKey =
  | 'legal' | 'finance' | 'medical' | 'engineering' | 'science'
  | 'hr' | 'sales' | 'marketing' | 'operations' | 'product'
  | 'education' | 'real_estate' | 'government' | 'media'
  | 'logistics' | 'general';

export interface ClassificationResult {
  domain: DomainKey;
  subdomain: string;
  confidence: number;
  secondaryDomains: Array<{
    domain: DomainKey;
    subdomain: string;
    confidence: number;
  }>;
  classifiedAt: Date;
  classifierModel: string;
}

export interface ClassifierOptions {
  /** Minimum confidence threshold to accept a classification. Default: 0.6 */
  minConfidence?: number;
  /** Maximum secondary domains to return. Default: 3 */
  maxSecondaryDomains?: number;
  /** Model identifier override */
  modelId?: string;
  /** Timeout in milliseconds. Default: 5000 */
  timeoutMs?: number;
}

export interface ClassifierClient {
  /**
   * Classify a single text document.
   */
  classify(text: string, options?: ClassifierOptions): Promise<ClassificationResult>;

  /**
   * Classify multiple documents in a single batch request.
   * Returns results in the same order as inputs.
   */
  classifyBatch(
    texts: string[],
    options?: ClassifierOptions
  ): Promise<ClassificationResult[]>;

  /**
   * Check whether the classifier service is healthy.
   */
  healthCheck(): Promise<{ status: 'ok' | 'degraded' | 'unavailable'; latencyMs: number }>;
}

export interface ClassifierConfig {
  /** Base URL of the CAIA classifier service */
  serviceUrl: string;
  /** API key for authentication */
  apiKey: string;
  /** Default options applied to all requests */
  defaultOptions?: ClassifierOptions;
}

/**
 * Create a new ClassifierClient instance.
 *
 * @example
 * ```typescript
 * import { createClassifier } from 'caia-classifier';
 *
 * const classifier = createClassifier({
 *   serviceUrl: 'https://classifier.caia.internal',
 *   apiKey: process.env.CAIA_API_KEY!,
 * });
 *
 * const result = await classifier.classify(documentText);
 * console.log(result.domain, result.subdomain, result.confidence);
 * ```
 */
export declare function createClassifier(config: ClassifierConfig): ClassifierClient;

/**
 * Utility: Retrieve the full taxonomy tree as a nested object.
 */
export declare function getTaxonomy(): Record<DomainKey, string[]>;

/**
 * Utility: Validate whether a given domain/subdomain pair is valid.
 */
export declare function isValidDomainPair(domain: string, subdomain: string): boolean;
```

### 8.2 `caia-dedup` — Deduplication Engine Package

```typescript
/**
 * caia-dedup
 * Three-layer deduplication engine for CAIA content pipelines.
 */

import type { Database } from 'better-sqlite3';

export type DedupAction =
  | 'commit'         // No duplicate found — commit as new document
  | 'auto_merge'     // High-confidence duplicate — merge automatically
  | 'review_human'   // Near-duplicate — route to human review queue
  | 'review_expert'; // Semantic near-duplicate — route to domain-expert review

export type DetectionLayer = 'none' | 'layer1_exact' | 'layer2_near' | 'layer3_semantic';

export interface DedupResult {
  action: DedupAction;
  layer: DetectionLayer;
  /** Similarity score at the layer that detected the match (0.0–1.0). Null if action is 'commit'. */
  similarity: number | null;
  /** ID of the canonical document if a duplicate was detected. */
  canonicalId: string | null;
  /** Processing time in milliseconds per layer */
  timings: {
    layer1Ms: number;
    layer2Ms: number;
    layer3Ms: number;
    totalMs: number;
  };
}

export interface IncomingDocument {
  /** Unique identifier for this ingestion event */
  id: string;
  /** Normalised plain-text content (UTF-8 NFC, whitespace-stripped) */
  content: string;
  /** Pre-computed 1536-dim embedding vector */
  embedding: Float32Array;
  /** Provenance tier (1 = highest authority, 5 = lowest) */
  provenanceTier: 1 | 2 | 3 | 4 | 5;
  /** Domain classification result */
  domain: string;
  subdomain?: string;
}

export interface DedupEngineOptions {
  /** Jaccard similarity threshold for Layer 2 auto-merge. Default: 0.95 */
  l2AutoMergeThreshold?: number;
  /** Jaccard similarity threshold for Layer 2 human review. Default: 0.85 */
  l2ReviewThreshold?: number;
  /** Cosine similarity threshold for Layer 3 auto-merge. Default: 0.97 */
  l3AutoMergeThreshold?: number;
  /** Cosine similarity threshold for Layer 3 expert review. Default: 0.92 */
  l3ReviewThreshold?: number;
  /** Number of MinHash permutations. Default: 128 */
  minHashPermutations?: number;
  /** Number of LSH bands. Default: 8 */
  lshBands?: number;
  /** ANN search ef parameter for HNSW. Default: 32 */
  hnswEfSearch?: number;
  /** Max ANN candidates to retrieve before filtering. Default: 20 */
  annTopK?: number;
}

export interface DedupEngine {
  /**
   * Run an incoming document through the full three-layer dedup funnel.
   * Does NOT commit the document — call commitDocument() after inspecting the result.
   */
  check(doc: IncomingDocument): Promise<DedupResult>;

  /**
   * Commit a document to the knowledge store after a 'commit' dedup result.
   * Throws if the document was already committed or if action !== 'commit'.
   */
  commitDocument(doc: IncomingDocument): Promise<{ id: string }>;

  /**
   * Merge an incoming document's metadata into an existing canonical record.
   * Call this when action is 'auto_merge'.
   */
  mergeIntoCanonical(
    incomingId: string,
    canonicalId: string,
    incomingDoc: IncomingDocument
  ): Promise<void>;

  /**
   * Retrieve dedup queue items pending review.
   */
  getPendingReview(options?: {
    type?: 'human' | 'expert';
    domain?: string;
    limit?: number;
  }): Promise<ReviewQueueItem[]>;

  /**
   * Resolve a review queue item.
   */
  resolveReview(
    reviewId: string,
    resolution: 'merge' | 'keep_both' | 'keep_incoming' | 'translation' | 'version'
  ): Promise<void>;
}

export interface ReviewQueueItem {
  reviewId: string;
  type: 'human' | 'expert';
  incomingDocumentId: string;
  canonicalDocumentId: string;
  similarity: number;
  layer: DetectionLayer;
  domain: string;
  createdAt: Date;
}

export interface DedupEngineConfig {
  /** better-sqlite3 Database instance (must have sqlite-vec loaded) */
  db: Database;
  options?: DedupEngineOptions;
}

/**
 * Create a DedupEngine instance backed by the provided SQLite database.
 *
 * @example
 * ```typescript
 * import Database from 'better-sqlite3';
 * import { createDedupEngine } from 'caia-dedup';
 *
 * const db = new Database('./caia.db');
 * db.loadExtension('./sqlite-vec.so');
 *
 * const engine = createDedupEngine({ db });
 *
 * const result = await engine.check({
 *   id: 'doc-123',
 *   content: normalisedText,
 *   embedding: new Float32Array(embeddingVector),
 *   provenanceTier: 3,
 *   domain: 'legal',
 *   subdomain: 'contracts',
 * });
 *
 * if (result.action === 'commit') {
 *   await engine.commitDocument(doc);
 * } else if (result.action === 'auto_merge') {
 *   await engine.mergeIntoCanonical(doc.id, result.canonicalId!, doc);
 * }
 * ```
 */
export declare function createDedupEngine(config: DedupEngineConfig): DedupEngine;

/**
 * Utility: Compute the SHA-256 hash of normalised content.
 */
export declare function computeContentHash(content: string): string;

/**
 * Utility: Compute a 64-bit SimHash of tokenised content.
 */
export declare function computeSimHash(tokens: string[]): bigint;

/**
 * Utility: Compute MinHash signature for LSH band construction.
 */
export declare function computeMinHash(
  tokens: string[],
  numPermutations?: number
): Uint32Array;

/**
 * Utility: Compute Jaccard similarity from two MinHash signatures.
 */
export declare function jaccardFromMinHash(a: Uint32Array, b: Uint32Array): number;
```

---

## 9. Open Questions

1. **Multilingual embeddings:** Should the L3 semantic dedup use a monolingual or multilingual embedding model? Multilingual models (e.g. multilingual-e5-large) enable cross-lingual dedup but have higher false-positive rates for topically similar but substantively different content.

2. **Chunked vs. whole-document dedup:** Should dedup run at the chunk level, the document level, or both? Chunk-level is more granular but increases vector store size significantly.

3. **Review SLA:** What is the acceptable time-to-resolution for items in the human/expert review queue? This determines the required reviewer capacity.

4. **Template registry ownership:** Which team maintains the template registry used to short-circuit dedup for template-generated documents?

---

*End of CAIA Domain Taxonomy & Dedup Architecture — v1.0*
