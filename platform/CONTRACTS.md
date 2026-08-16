# CAIA Kernel Contracts (Wave 1) — CANONICAL

**Status:** v0.1.0 — FROZEN for Wave 1. Changes require a PR approved by the Kernel Integration Coordinator.
**Authority:** STOL-1034 (Initiative) / STOL-1035 (Epic 1 — Kernel Wave 1).
**Scope:** The 8 Wave-1 control-plane components and every interface between them.

Every microfactory follows the same 5-part contract:
**Validated Inputs → bounded work → deterministic validation → versioned outputs → typed event.**
AI is probabilistic INSIDE a bounded box; everything AROUND the box (this document) is deterministic.

---

## 0. Kernel Integration Decisions (KID) — binding

| ID | Decision | Rationale |
|----|----------|-----------|
| KID-001 | **CP-03 Event Backbone = existing `stolution-kafka` (ADR-097). NOT Redpanda, NOT NATS.** CloudEvents 1.0 JSON envelope on every message. | [[stolution-reuse-doctrine]]; Kafka already live on s903; STOL-1035 scope table overrides the Redpanda mention in the epic title. |
| KID-002 | **`caia-factory-sdk` (Kernel-6) lands FIRST.** Its public API is frozen by §6 of this document; all other components implement adapters conforming to §6. Component agents may build in parallel against this spec without waiting for the package. | Every component is consumed *through* the SDK; freezing the interface removes the serial dependency. |
| KID-003 | Python **3.10** floor (server runs 3.10.12). Package name `caia-factory-sdk`, import name `caia_sdk`, published to a local wheel dir + installed editable from `packages/caia-factory-sdk` until an internal index exists. Pydantic v2 for all schemas. | Match server runtime; zero new infra. |
| KID-004 | **CP-06 Operational DB = existing PostgreSQL 16**, new schema `caia`. All kernel tables live in schema `caia.*`. No new PG instance. | Reuse; Wave 0 component. |
| KID-005 | **Kafka topics: exactly three for Wave 1** (§3.1). Partition key = `run_id`. No per-factory topics (141 factories would mean topic sprawl). | Ordering per run; operational simplicity. |
| KID-006 | **Temporal namespace `caia`**; one shared task queue `caia-core` for Wave 1. Per-stage queues deferred to Wave 2. | Simplicity first; queue split is a non-breaking change later. |
| KID-007 | **MinIO = existing `stolution-minio`**, new bucket `caia-artifacts`. Provenance rows in `caia.artifact_provenance` (§5). | Reuse. |
| KID-008 | **LiteLLM is the ONLY LLM egress.** OpenRouter free-tier models only ([[ci-cost-elimination-direction]]). Direct provider calls from factory code are a gate failure. | Cost governance; single audit point. |
| KID-009 | OTEL span/attr conventions in §9 are mandatory. Trace context propagates via Kafka headers (`traceparent`) and Temporal interceptors. | One trace per run, end to end. |
| KID-010 | Reference factory `SF-HELLO` (§10) is the Wave-1 acceptance instrument. Epic closes only when SF-HELLO runs end-to-end through CP-01/03/04/05/09/11/14/15. | Executable definition of done. |
| KID-011 | Every event type name is versioned (`…v1`). Breaking change = new version, old version kept until consumers migrate. Additive fields are non-breaking. | Contract evolution without flag days. |
| KID-012 | Deploys via docker compose under `caia-platform/services/<component>/`, containers named `caia-<component>`, attached to the existing `stolution` docker network. Grafana dashboards under folder "CAIA". | Consistent ops surface. |

---

## 1. Identifiers (used everywhere)

| Field | Type / format | Example |
|-------|---------------|---------|
| `run_id` | ULID string | `01J5AXR8Z3F9GQ0V6E7K8M9N1P` |
| `factory_id` | `SF-` + 2..3 chars | `SF-00`, `SF-HELLO` |
| `factory_version` | semver of the factory implementation | `0.1.0` |
| `vision_id` | ULID; root cause of the run (provenance chain terminus) | |
| `artifact_id` | UUIDv4 | |
| `event_id` | UUIDv4 (CloudEvents `id`) | |

---

## 2. CP-01 Temporal (Durable Workflow)

