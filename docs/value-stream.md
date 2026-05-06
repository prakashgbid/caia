# Value Stream

> **Source**: distilled from `caia-enterprise-architecture-comprehensive-2026-05-06.md` §3.1.4.
> **Maintenance**: stable; revised when major pipeline stages shipped/refactored.

CAIA's primary value stream is **prompt → spec → design → code → test → deploy → operate → improve**. This is the canonical flow from operator intent to platform-improvement compounding. Every capability in the [capability map](capability-map.md) lands somewhere on this stream.

## The stream (text diagram)

```
prompt
  │
  ▼
ingested ──────────► (Scaffolder)
  │
  ▼
decomposed ────────► (PO Agent — multi-bucket scheduling per BUCKET-001..009)
  │
  ▼
enriched ──────────► (BA Agent — cross-agent collab, ACR contracts)
  │
  ▼
architected ───────► (EA Agent — Architecture Registry consultation, ARCH-006)
  │
  ▼
validated ─────────► (Story Validator — composed-template rubric)
  │
  ▼
test-designed ─────► (Test-Design Agent — test_cases generation)
  │
  ▼
scheduled ─────────► (Task Manager — ready-pool + claims)
  │
  ▼
coded ─────────────► (Coding Agent — claude-binary spawn OR Aider; PR opened)
  │
  ▼
tested ────────────► (Fix-It Test Agent — max 6 retries)
  │
  ▼
gate-passed ───────► (Evidence Gate — 6 required contexts green; ADR-011)
  │
  ▼
merged-to-develop ─► (gh pr merge --squash via Git Flow; ADR-015)
  │
  ▼
released ──────────► (release/<date> PR develop → main, weekly)
  │
  ▼
deployed ──────────► (LaunchAgent for sites OR pm2 restart for daemons)
  │
  ▼
observed ──────────► (Langfuse + OTel + Loki + Pulse)
  │
  ▼
incidents-captured ► (Mentor)
  │
  ▼
opportunities-found► (Curator)
  │
  ▼
knowledge-indexed ─► (Librarian)
  │
  ▼
adapter-trained ───► (Apprentice; weekly LoRA retrain)
  │
  ▼
quality-compounds ─► (next prompt benefits from accumulated learning)
```

## Stage commentary

| Stage | Owner | Output | Where it gates |
|---|---|---|---|
| **prompt** | Operator (Cowork chat) | Free-form intent | Scaffolder ingests; if ambiguous, requires clarification |
| **ingested** | Scaffolder | Structured prompt entry | Stored to Postgres `prompts` table |
| **decomposed** | PO Agent + recursive decomposer | Stories with bucket tags | If ambiguous, BA Agent triggers clarifying loop |
| **enriched** | BA Agent | Story + acceptance criteria + dependencies | ACR validates contracts |
| **architected** | EA Agent | Architectural instructions | AKG consulted; design must reference precedent |
| **validated** | Story Validator | Composed-template rubric pass | If fail, re-route to BA / EA |
| **test-designed** | Test-Design Agent | `test_cases` rows in DB | Tests precede implementation (per testing framework directive) |
| **scheduled** | Task Manager | Ready-pool + claim | Multi-bucket scheduling chooses next task |
| **coded** | Coding Agent (claude binary or Aider) | PR opened | PR carries trace ID; capability ledger entries created |
| **tested** | Fix-It Test Agent | All tests green (max 6 retry passes) | If fail, agent posts diagnosis to PR; orchestrator decides retry/abandon |
| **gate-passed** | Evidence Gate | 6 required contexts green (ADR-011) | Doc-only carve-out skips bundle/visual/axe/lighthouse |
| **merged-to-develop** | gh CLI (squash) | Commit on develop; branch deleted | Git Flow conformance enforced (ADR-015) |
| **released** | Weekly release/* PR | Develop → main merge | Operator gates release window |
| **deployed** | LaunchAgent / pm2 / direct | Production code running | Steward Phase 2 will add local preview deploys |
| **observed** | Langfuse + OTel + Loki + Pulse | Traces, logs, metrics, health | Lantern Phase 1 adds SLO + burn-rate alerting |
| **incidents-captured** | Mentor | 18-category incident events | Pre-spawn lesson injection feeds back |
| **opportunities-found** | Curator | Daily digest with opportunity-tagged proposals | Some auto-PR through Evidence Gate; some operator-review |
| **knowledge-indexed** | Librarian | sqlite-vec + (future) Mem0 + AKG entries | Pre-spawn precedent retrieval feeds back |
| **adapter-trained** | Apprentice (weekly cron, Sat 02:00 local) | LoRA adapter | Promptfoo eval gates promotion shadow → canary → full |
| **quality-compounds** | Next prompt | Higher-quality first response | Win-rate measurable on canonical eval suite |

## Where this stream is gating today

| Stage | Gap | Slot |
|---|---|---|
| coded | Aider pilot integration (4.2x token efficiency vs claude binary) | Wave 2 |
| observed | No formal SLO catalogue | Quick win — `slos.md` |
| observed | No burn-rate alerting | Lantern Phase 1 |
| adapter-trained | Apprentice not yet trained | Master sequencing item 6 |
| quality-compounds | No canonical eval suite | Wave 1 (Promptfoo) |

## Per-stage SLO targets (initial)

The initial SLO catalogue formalises throughput + latency targets at key stages. See [`slos.md`](slos.md). Brief preview:

- Pipeline cycle time (prompt → merged): p95 ≤ 1 day for small features
- Evidence Gate run time: p95 ≤ 5 minutes
- Executor task pickup: p95 ≤ 10 seconds
- MCP transport: p99 ≤ 30 seconds
- Spend-guard pause-state propagation: ≤ 1 second

## See also

- [`business-architecture.md`](business-architecture.md) — mission, KPIs
- [`capability-map.md`](capability-map.md) — full capability list
- [`slos.md`](slos.md) — per-stage SLO targets
- [`adr/ADR-011-evidence-gate.md`](adr/ADR-011-evidence-gate.md) — pre-merge gate
- [`adr/ADR-015-git-flow-enforcement.md`](adr/ADR-015-git-flow-enforcement.md) — branching discipline
- `agent/memory/master_backlog_sequencing_2026-05-05.md` — definition of done with 10 stages
