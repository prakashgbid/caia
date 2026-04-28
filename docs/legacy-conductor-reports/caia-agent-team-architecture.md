# CAIA Agent Team Architecture

**Version:** 1.0  
**Date:** 2026-04-27  
**Status:** Design Proposal

---

## 1. Overview

This document defines the full agent team architecture for the CAIA platform. CAIA operates a hierarchy of 25 specialised agents arranged across 6 tiers. Each agent has a clearly defined role, input/output interface, and communication protocol. Together they form a coordinated pipeline that ingests, classifies, deduplicates, enriches, and serves enterprise knowledge at scale.

---

## 2. Agent Tier Structure

```
Tier 0 — Orchestration
  └─ Conductor Agent (1)

Tier 1 — Ingestion
  ├─ Ingest Agent (1)
  ├─ Scraper Agent (1)
  └─ Connector Agent (1)

Tier 2 — Processing
  ├─ Chunker Agent (1)
  ├─ Classifier Agent (1)
  ├─ Dedup Agent (1)
  ├─ OCR Agent (1)
  └─ Normaliser Agent (1)

Tier 3 — Enrichment
  ├─ Embedder Agent (1)
  ├─ Metadata Agent (1)
  ├─ Entity Extractor Agent (1)
  ├─ Summariser Agent (1)
  └─ Linker Agent (1)

Tier 4 — Knowledge
  ├─ Indexer Agent (1)
  ├─ Knowledge Graph Agent (1)
  └─ Archivist Agent (1)

Tier 5 — Serving
  ├─ Query Agent (1)
  ├─ Retrieval Agent (1)
  ├─ Synthesiser Agent (1)
  ├─ Citation Agent (1)
  └─ Compliance Agent (1)

Tier 6 — Infrastructure
  ├─ Monitor Agent (1)
  ├─ Scaffolder Agent (1)
  └─ Audit Agent (1)
```

**Total: 25 agents across 6 tiers** (Tier 0 + Tiers 1–6 = 7 levels; numbered 0–6 for consistency with inter-agent routing).

---

## 3. Scaffolder Agent Design

The Scaffolder Agent is the bootstrap component of the CAIA system. It is responsible for provisioning new CAIA deployments, registering agent instances, wiring inter-agent communication channels, and ensuring that all infrastructure dependencies are available before any other agent is started.

### 3.1 Responsibilities

- **Schema migration** — runs pending SQLite migrations (including sqlite-vec extension loading) before any agent starts.
- **Agent registration** — populates the agent registry (§4) with all 25 agents' metadata on first boot.
- **Channel initialisation** — creates message queues and pub/sub topics in the configured transport layer.
- **Health gate** — polls each agent's `/health` endpoint after startup; holds back routing until all Tier 1–4 agents report `ok`.
- **Config injection** — reads `CAIA_CONFIG` environment variables and distributes domain-specific config to each agent via a one-time `configure` message.
- **Graceful shutdown** — on `SIGTERM`, sends a `drain` signal to all agents in reverse tier order, waits for in-flight messages to complete, then sends `stop`.

### 3.2 Scaffolder Startup Sequence

```
1. Load env → validate required vars
2. Connect to SQLite → run migrations → load sqlite-vec
3. Populate agent registry (upsert)
4. Start infrastructure agents (Tier 6: Monitor, Audit)
5. Start knowledge agents (Tier 4: Indexer, Graph, Archivist)
6. Start enrichment agents (Tier 3)
7. Start processing agents (Tier 2)
8. Start ingestion agents (Tier 1)
9. Start serving agents (Tier 5)
10. Start orchestration agent (Tier 0: Conductor)
11. Health gate — poll all agents, retry 3× with 2s backoff
12. Emit `system.ready` event → Conductor begins accepting work
```

### 3.3 Scaffolder Input/Output

**Input:** Environment variables + `scaffolder.config.json`

**Output:**
- Populated agent registry
- Initialised message channels
- `system.ready` event on the event bus
- Scaffolder health log written to `logs/scaffolder-boot.jsonl`

---

## 4. Inter-Agent Communication Protocol

### 4.1 Transport

All inter-agent messages are transported over an **in-process event bus** (for single-node deployments) or **Redis Streams** (for multi-node deployments). The protocol is transport-agnostic; agents communicate via a common message envelope.

### 4.2 Message Envelope Schema

```typescript
interface CAIAMessage<T = unknown> {
  /** UUID v7 — monotonically sortable */
  id: string;
  /** Dot-separated routing key: e.g. "ingest.document.received" */
  topic: string;
  /** Sending agent identifier */
  from: AgentId;
  /** Target agent identifier (null = broadcast) */
  to: AgentId | null;
  /** Correlation ID for tracing a request/response pair */
  correlationId: string | null;
  /** ISO 8601 timestamp */
  sentAt: string;
  /** Time-to-live in milliseconds (0 = no expiry) */
  ttlMs: number;
  /** Message priority: 0 (lowest) – 9 (highest) */
  priority: number;
  /** Domain-specific payload */
  payload: T;
  /** Optional metadata for routing and observability */
  meta: {
    traceId: string;
    spanId: string;
    retryCount: number;
    sourceSessionId?: string;
  };
}
```

### 4.3 Topic Naming Convention