- **Deployment:** Temporal OSS self-hosted (`temporalio/auto-setup` image acceptable for Wave 1 — it is the upstream-supported single-node deployment, not a stopgap), Postgres 16 backend (schema owned by Temporal in a dedicated `temporal` database on the existing PG instance). Container `caia-temporal`, UI `caia-temporal-ui` (port 8080 internal; exposed via CF tunnel later).
- **Namespace:** `caia` (retention 30 days).
- **gRPC endpoint (canonical):** `caia-temporal:7233` on the stolution docker network; `localhost:7233` from host.
- **Model:** each microfactory execution = one **Activity**; pipelines/macro-stages = **Workflows**. Wave 1 ships one workflow type:
  - `FactoryRunWorkflow` — workflow id `run-{run_id}`, task queue `caia-core`.
    - Input: `RunRequest{run_id, factory_id, payload: dict, vision_id}`
    - Steps: `compile_context` → `execute_factory` → `run_gates` → `publish_outputs` (each an Activity).
    - Retry policy (default): initial 1s, backoff 2.0, max attempts 3, non-retryable: `GateFailure`, `PolicyDenied`.
- **SDK binding:** `caia_sdk.worker.serve(factories: list, task_queue="caia-core")` registers the Activities and runs a Temporal worker. Factory authors never touch the Temporal client directly.

## 3. CP-03 Kafka Event Backbone

### 3.1 Topics (Wave 1 — complete list)

| Topic | Purpose | Key | Retention |
|-------|---------|-----|-----------|
| `caia.factory.events.v1` | Every typed factory lifecycle/output event | `run_id` | 7 d |
| `caia.control.commands.v1` | Run requests, cancellations, kernel control | `run_id` | 7 d |
| `caia.audit.provenance.v1` | Immutable audit/provenance records (mirrors to CP-15) | `run_id` | compact + 30 d |

Config: 6 partitions each, replication 1 (single broker), `cleanup.policy=delete` (compact+delete for audit).

### 3.2 Envelope — CloudEvents 1.0 (JSON, structured mode)

```json
{
  "specversion": "1.0",
  "id": "<event_id uuid4>",
  "source": "/caia/{factory_id}",
  "type": "com.caia.factory.run.completed.v1",
  "time": "2026-08-16T12:00:00Z",
  "datacontenttype": "application/json",
  "subject": "{run_id}",
  "caiarunid": "{run_id}",
  "caiafactoryid": "{factory_id}",
  "caiafactoryversion": "0.1.0",
  "traceparent": "00-…",
  "data": { }
}
```

### 3.3 Wave-1 event types (`type` field)

- `com.caia.run.requested.v1` (control topic) — data: `RunRequest`
- `com.caia.factory.run.started.v1`
- `com.caia.factory.run.completed.v1` — data: `{outputs_artifact_id, output_schema, gate_results[]}`
- `com.caia.factory.run.failed.v1` — data: `{error_class, message, retryable}`
- `com.caia.gate.passed.v1` / `com.caia.gate.failed.v1` — data: `GateResult`
- `com.caia.artifact.stored.v1` — data: provenance row (§5.2)
- `com.caia.policy.denied.v1` — data: OPA decision (§4.2)

Factory-specific output events extend this set as `com.caia.sf<nn>.<name>.v1` and MUST carry the standard extension attributes.

## 4. CP-04 OPA Policy Engine

- **Deployment:** OPA server container `caia-opa` (port 8181, stolution network). Kyverno stays cluster-side for k8s admission; OPA is the application-level engine. Policies live in `caia-platform/policies/` as `.rego`, loaded via bundle mount; policy changes ship by git PR (no hot ad-hoc edits).
- **Package convention:** `caia.factories.<sf_id_lower>` (e.g. `caia.factories.sf_hello`), shared baseline in `caia.base`.
- **Decision endpoint (canonical):** `POST http://caia-opa:8181/v1/data/caia/decision`

### 4.1 Input document

```json
{
  "input": {
    "run_id": "…", "factory_id": "SF-HELLO", "factory_version": "0.1.0",
    "action": "execute | llm_call | store_artifact | emit_event",
    "payload_meta": {"schema": "…", "size_bytes": 123},
    "cost": {"estimated_usd": 0.0, "run_spent_usd": 0.0},
    "actor": "caia-worker"
  }
}
```

### 4.2 Decision document (result)

```json
{"allow": true, "deny_reasons": [], "obligations": {"max_tokens": 8000}}
```

`allow=false` → SDK raises `PolicyDenied` (non-retryable) and emits `com.caia.policy.denied.v1`.
Baseline `caia.base` policy (Wave 1): deny non-free models; deny `estimated_usd + run_spent_usd > 1.00` per run; deny artifact writes outside `caia-artifacts`.

