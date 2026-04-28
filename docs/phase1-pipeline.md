# Phase 1 — Agent pipeline architecture

> **Status:** Gate 3 (Phase 1 of master sequencing) is complete and verified
> end-to-end. The pipeline captures every prompt, decomposes it into
> requirements + stories, enriches each story with cross-agent input,
> validates a strict ticket-template payload, and places the ticket into a
> bucket the executor can pick up.

The single executable spec is `apps/orchestrator/tests/phase1-e2e.test.ts`.
If that test passes, this document is accurate.

## Stages

```
prompt.received
    │
    │  (POST /prompts → write prompt row)
    ▼
ingested
    │
    │  (scaffolder fires — classifies request type, broadcasts context to
    │   activated agents, advances stage)
    ▼
scaffolded
    │
    │  (PO agent — classifier + decomposer; creates requirements and
    │   stories; emits `ticket.draft` per story; advances stage)
    ▼
po_decomposed
    │
    │  (BA agent — for each story:
    │   1. emits `ticket.ba-enriching`
    │   2. sends `input-requested` rows to N domain consultants
    │   3. consultants reply with their per-agent ticket-template section
    │   4. BA aggregates, builds a TicketTemplateV1 payload, validates,
    │      persists, emits `ticket.ba-complete`)
    ▼
ba_enriched
    │
    │  (Task Scheduler — places stories into task_buckets:
    │   • sequential-per-domain when an upstream lives in a different domain
    │   • parallel bucket otherwise
    │  Emits `task-scheduler.bucket-placed` per story and
    │  `ticket.ready-for-pickup` once the placement is recorded.)
    ▼
bucket_placed
    │
    ▼
ready_for_pickup
```

Every transition writes a row to `prompt_pipeline_stages`, mirrors the
stage onto `prompts.status`, and emits `pipeline.stage.advanced` so the
dashboard and the E2E test can observe a single source of truth.

## Data model

| Table | Purpose | Migration |
|------|------|------|
| `prompts` | One row per ad-hoc prompt; `status` mirrors the latest pipeline stage. | 0010 |
| `prompt_pipeline_stages` | Append-only log of every stage transition (`durationMs` is back-filled when the next stage advances). | 0015 |
| `requirements` | One row per epic produced by the PO agent. | 0000 |
| `stories` | One row per story (the unit the BA enriches and the executor consumes). New columns introduced for Phase 1: `agent_contributions_json`, `bucket_id`, `template_version`, `template_validation_status`, `template_validation_errors`. | 0021 |
| `task_buckets` | Scheduling buckets (sequential-per-domain or parallel) scoped per prompt. | 0021 |
| `agent_messages` | Inter-agent message log; the BA collaboration protocol uses it as a request/response store via `expected_reply_by`, `replied_at`, `parent_message_id`. | 0017 + 0022 |
| `entity_labels` | Multi-axis tags (domain / nature / complexity / layer) attached to prompts and stories. | 0019 |
| `events` | Canonical event store; every named pipeline event is persisted here for replay. | 0008 |

## Ticket template (`@chiefaia/ticket-template`)

`TicketTemplateV1` is a Zod schema with five required sections (`scope`,
`context`, `acceptanceCriteria`, `verificationPlan`, `dependencies`),
optional per-agent sections (`architecture`, `database`, `api`, `ui`,
`security`, `testing`, `release`, `observability`), `baEnrichment`
metadata, and audit fields. Acceptance-criteria count is bounded
`[3, 10]`. Strict mode rejects unknown keys.

The validator returns flat field-level errors so consumers (route
handlers, agents, the dashboard) surface them uniformly.

## Cross-agent collaboration

`apps/orchestrator/src/agents/agent-collab.ts` exposes the protocol
primitives:

- `sendInputRequest({ from, to, correlationId, expectedReplyBy, payload })` — insert an `input-requested` row, fire `ba-agent.input-requested`.
- `replyToRequest({ requestMessageId, fromAgent, payload })` — write an `input-received` row whose `parent_message_id` points back, mark request `replied`.
- `awaitReplies(correlationId, expectedAgents, timeoutMs)` — poll the DB until every consultant replies; flip stragglers to `timed_out`. Injectable `now` and `sleep` keep tests deterministic.

Domain consultants for which no async runtime exists are synthesised
inline by `apps/orchestrator/src/agents/domain-responders.ts`. When LLM-
backed agents come online they subscribe to `ba-agent.input-requested`
and call `replyToRequest()` themselves — the protocol stays the same.

## Bucket placement

`apps/orchestrator/src/agents/bucket-placer.ts` decides bucket placement
per the directive:

- Read primary domain from `entity_labels` (label_type = `domain`,
  highest-confidence wins). Fall back to `stories.domain_slugs_json`,
  then `'general'`.
- A story whose dependency graph touches a different primary domain
  goes to a sequential bucket for **its own** primary domain.
  Otherwise it goes to the prompt's parallel bucket.
- Sequential buckets are topologically sorted (Kahn) to set
  `positionInBucket`.
- Idempotent: re-running for the same prompt re-uses existing buckets.

## Self-contained ticket bundle

`GET /stories/:id/bundle` (route in
`apps/orchestrator/src/api/routes/stories.ts`, assembler in
`apps/orchestrator/src/api/ticket-bundle.ts`) returns:

- the story row + template metadata
- the parsed `TicketTemplateV1` (or `null` + `ticketParseError` if the
  payload is malformed)
- linked prompt + requirement + bucket rows
- the entity-label set
- upstream and downstream story id lists

The executor only needs this single endpoint to pick up a story.

## Event taxonomy (Phase 1 additions)

| Event | Actor | Where |
|---|---|---|
| `prompt.ingested` | api | route handler |
| `scaffolder.team.assembled` | scaffolder | scaffolder.ts |
| `po-agent.decomposition.complete` | po-agent | po-agent.ts |
| `ba-agent.input-requested` | ba-agent | agent-collab.ts |
| `ba-agent.input-received` | ba-agent | agent-collab.ts |
| `ba-agent.enrichment.complete` | ba-agent | ba-agent.ts |
| `task-scheduler.bucket-placed` | task-scheduler | bucket-placer.ts |
| `task-scheduler.scheduling.complete` | task-scheduler | task-scheduler.ts |
| `ticket.draft` | po-agent | po-agent.ts |
| `ticket.po-decomposed` | po-agent | po-agent.ts |
| `ticket.ba-enriching` | ba-agent | ba-agent.ts |
| `ticket.ba-complete` | ba-agent | ba-agent.ts |
| `ticket.ready-for-pickup` | task-scheduler | task-scheduler.ts |
| `pipeline.stage.advanced` | system | pipeline-stages.ts |

Every event carries the prompt-level `correlation_id` (or, for per-story
collaboration rounds, a sub-correlation `${correlationId}::${storyId}`).

## Running the verification gate

```sh
pnpm --filter @caia-app/core exec jest \
  --roots='<rootDir>/tests' \
  --testPathPattern='phase1-e2e' \
  --no-coverage
```

The full Phase-1 sweep (E2E + every supporting suite) runs as:

```sh
pnpm --filter @caia-app/core exec jest \
  --roots='<rootDir>/tests' \
  --testPathPattern='phase1-e2e|pipeline-stages|ticket-bundle|bucket-placer|task-buckets-ticket-template|agent-collab|ba-agent|db/' \
  --no-coverage
```

CI runs the orchestrator typecheck, the workspace builds, all package
tests, and the secret-detection gate on every PR.