Topics follow a three-part `{domain}.{entity}.{event}` pattern:

| Topic | Published by | Consumed by |
|---|---|---|
| `ingest.document.received` | Ingest, Scraper, Connector | Chunker |
| `ingest.document.failed` | Ingest, Scraper, Connector | Monitor, Audit |
| `chunk.created` | Chunker | Classifier, OCR, Normaliser |
| `chunk.classified` | Classifier | Dedup, Embedder |
| `chunk.deduplicated` | Dedup | Embedder, Metadata |
| `chunk.embedded` | Embedder | Indexer, Linker |
| `document.enriched` | Metadata, Entity Extractor | Knowledge Graph |
| `document.indexed` | Indexer | Conductor |
| `query.received` | Query | Retrieval |
| `retrieval.completed` | Retrieval | Synthesiser, Citation |
| `response.ready` | Synthesiser | Conductor |
| `system.ready` | Scaffolder | Conductor |
| `system.health` | Monitor | All agents (broadcast) |
| `audit.event` | All agents | Audit |

### 4.4 Request-Reply Pattern

For synchronous-style operations (e.g. health checks, config queries), agents use the **request-reply** pattern:

1. Requester publishes a message with a unique `correlationId` and `replyTo` topic.
2. Responder processes the request and publishes a reply to the `replyTo` topic with the same `correlationId`.
3. Requester subscribes to its `replyTo` topic filtered by `correlationId`; times out after `ttlMs`.

### 4.5 Backpressure & Flow Control

- Each agent exposes a `capacity` property (0.0–1.0) updated every 5 seconds.
- The Conductor reads capacity before dispatching; if a target agent reports capacity ≥ 0.9, the message is held in a local buffer for up to 10 seconds before re-attempting.
- If capacity remains ≥ 0.9 for > 30 seconds, the Conductor emits a `system.congestion` alert to the Monitor Agent.

---

## 5. Agent Registry Schema

The agent registry is the authoritative catalogue of all registered agents. It is stored in the `agent_registry` table in the CAIA SQLite database and kept in-memory by the Conductor.

```sql
CREATE TABLE IF NOT EXISTS agent_registry (
  agent_id          TEXT PRIMARY KEY,   -- e.g. 'embedder-01'
  agent_type        TEXT NOT NULL,      -- e.g. 'EmbedderAgent'
  tier              INTEGER NOT NULL,   -- 0–6
  status            TEXT NOT NULL DEFAULT 'stopped',
                                        -- 'starting' | 'ok' | 'degraded' | 'stopped' | 'error'
  version           TEXT NOT NULL,      -- semver e.g. '1.0.0'
  host              TEXT,               -- hostname or pod name
  port              INTEGER,            -- HTTP health port
  subscribed_topics TEXT NOT NULL,      -- JSON array of topic strings
  published_topics  TEXT NOT NULL,      -- JSON array of topic strings
  capabilities      TEXT NOT NULL,      -- JSON object of feature flags
  config_hash       TEXT,               -- SHA-256 of injected config
  last_heartbeat_at TEXT,               -- ISO 8601
  registered_at     TEXT NOT NULL,
  metadata          TEXT                -- JSON blob for agent-specific data
);
```

### 5.1 Example Registry Entries

```json
[
  {
    "agent_id": "conductor-01",
    "agent_type": "ConductorAgent",
    "tier": 0,
    "status": "ok",
    "version": "1.0.0",
    "subscribed_topics": ["system.ready", "document.indexed", "response.ready", "system.congestion"],
    "published_topics": ["ingest.document.received", "query.received"],
    "capabilities": { "orchestration": true, "routing": true }
  },
  {
    "agent_id": "embedder-01",
    "agent_type": "EmbedderAgent",
    "tier": 3,
    "status": "ok",
    "version": "1.0.0",
    "subscribed_topics": ["chunk.deduplicated", "chunk.classified"],
    "published_topics": ["chunk.embedded"],
    "capabilities": { "modelId": "text-embedding-3-small", "dimensions": 1536, "batchSize": 100 }
  },
  {
    "agent_id": "scaffolder-01",
    "agent_type": "ScaffolderAgent",
    "tier": 6,
    "status": "ok",
    "version": "1.0.0",
    "subscribed_topics": [],
    "published_topics": ["system.ready"],
    "capabilities": { "migration": true, "healthGate": true, "gracefulShutdown": true }
  }
]
```

---

## 6. All 25 Agents — I/O Interfaces

### Tier 0 — Orchestration

#### 6.1 Conductor Agent
- **Input:** `system.ready`, `document.indexed`, `response.ready`, `system.congestion`, external API requests
- **Output:** `ingest.document.received` (dispatch to ingestion), `query.received` (dispatch to serving), orchestration commands to individual agents
- **Key responsibilities:** Workflow state machine, capacity-aware routing, SLA enforcement

---

### Tier 1 — Ingestion

#### 6.2 Ingest Agent
- **Input:** HTTP multipart file uploads, S3/GCS event notifications, FTP drop triggers
- **Output:** `ingest.document.received` with raw document bytes + source metadata
- **Key responsibilities:** File type detection (MIME sniffing), virus scan trigger, initial metadata extraction (filename, size, source system)