## 5. CP-05 MinIO Artifact Store + Provenance

### 5.1 Object layout

- Bucket: `caia-artifacts` (versioning ON)
- Key: `runs/{run_id}/{factory_id}/{artifact_name}` — logical version = MinIO version id; `latest/` aliases are forbidden (provenance rows are the index).
- Endpoint: `http://stolution-minio:9000` (reuse existing creds via Vault `secret/stolution/prod/minio`).

### 5.2 Provenance table — `caia.artifact_provenance`

```sql
CREATE SCHEMA IF NOT EXISTS caia;
CREATE TABLE caia.artifact_provenance (
  artifact_id      uuid PRIMARY KEY,
  run_id           text NOT NULL,
  factory_id       text NOT NULL,
  factory_version  text NOT NULL,
  vision_id        text,
  uri              text NOT NULL,            -- s3://caia-artifacts/runs/…
  minio_version_id text,
  sha256           char(64) NOT NULL,
  media_type       text NOT NULL,
  size_bytes       bigint NOT NULL,
  cosign_signature text,                     -- CP-15, nullable until signer runs
  parent_artifact_ids uuid[] NOT NULL DEFAULT '{}',
  context_corpus_version text,               -- from context compiler (§8)
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON caia.artifact_provenance (run_id);
CREATE INDEX ON caia.artifact_provenance (factory_id, created_at);
```

Every `store_artifact` call writes the row and emits `com.caia.artifact.stored.v1` atomically (row first, event after; consumers treat the row as source of truth).

## 6. Kernel-6 `caia-factory-sdk` — the 5-part contract (LANDS FIRST)

Public API (frozen):

```python
from caia_sdk import microfactory, FactoryContext, gates
from pydantic import BaseModel

class HelloIn(BaseModel):  name: str
class HelloOut(BaseModel): greeting: str

@microfactory(
    id="SF-HELLO",
    version="0.1.0",
    inputs=HelloIn,                       # pydantic — validated BEFORE execution
    outputs=HelloOut,                     # pydantic — validated AFTER execution
    emits="com.caia.sfhello.greeted.v1",  # typed completion event
    gates=[gates.schema_valid, gates.policy(), gates.budget(max_usd=0.10)],
)
def hello(ctx: FactoryContext, inp: HelloIn) -> HelloOut:
    answer = ctx.llm(model="caia-fast", prompt=f"Greet {inp.name} in one short line.")
    ctx.store_artifact("greeting.txt", answer.text.encode(), media_type="text/plain")
    return HelloOut(greeting=answer.text)
```

`FactoryContext` (everything a factory may touch — nothing else):

| Member | Backs onto | Contract |
|--------|-----------|----------|
| `ctx.run_id`, `ctx.factory_id`, `ctx.vision_id` | — | read-only ids |
| `ctx.llm(model, prompt, *, system=None, max_tokens=None, json_schema=None) -> LLMResult{text, tokens_in, tokens_out, cost_usd, model}` | CP-09 §7 | policy-checked (`action=llm_call`) before call; usage recorded |
| `ctx.store_artifact(name, data: bytes, media_type, parents: list[UUID] = ()) -> UUID` | CP-05 §5 | policy-checked; provenance row + event |
| `ctx.load_artifact(artifact_id) -> bytes` | CP-05 | sha256 verified on read |
| `ctx.emit(type, data: dict)` | CP-03 §3 | extra domain events; envelope auto-filled |
| `ctx.context(purpose: str) -> CompiledContext` | §8 | compiled prompt context |
| `ctx.log` / `ctx.tracer` | CP-14 §9 | pre-attributed logger + tracer |

Gate interface (pytest-compatible plain callables):

```python
class GateResult(BaseModel):
    gate: str; passed: bool; details: str = ""; evidence_uri: str | None = None

GateFn = Callable[[FactoryContext, BaseModel], GateResult]   # (ctx, output) -> GateResult
```

Built-in gates (Wave 1): `gates.schema_valid`, `gates.policy()` (§4 with `action=execute`), `gates.budget(max_usd)`, `gates.artifact_signed` (CP-15, warn-only until Cosign lands). Adapters for reviewer-agent / live-verify-runner / chaos-harness are Wave-1 stubs behind the same `GateFn` signature.
Any gate failure ⇒ outputs are NOT published, `com.caia.gate.failed.v1` emitted, `GateFailure` raised (non-retryable).

Runner entrypoints:

```python
caia_sdk.worker.serve([hello])                       # Temporal worker, queue caia-core
caia_sdk.run_local(hello, HelloIn(name="CAIA"))      # same pipeline, in-process (no Temporal) — CI use
caia_sdk.submit(factory_id, payload: dict) -> run_id # producer → caia.control.commands.v1
```

`run_local` executes the identical 4 steps (context → execute → gates → publish) — it is the contract-conformance harness, not a mock path.

## 7. CP-09 LiteLLM Model Gateway

- Container `caia-litellm`, OpenAI-compatible base URL `http://caia-litellm:4000/v1`.
- **Model aliases (only these are callable):**

| Alias | Routes to (OpenRouter, free tier) |
|-------|------------------------------------|
| `caia-reasoner` | `openrouter/deepseek/deepseek-r1:free` |
| `caia-coder` | `openrouter/qwen/qwen-2.5-coder-32b-instruct:free` |
| `caia-fast` | `openrouter/meta-llama/llama-3.3-70b-instruct:free` |

- Required headers on every call (SDK injects): `x-caia-run-id`, `x-caia-factory-id`.
- Virtual key per factory id; LiteLLM budget = $0 hard cap on paid models (free-only allow-list), per-run soft budget enforced by OPA (§4) using LiteLLM spend logs.
- Spend/usage rows persisted by LiteLLM into Postgres schema `caia_litellm` (its own migrations).
- OpenRouter key from Vault `secret/stolution/prod/openrouter`.

## 8. Context Compiler

```python
class CompiledContext(BaseModel):
    system_prompt: str
    documents: list[str]          # retrieved/attached context blocks
    token_budget: int
    corpus_version: str           # content-hash of the source corpus

compile_context(run_id, factory_id, purpose: str) -> CompiledContext
```

- Wave 1 implementation: deterministic template + static per-factory context files under `caia-platform/context/<factory_id>/` (corpus_version = git tree hash of that dir). pgvector RAG is Wave 2 (CP-08) behind the same signature.
- `corpus_version` is recorded on every artifact row (§5.2) — same inputs + same corpus ⇒ reproducible context.

## 9. CP-14 OTEL Conventions

- Exporter: existing factory-otel collector (STOL-865) → Tempo/Loki/Prometheus. Service name: `caia-worker`.
- **Span names:** `caia.run` (workflow root) → `caia.context.compile`, `caia.sf.<id>.execute`, `caia.gate.<name>`, `caia.publish`.
- **Mandatory attributes:** `caia.run.id`, `caia.factory.id`, `caia.factory.version`, `caia.vision.id`, `caia.llm.model`, `caia.llm.tokens.in`, `caia.llm.tokens.out`, `caia.llm.cost.usd`, `caia.gates.passed`, `caia.gates.failed`, `caia.artifacts.count`.
- Propagation: W3C `traceparent` in Kafka headers AND CloudEvents extension; Temporal OTEL interceptor bridges workflow↔activity.
- **Metrics (Prometheus):** `caia_runs_total{factory_id,status}`, `caia_run_duration_seconds`, `caia_llm_cost_usd_total{factory_id,model}`, `caia_gate_failures_total{factory_id,gate}`.

## 10. CP-15 Audit / Provenance

- Structured audit log line (JSON) to Loki, label `job=caia-audit`, for every: run start/finish, policy decision, artifact write, gate result, LLM call. Shape = the CloudEvents envelope (§3.2).
- Kafka `caia.audit.provenance.v1` mirrors the same records for programmatic consumers.
- Cosign (keyless-off, key from Vault `secret/stolution/prod/cosign`) signs artifact sha256 digests; signature stored on the provenance row. Wave 1: signer is a small consumer of `com.caia.artifact.stored.v1`; `gates.artifact_signed` warn-only until it is live, then enforced.

## 11. SF-HELLO acceptance (Epic AC, executable)

`caia_sdk.submit("SF-HELLO", {"name": "CAIA"})` must produce, observably:
1. Temporal workflow `run-{run_id}` completed in namespace `caia`;
2. `com.caia.factory.run.started/completed.v1` + `com.caia.sfhello.greeted.v1` on `caia.factory.events.v1`;
3. one artifact in `caia-artifacts` + provenance row with sha256;
4. LiteLLM spend row for the run with a free model;
5. OPA decision logs showing `allow=true` for `execute` and `llm_call`;
6. one `caia.run` trace in Tempo/Grafana with mandatory attrs;
7. audit lines in Loki (`job=caia-audit`).