#### 6.3 Scraper Agent
- **Input:** URL lists from Conductor, sitemap.xml feeds, RSS/Atom feeds
- **Output:** `ingest.document.received` with scraped HTML/text + URL provenance
- **Key responsibilities:** Politeness (robots.txt, crawl delay), JS rendering via headless browser, content extraction (readability algorithm)

#### 6.4 Connector Agent
- **Input:** Connector configuration messages from Conductor (Slack, SharePoint, Google Drive, Confluence, Salesforce, Jira, etc.)
- **Output:** `ingest.document.received` with document payload + connector source metadata
- **Key responsibilities:** OAuth token management, incremental sync (delta fetch), connector health monitoring, rate limit compliance

---

### Tier 2 — Processing

#### 6.5 Chunker Agent
- **Input:** `ingest.document.received`
- **Output:** `chunk.created` (one message per chunk)
- **Key responsibilities:** Semantic chunking (sentence boundary detection, heading-aware splitting), configurable chunk size (default 512 tokens, overlap 64), parent document ID propagation

#### 6.6 Classifier Agent
- **Input:** `chunk.created`
- **Output:** `chunk.classified` with domain taxonomy result
- **Key responsibilities:** Domain + subdomain classification, confidence scoring, multi-label classification for cross-domain content

#### 6.7 Dedup Agent
- **Input:** `chunk.classified`
- **Output:** `chunk.deduplicated` (action: commit/merge/review), `dedup.review.queued`
- **Key responsibilities:** Three-layer dedup funnel (L1 hash, L2 SimHash/MinHash, L3 semantic), decision matrix application, review queue management

#### 6.8 OCR Agent
- **Input:** `chunk.created` where chunk source is image/PDF-scan
- **Output:** `chunk.created` (re-emitted with extracted text replacing image bytes)
- **Key responsibilities:** Tesseract/cloud OCR integration, language detection, confidence filtering, image pre-processing (deskew, denoise)

#### 6.9 Normaliser Agent
- **Input:** `chunk.created`
- **Output:** `chunk.created` (re-emitted with normalised content)
- **Key responsibilities:** Unicode NFC normalisation, whitespace normalisation, language detection, character encoding correction, PII redaction (configurable)

---

### Tier 3 — Enrichment

#### 6.10 Embedder Agent
- **Input:** `chunk.deduplicated` (action: commit), `chunk.classified`
- **Output:** `chunk.embedded` with 1536-dim Float32Array embedding
- **Key responsibilities:** Batch embedding generation, model selection by domain, embedding cache (LRU), retry on rate limit

#### 6.11 Metadata Agent
- **Input:** `chunk.deduplicated`
- **Output:** `document.enriched` with structured metadata
- **Key responsibilities:** Author extraction, date parsing, document title inference, language tagging, reading-level scoring, word count, document structure detection (sections, tables, figures)

#### 6.12 Entity Extractor Agent
- **Input:** `chunk.deduplicated`
- **Output:** `document.enriched` with named entity annotations
- **Key responsibilities:** NER (persons, organisations, locations, dates, monetary values, legal citations), domain-specific entity types per taxonomy, entity normalisation and coreference resolution

#### 6.13 Summariser Agent
- **Input:** `document.enriched`
- **Output:** `document.enriched` (updated with summary fields)
- **Key responsibilities:** Abstractive summarisation (one-sentence, one-paragraph, executive summary variants), domain-prompt-guided summarisation for accuracy in technical domains

#### 6.14 Linker Agent
- **Input:** `chunk.embedded`
- **Output:** `document.enriched` with cross-document link candidates
- **Key responsibilities:** Citation detection, cross-reference resolution (document to document), external source linking (DOI, Westlaw, PubMed IDs), internal link graph construction

---

### Tier 4 — Knowledge

#### 6.15 Indexer Agent
- **Input:** `chunk.embedded`, `document.enriched`
- **Output:** `document.indexed`
- **Key responsibilities:** Write embeddings to sqlite-vec virtual table, write BM25 inverted index entries, update FTS5 full-text search index, maintain domain-partitioned indexes

#### 6.16 Knowledge Graph Agent
- **Input:** `document.enriched` (with entities + links)
- **Output:** Updated knowledge graph nodes and edges (internal event: `graph.updated`)
- **Key responsibilities:** Entity deduplication in graph, relationship inference, graph schema enforcement, Cypher-compatible query interface

#### 6.17 Archivist Agent
- **Input:** `document.indexed`
- **Output:** Archive confirmation events; tiered storage placement decisions
- **Key responsibilities:** Hot/warm/cold storage tiering based on access frequency, compression of cold documents, version history maintenance, GDPR/retention-policy enforcement (scheduled deletion)

---

### Tier 5 — Serving

#### 6.18 Query Agent
- **Input:** User query (text + optional filters from API/UI)
- **Output:** `query.received` with parsed query intent, domain filter, date range, provenance filter
- **Key responsibilities:** Query parsing and expansion, intent classification, filter extraction, query rewriting for retrieval optimisation

#### 6.19 Retrieval Agent
- **Input:** `query.received`
- **Output:** `retrieval.completed` with ranked list of chunk candidates (hybrid BM25 + vector)
- **Key responsibilities:** Hybrid retrieval (dense + sparse fusion via Reciprocal Rank Fusion), domain-scoped index selection, re-ranking (cross-encoder), result deduplication

#### 6.20 Synthesiser Agent
- **Input:** `retrieval.completed`
- **Output:** `response.ready` with generated answer
- **Key responsibilities:** Grounded answer generation (RAG), source attribution in generated text, hallucination mitigation (faithfulness checking against retrieved chunks), streaming response support

#### 6.21 Citation Agent
- **Input:** `retrieval.completed`, `response.ready`
- **Output:** Citation-annotated response with structured references
- **Key responsibilities:** In-text citation insertion, reference list formatting (APA, MLA, Bluebook, Vancouver styles), citation verification against retrieved source metadata

#### 6.22 Compliance Agent
- **Input:** `response.ready`
- **Output:** Compliance-cleared response or `compliance.blocked` event
- **Key responsibilities:** Domain-specific content filters (HIPAA, GDPR, legal privilege), output redaction, access-control enforcement (user → domain permissions), audit log emission for regulated responses

---

### Tier 6 — Infrastructure

#### 6.23 Monitor Agent
- **Input:** Heartbeat events from all agents, `system.health` polls, `ingest.document.failed` events, `system.congestion` alerts
- **Output:** Dashboard metrics (Prometheus format), alert events, `system.health` broadcast
- **Key responsibilities:** Latency/throughput/error-rate metrics per agent, alerting on SLA breach, dead-letter queue monitoring, resource utilisation tracking

#### 6.24 Scaffolder Agent
- **Input:** Boot environment (env vars, config file)
- **Output:** `system.ready`, populated agent registry, initialised channels
- **Key responsibilities:** See §3 for full design

#### 6.25 Audit Agent
- **Input:** `audit.event` from all agents
- **Output:** Immutable audit log (append-only JSONL), compliance reports
- **Key responsibilities:** Tamper-evident event logging, who-accessed-what-when tracking, data lineage recording, export for regulatory audit

---

## 7. Three Workflow Scenarios

### 7.1 Scenario A — Batch Document Ingestion

**Trigger:** An Operations administrator uploads a ZIP file of 500 legal contracts via the admin API.

```
1. [Ingest Agent]
   ← HTTP multipart upload (ZIP)
   → Extracts 500 files, emits 500x `ingest.document.received`

2. [Conductor Agent]
   ← 500x `ingest.document.received`
   → Checks Chunker capacity; batches into groups of 50; dispatches

3. [OCR Agent]  (parallel, for scanned PDFs only)
   ← `chunk.created` where mime=image/pdf-scan
   → Runs OCR; re-emits `chunk.created` with text content

4. [Normaliser Agent]  (parallel)
   ← `chunk.created`
   → Normalises text; re-emits `chunk.created`

5. [Chunker Agent]
   ← `ingest.document.received`
   → Splits each contract into semantic chunks (~8 chunks/doc = ~4000 chunks)
   → Emits 4000x `chunk.created`

6. [Classifier Agent]
   ← 4000x `chunk.created`
   → Classifies each: domain=legal, subdomain=contracts (confidence ~0.94)
   → Emits 4000x `chunk.classified`

7. [Dedup Agent]
   ← 4000x `chunk.classified`
   → L1: 12 exact duplicates found → auto-merged
   → L2: 3 near-duplicates flagged → human review queue
   → L3: 0 semantic duplicates above threshold
   → Emits 3985x `chunk.deduplicated` (action: commit)

8. [Embedder Agent]  (parallel)
   ← 3985x `chunk.deduplicated`
   → Generates 1536-dim embeddings in batches of 100
   → Emits 3985x `chunk.embedded`

9. [Metadata Agent], [Entity Extractor Agent], [Summariser Agent]  (parallel)
   ← `chunk.deduplicated`
   → Emits `document.enriched` events per document

10. [Linker Agent]
    ← `chunk.embedded`
    → Finds 47 cross-document citation links
    → Emits `document.enriched` with link graph updates

11. [Indexer Agent]
    ← `chunk.embedded` + `document.enriched`
    → Writes to sqlite-vec, BM25, FTS5 indexes
    → Emits 500x `document.indexed`

12. [Knowledge Graph Agent]
    ← `document.enriched`
    → Adds 1,240 entity nodes; 3,891 relationship edges

13. [Archivist Agent]
    ← `document.indexed`
    → Places all 500 documents in "hot" storage tier

14. [Conductor Agent]
    ← 500x `document.indexed`
    → Updates ingestion job status to COMPLETE; notifies administrator

15. [Audit Agent]  (continuous)
    ← `audit.event` from every step
    → Appends 8,247 audit log entries

Total pipeline latency (500 docs): ~4 min 30 sec (parallelised)
```

---

### 7.2 Scenario B — Real-Time Knowledge Query

**Trigger:** A legal analyst submits the query: *"What are the indemnification limits in our MSAs with cloud vendors signed after 2024?"*

```
1. [Query Agent]
   ← User query text + user_id + domain_context=legal
   → Parses intent: retrieval_type=clause_search
   → Extracts filters: domain=legal, subdomain=contracts, date_after=2024-01-01
   → Expands query: adds synonyms ["indemnification", "indemnity", "liability cap", "limitation of liability"]
   → Emits `query.received` with structured query + filter set

2. [Retrieval Agent]
   ← `query.received`
   → Dense retrieval: ANN search over legal/contracts index → top 40 chunks
   → Sparse retrieval: BM25 search with expanded terms → top 40 chunks
   → RRF fusion → top 20 candidates
   → Cross-encoder re-ranking → top 10 final chunks
   → Emits `retrieval.completed` with 10 ranked chunks

3. [Citation Agent]  (parallel with Synthesiser)
   ← `retrieval.completed`
   → Prepares structured citation metadata for each of the 10 chunks

4. [Synthesiser Agent]
   ← `retrieval.completed`
   → Generates grounded answer citing specific clause text from retrieved chunks
   → Faithfulness check: verifies all claims are attributable to retrieved context
   → Streams answer tokens to response buffer
   → Emits `response.ready`

5. [Compliance Agent]
   ← `response.ready`
   → Checks: user has `legal:read` permission ✓
   → Checks: no privileged communication markers in retrieved chunks ✓
   → Clears response; emits compliance-cleared `response.ready`

6. [Citation Agent]
   ← `response.ready` + citation metadata
   → Injects in-text citation markers [1], [2], …
   → Formats reference list in Bluebook style (legal domain default)
   → Emits final response with citations

7. [Conductor Agent]
   ← Final response
   → Returns to API caller; streams to analyst's UI

8. [Audit Agent]
   ← All `audit.event` messages from this chain
   → Records: who queried, what was retrieved, what was returned, compliance decision

Total query latency: ~1.8 seconds (P95)
```

---

### 7.3 Scenario C — Connector Sync (Confluence Integration)

**Trigger:** Scheduled daily sync of a Confluence space containing 3,200 pages.

```
1. [Conductor Agent]
   → Triggers Connector Agent with Confluence connector config (scheduled job)

2. [Connector Agent]
   ← Connector config (space key, OAuth token, last_sync_at cursor)
   → Calls Confluence API: GET /rest/api/content?spaceKey=ENG&lastModified>{cursor}
   → Finds 47 modified pages since last sync
   → Fetches full page content for 47 pages
   → Emits 47x `ingest.document.received` with Confluence metadata (page ID, author, version, labels)
   → Updates sync cursor to current timestamp

3. [Chunker Agent]
   ← 47x `ingest.document.received`
   → Splits Confluence pages (heading-aware chunking respecting Confluence macro boundaries)
   → Emits ~320x `chunk.created`

4. [Classifier Agent]
   ← 320x `chunk.created`
   → 280 chunks: domain=engineering (software, infrastructure)
   → 32 chunks: domain=product (prd, specs)
   → 8 chunks: domain=general
   → Emits 320x `chunk.classified`

5. [Dedup Agent]
   ← 320x `chunk.classified`
   → L1: 15 exact matches (pages re-saved without changes) → merged
   → L2: 8 near-duplicates (page version bumps with minor edits) → expert review
   → L3: 2 semantic near-duplicates (same content, different formatting) → expert review
   → Emits 295x `chunk.deduplicated` (action: commit)

6. [Embedder Agent], [Metadata Agent], [Entity Extractor Agent]  (parallel)
   ← 295x `chunk.deduplicated`
   → Full enrichment pipeline

7. [Indexer Agent]
   → Updates existing index entries for modified chunks (upsert by document_id + chunk_index)
   → Emits 47x `document.indexed`

8. [Archivist Agent]
   → Previous versions of modified documents moved to version history
   → New versions placed in hot storage

9. [Monitor Agent]
   → Records sync job metrics: 47 docs processed, 15 exact dedup, 10 expert review queued
   → No SLA breach detected

10. [Conductor Agent]
    ← 47x `document.indexed`
    → Marks Confluence sync job COMPLETE; schedules next run in 24 hours
    → Notifies any subscribed users of knowledge base update

Total sync latency (47 modified pages): ~45 seconds
```

---

## 8. Full Specifications — 10 Key Agents

### 8.1 Conductor Agent (Tier 0)

**Purpose:** Central orchestrator; owns workflow state machines and routes messages between tiers.

**Technology:** Node.js, TypeScript, in-memory state machine (XState v5)

**Input Interface:**
```typescript
interface ConductorInput {
  // External API
  ingestRequest: {
    sourceType: 'upload' | 'url' | 'connector';
    payload: Buffer | string | ConnectorConfig;
    requesterId: string;
    priority?: number;
  };
  queryRequest: {
    query: string;
    userId: string;
    domainFilter?: DomainKey[];
    dateRange?: { from?: string; to?: string };
  };
  // Internal events
  systemReady: SystemReadyEvent;
  documentIndexed: DocumentIndexedEvent;
  responseReady: ResponseReadyEvent;
  systemCongestion: CongestionEvent;
}
```

**Output Interface:**
```typescript
interface ConductorOutput {
  dispatchedMessages: CAIAMessage[];
  workflowStateUpdates: WorkflowState[];
  apiResponse: { jobId: string; status: string; estimatedCompletionMs?: number };
}
```

**SLAs:** Dispatch latency < 50 ms; workflow state persistence within 100 ms of event receipt.

**Failure handling:** Dead-letter queue for undeliverable dispatches; exponential backoff with 3 retries; Conductor emits `audit.event` on every retry.

---

### 8.2 Ingest Agent (Tier 1)

**Purpose:** First point of contact for all file-based document ingestion.

**Technology:** Node.js, Multer (file handling), file-type (MIME detection), ClamAV integration

**Input Interface:**
```typescript
interface IngestInput {
  source: 'http_upload' | 's3_event' | 'ftp_drop';
  files: Array<{
    buffer: Buffer;
    originalName: string;
    mimeType: string;
    sizeBytes: number;
  }>;
  sourceMetadata: {
    uploaderId: string;
    uploadedAt: string;
    bucketOrPath?: string;
  };
}
```

**Output Interface:**
```typescript
interface IngestOutput {
  topic: 'ingest.document.received';
  payload: {
    documentId: string;       // UUID v7
    rawContent: Buffer;
    mimeType: string;
    filename: string;
    sizeBytes: number;
    sourceSystem: string;
    sourceUrl?: string;
    provenanceTier: number;
    ingestedAt: string;
  };
}
```

**Throughput:** Up to 200 documents/sec (horizontal scaling).

**Failure handling:** Virus scan failure → quarantine queue; unsupported MIME type → `ingest.document.failed` with reason.

---

### 8.3 Chunker Agent (Tier 2)

**Purpose:** Splits raw documents into semantically coherent chunks for downstream processing.

**Technology:** Node.js, LangChain `RecursiveCharacterTextSplitter`, custom heading-aware splitter for HTML/Markdown/PDF

**Input Interface:**
```typescript
interface ChunkerInput {
  topic: 'ingest.document.received';
  payload: {
    documentId: string;
    rawContent: Buffer;
    mimeType: string;
    provenanceTier: number;
  };
}
```

**Output Interface:**
```typescript
interface ChunkerOutput {
  topic: 'chunk.created';
  payload: {
    chunkId: string;          // UUID v7
    documentId: string;       // Parent document ID
    chunkIndex: number;       // 0-based position
    totalChunks: number;
    content: string;          // Normalised plain text
    tokenCount: number;
    headingPath: string[];    // Breadcrumb of headings above this chunk
    pageNumbers?: number[];   // For PDF sources
    provenanceTier: number;
  };
}
```

**Configuration:**
- Default chunk size: 512 tokens (configurable 128–2048)
- Overlap: 64 tokens (configurable 0–256)
- Splitter strategy: `['heading', 'paragraph', 'sentence', 'word', 'character']` cascade

**Failure handling:** Documents that cannot be chunked (binary, corrupt) → `ingest.document.failed`.

---

### 8.4 Classifier Agent (Tier 2)

**Purpose:** Assigns domain taxonomy classification to each chunk.

**Technology:** Node.js, HTTP client to CAIA classifier microservice (internally backed by a fine-tuned text classification model)

**Input Interface:**
```typescript
interface ClassifierInput {
  topic: 'chunk.created';
  payload: {
    chunkId: string;
    documentId: string;
    content: string;
    headingPath: string[];
  };
}
```

**Output Interface:**
```typescript
interface ClassifierOutput {
  topic: 'chunk.classified';
  payload: {
    chunkId: string;
    documentId: string;
    content: string;
    classification: ClassificationResult;  // See §8 of taxonomy doc
    provenanceTier: number;
  };
}
```

**Performance:** Batch size 64 chunks per API call; P95 latency < 200 ms per batch; fallback to `general` domain if confidence < 0.5.

**Failure handling:** Classifier service unavailable → retry 3× with 1 s backoff; emit `chunk.classified` with `domain=general, confidence=0` after exhausted retries.

---

### 8.5 Dedup Agent (Tier 2)

**Purpose:** Runs the three-layer deduplication funnel (see dedup architecture document for full specification).

**Technology:** Node.js, better-sqlite3, sqlite-vec, custom MinHash/SimHash implementations

**Input Interface:**
```typescript
interface DedupInput {
  topic: 'chunk.classified';
  payload: {
    chunkId: string;
    documentId: string;
    content: string;
    classification: ClassificationResult;
    provenanceTier: number;
    embedding?: Float32Array;  // If pre-computed by an upstream embedder (optional fast path)
  };
}
```

**Output Interface:**
```typescript
interface DedupOutput {
  topic: 'chunk.deduplicated';
  payload: {
    chunkId: string;
    documentId: string;
    content: string;
    classification: ClassificationResult;
    provenanceTier: number;
    dedupResult: DedupResult;  // See caia-dedup TypeScript API
  };
}
```

**Throughput:** ~200 chunks/sec (L1+L2 only); ~20 chunks/sec (including L3 with ANN).

---

### 8.6 Embedder Agent (Tier 3)

**Purpose:** Generates dense vector embeddings for committed chunks.

**Technology:** Node.js, OpenAI `text-embedding-3-small` (default) or local `nomic-embed-text` (air-gapped deployments)

**Input Interface:**
```typescript
interface EmbedderInput {
  topic: 'chunk.deduplicated';
  payload: {
    chunkId: string;
    content: string;
    classification: ClassificationResult;
    provenanceTier: number;
  };
}
```

**Output Interface:**
```typescript
interface EmbedderOutput {
  topic: 'chunk.embedded';
  payload: {
    chunkId: string;
    documentId: string;
    embedding: Float32Array;   // 1536-dim
    modelId: string;
    embeddedAt: string;
  };
}
```

**Performance:** Batch size 100; rate limit aware (OpenAI: 1M tokens/min); LRU cache for repeated content (128 MB cache).

---

### 8.7 Retrieval Agent (Tier 5)

**Purpose:** Executes hybrid retrieval over the CAIA knowledge store in response to user queries.

**Technology:** Node.js, better-sqlite3, sqlite-vec (ANN), SQLite FTS5 (BM25), cross-encoder re-ranker

**Input Interface:**
```typescript
interface RetrievalInput {
  topic: 'query.received';
  payload: {
    queryId: string;
    queryText: string;
    queryEmbedding: Float32Array;
    expandedTerms: string[];
    domainFilter?: DomainKey[];
    provenanceTierMax?: number;
    dateAfter?: string;
    dateBefore?: string;
    topK?: number;            // Default: 10
    userId: string;
  };
}
```

**Output Interface:**
```typescript
interface RetrievalOutput {
  topic: 'retrieval.completed';
  payload: {
    queryId: string;
    candidates: Array<{
      chunkId: string;
      documentId: string;
      content: string;
      domain: DomainKey;
      subdomain: string;
      rrfScore: number;       // Reciprocal Rank Fusion score
      denseScore: number;     // Cosine similarity
      sparseScore: number;    // BM25 score
      rerankScore: number;    // Cross-encoder score
      provenanceTier: number;
      documentTitle: string;
      sourceUrl?: string;
      pageNumbers?: number[];
    }>;
    retrievalStats: {
      denseHits: number;
      sparseHits: number;
      fusedCount: number;
      rerankedCount: number;
      latencyMs: number;
    };
  };
}
```

**Performance:** P50 < 800 ms; P95 < 2 s; P99 < 5 s (over 1M vectors, 10M BM25 terms).

---

### 8.8 Synthesiser Agent (Tier 5)

**Purpose:** Generates grounded, attributed answers from retrieved context.

**Technology:** Node.js, Anthropic Claude API (`claude-sonnet-4-6`), streaming SSE to response buffer

**Input Interface:**
```typescript
interface SynthesiserInput {
  topic: 'retrieval.completed';
  payload: RetrievalOutput['payload'];
  originalQuery: string;
  domainContext: DomainKey;
  responseFormat: 'prose' | 'bullet_points' | 'table' | 'structured_json';
}
```

**Output Interface:**
```typescript
interface SynthesiserOutput {
  topic: 'response.ready';
  payload: {
    queryId: string;
    answer: string;
    answerFormat: string;
    faithfulnessScore: number;   // 0.0–1.0 (proportion of claims attributable to context)
    usedChunkIds: string[];      // Chunks actually cited in the answer
    generationModelId: string;
    inputTokens: number;
    outputTokens: number;
    latencyMs: number;
  };
}
```

**Faithfulness checking:** After generation, each claim in the answer is verified against the retrieved chunks using a lightweight entailment model; if faithfulness < 0.85, the answer is regenerated with a stricter prompt.

---

### 8.9 Compliance Agent (Tier 5)

**Purpose:** Enforces access control, domain-specific content policies, and regulatory compliance on all outgoing responses.

**Technology:** Node.js, rule engine (JSON-rules-engine), integration with CAIA RBAC service

**Input Interface:**
```typescript
interface ComplianceInput {
  topic: 'response.ready';
  payload: SynthesiserOutput['payload'];
  userId: string;
  userPermissions: string[];       // e.g. ['legal:read', 'finance:read']
  domainFilter: DomainKey[];
  retrievedChunkMetadata: Array<{
    chunkId: string;
    domain: DomainKey;
    hasPrivilegedMarker: boolean;
    retentionPolicy: string;
  }>;
}
```

**Output Interface:**
```typescript
interface ComplianceOutput {
  // On pass:
  topic: 'response.ready';       // Re-emitted with compliance metadata attached
  payload: {
    // All original Synthesiser fields plus:
    complianceCleared: true;
    complianceRules: string[];   // Rules evaluated
    redactedSections?: string[]; // Sections redacted (if any)
    auditReference: string;      // Audit log entry ID
  };
  // On block:
  // topic: 'compliance.blocked'
  // payload: { queryId, reason, blockedRules }
}
```

**Rules evaluated (examples):**
- User has `{domain}:read` permission for every domain in response
- No chunks with `hasPrivilegedMarker=true` included without `legal-privilege:read` permission
- HIPAA: PHI not returned to users without `hipaa_trained=true` attribute
- GDPR: Data subject information not returned for users in restricted regions

---

### 8.10 Monitor Agent (Tier 6)

**Purpose:** Platform-wide observability: metrics collection, alerting, and health broadcasting.

**Technology:** Node.js, prom-client (Prometheus metrics), Grafana-compatible dashboard spec

**Input Interface:**
```typescript
interface MonitorInput {
  // Continuous subscription to:
  heartbeatEvents: HeartbeatEvent[];          // topic: 'system.heartbeat'
  documentFailedEvents: DocumentFailedEvent[]; // topic: 'ingest.document.failed'
  congestionEvents: CongestionEvent[];         // topic: 'system.congestion'
  auditEvents: AuditEvent[];                   // topic: 'audit.event' (sampled 10%)
}
```

**Output Interface:**
```typescript
interface MonitorOutput {
  // Prometheus metrics endpoint (HTTP GET /metrics)
  metrics: {
    caia_documents_ingested_total: Counter;
    caia_documents_failed_total: Counter;
    caia_dedup_actions_total: Counter;        // labels: action, layer
    caia_query_latency_seconds: Histogram;
    caia_agent_capacity: Gauge;               // labels: agent_id
    caia_queue_depth: Gauge;                  // labels: topic
    caia_embedding_latency_seconds: Histogram;
  };
  // Broadcast health event every 30 seconds
  systemHealthBroadcast: {
    topic: 'system.health';
    payload: {
      timestamp: string;
      overallStatus: 'ok' | 'degraded' | 'critical';
      agentStatuses: Record<AgentId, 'ok' | 'degraded' | 'stopped' | 'error'>;
      queueDepths: Record<string, number>;
    };
  };
}
```

**Alerting rules:**
- Agent capacity > 0.9 for > 30 s → `WARNING: Agent congestion`
- `ingest.document.failed` rate > 5% over 5 min → `ERROR: Ingestion failure spike`
- Query P95 latency > 5 s over 10 min → `WARNING: Query SLA breach`
- Any agent heartbeat missing for > 60 s → `CRITICAL: Agent unresponsive`

---

## 9. Agent Registry Bootstrap Configuration

The following is the full `scaffolder.config.json` used to bootstrap all 25 agents:

```json
{
  "schemaVersion": "1.0",
  "agents": [
    { "agentType": "ConductorAgent",       "tier": 0, "instances": 1 },
    { "agentType": "IngestAgent",          "tier": 1, "instances": 1 },
    { "agentType": "ScraperAgent",         "tier": 1, "instances": 1 },
    { "agentType": "ConnectorAgent",       "tier": 1, "instances": 1 },
    { "agentType": "ChunkerAgent",         "tier": 2, "instances": 1 },
    { "agentType": "ClassifierAgent",      "tier": 2, "instances": 1 },
    { "agentType": "DedupAgent",           "tier": 2, "instances": 1 },
    { "agentType": "OCRAgent",             "tier": 2, "instances": 1 },
    { "agentType": "NormaliserAgent",      "tier": 2, "instances": 1 },
    { "agentType": "EmbedderAgent",        "tier": 3, "instances": 1 },
    { "agentType": "MetadataAgent",        "tier": 3, "instances": 1 },
    { "agentType": "EntityExtractorAgent", "tier": 3, "instances": 1 },
    { "agentType": "SummariserAgent",      "tier": 3, "instances": 1 },
    { "agentType": "LinkerAgent",          "tier": 3, "instances": 1 },
    { "agentType": "IndexerAgent",         "tier": 4, "instances": 1 },
    { "agentType": "KnowledgeGraphAgent",  "tier": 4, "instances": 1 },
    { "agentType": "ArchivistAgent",       "tier": 4, "instances": 1 },
    { "agentType": "QueryAgent",           "tier": 5, "instances": 1 },
    { "agentType": "RetrievalAgent",       "tier": 5, "instances": 1 },
    { "agentType": "SynthesiserAgent",     "tier": 5, "instances": 1 },
    { "agentType": "CitationAgent",        "tier": 5, "instances": 1 },
    { "agentType": "ComplianceAgent",      "tier": 5, "instances": 1 },
    { "agentType": "MonitorAgent",         "tier": 6, "instances": 1 },
    { "agentType": "ScaffolderAgent",      "tier": 6, "instances": 1 },
    { "agentType": "AuditAgent",           "tier": 6, "instances": 1 }
  ],
  "transport": {
    "type": "in-process",
    "redisUrl": null
  },
  "database": {
    "path": "./caia.db",
    "sqliteVecExtension": "./node_modules/sqlite-vec/sqlite-vec.so"
  }
}
```

---

## 10. Open Questions

1. **Horizontal scaling:** Which agents are stateless and can scale horizontally without coordination? (Candidates: Embedder, Classifier, Normaliser, OCR.) Stateful agents (Dedup, Indexer, Knowledge Graph) require leader-election or shard assignment.

2. **Agent versioning:** When a new version of an agent is deployed, how are in-flight messages handled? Is the old agent instance drained before shutdown, or do we allow concurrent old/new agent versions?

3. **Cross-agent transactions:** The Dedup → Indexer pipeline requires atomicity (a chunk should not be indexed if dedup fails). Should we implement a two-phase commit or accept eventual consistency with compensating events?

4. **Knowledge Graph Agent storage:** The current design uses SQLite for the KG. At what document scale should we migrate to a dedicated graph database (e.g. Apache AGE on Postgres, or Memgraph)?

5. **Synthesiser model selection:** Should the Synthesiser select different LLMs based on domain (e.g. a legal-fine-tuned model for `legal` domain queries)? What is the routing logic and fallback?

---

*End of CAIA Agent Team Architecture — v1.0*
