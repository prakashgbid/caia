# Context Capsule — formal specification

**Track:** CAPSULE-FORMALIZE
**Source:** [`third-party-caia-paper-analysis-2026-04-29.md` §C.5](../../reports/third-party-caia-paper-analysis-2026-04-29.md) (citing paper §0.2 #3 + §2.2)
**Status:** specified, implemented v1
**Owner:** orchestrator + worker-coding

## What it is

The **Context Capsule** is the canonical, hashed projection of a ticket that
the orchestrator freezes at the moment it hands the ticket to a downstream
agent (the Coding Agent today; future agents tomorrow). It exists so a
downstream agent can detect drift — i.e. the upstream ticket changed
between freeze time and pickup time — rather than silently acting on
stale context.

The capsule is a six-slice projection of the ticket:

| Slice | Source field on `TicketTemplateV1` |
|---|---|
| `acceptance_tests` | `testCases[]` |
| `budget` | `{ maxOutputTokens: null, maxCostUsd: null }` (placeholder; populated by future SPEND-CAP track) |
| `contracts` | `agentSections` + `architecturalInstructions[]` |
| `file_allowlist` | sorted unique union of `dependencies.files` and `claims.files` |
| `spec_slice` | `version` + `scope` + `context` + `acceptanceCriteria` + `verificationPlan` |
| `tool_allowlist` | sorted unique union of `architecturalInstructions[*].techSubDomain` and `taxonomy.techSubDomains.all` |

The master capsule hash is `sha256(canonicalJSON({ acceptance_tests, budget, contracts, file_allowlist, spec_slice, tool_allowlist }))`.

`canonicalJSON` sorts every object's keys alphabetically at every depth,
preserves array order, omits `undefined` values, and serialises via
`JSON.stringify`. The same ticket — regardless of how its fields were
constructed in memory — always canonicalises to the same byte string,
and therefore always hashes to the same digest.

## Lifecycle

The orchestrator freezes the capsule at `bucket_placed -> ready_for_pickup`;
the worker verifies it as its first action on a claimed story.

**Freeze.** The Task Scheduler (`apps/orchestrator/src/agents/task-scheduler.ts`)
calls `freezePromptCapsules(promptId, db)` from `capsule-freezer.ts`. For
each story attached to the prompt, the freezer:

1. Loads the story.
2. Parses the ticket from `stories.agent_contributions_json`.
3. Calls `freezeCapsule(ticket)` from `@chiefaia/ticket-template`.
4. Persists the result in three places:
   - `stories.capsule_hash` (indexed)
   - `stories.capsule_frozen_at` (indexed)
   - `stories.capsule_version` ('v1' today)
   - Embeds the frozen fields back into `stories.agent_contributions_json` so the bundle endpoint serves a self-describing ticket.
5. Emits a `ticket.capsule-frozen` event with `status='frozen'`.

If the ticket cannot be parsed (empty / malformed / schema-invalid), the
freezer emits `ticket.capsule-frozen` with `status='skipped'` and the
appropriate reason. The advance to `ready_for_pickup` proceeds; the
worker will hit the missing-hash branch on first verify and escalate
via the standard blocker path.

**Verify.** When the Coding Agent claims a story, its first action is
`verifyBundleCapsule(bundle)` from `apps/worker-coding/src/capsule-verifier.ts`.
The verifier returns one of five outcomes:

| Outcome | Meaning | Worker action |
|---|---|---|
| `ok: true` | hash matches | proceed with implementation |
| `ok: false, reason: 'no-frozen-hash'` | the ticket was never frozen | escalate `capsule-drift` |
| `ok: false, reason: 'hash-mismatch'` | upstream re-edited post-freeze | escalate `capsule-drift` |
| `ok: false, reason: 'ticket-missing'` | bundle has no ticket | escalate (separate fault) |
| `ok: false, reason: 'ticket-malformed'` | ticket fails Zod | escalate (separate fault) |

In every `ok: false` case the worker calls `buildCapsuleDriftPayload`
to construct the blocker body and posts it to the orchestrator via the
existing blocker API; it then releases its worktree and marks itself
idle rather than coding against stale context.

## Why this matters

Today nothing prevents the BA Agent or EA Agent from re-running on a
story while the Coding Agent is mid-flight, because the orchestrator
does not coordinate exclusivity between the upstream and downstream
layers. Without the capsule, a BA re-run would silently mutate the
ticket's `agentSections.api.routes` and the Coding Agent would continue
against the original spec — shipping code that does not match the
*current* state of the ticket. With the capsule, this race is detected
and escalated.

The pattern is adopted from the third-party CAIA paper (paper §0.2 #3
+ §2.2): every task input is a deterministic, hashable JSON document;
the capsule is read-only at task start; it is fully reconstructible
from the ticket so a re-run is deterministic.

## Re-freeze semantics

`freezeCapsule()` is idempotent on identical content: same input gives the
same hash regardless of how many times you call it. But it is **not**
idempotent across content changes: each call computes a fresh hash from
the *current* ticket state. The legitimate use case for re-calling
freeze is when an upstream agent intentionally re-edits a ticket
post-freeze: the orchestrator (or an operator via the dashboard) calls
`freezePromptCapsules` again, the new hash is persisted, and the
worker's next verify will pass against the new hash.

## What this is NOT

- **Not** a security boundary. The hash detects drift, not tampering;
  an attacker with write access to `stories.capsule_hash` can re-pin
  the hash to whatever they want. Auth on that table is the security
  boundary.
- **Not** a replay-determinism guarantee. Two coding runs against the
  same capsule will not necessarily produce the same diff, because the
  Claude SDK is stochastic and the file system can change. The capsule
  is a *content* invariant, not an *outcome* invariant.
- **Not** a per-slice diff tool. v1 reports drift at master-hash
  granularity (`expected` vs `actual`); per-slice diff is a future
  enhancement that requires storing per-slice sub-hashes alongside
  the master hash.

## API reference

`@chiefaia/ticket-template`:

- `extractCapsule(ticket): CapsuleContent` — pure extraction; useful in tests + audit logs.
- `computeCapsuleHash(ticket): string` — pure hash; doesn't mutate.
- `freezeCapsule(ticket, options?): TicketWithCapsule` — pin hash + timestamp on the ticket.
- `verifyCapsule(ticket): CapsuleVerification` — recompute and compare.
- `canonicalize`, `canonicalJSON` — exposed for any consumer that wants to hash a non-ticket projection in the same way.

Orchestrator (`apps/orchestrator/src/agents/capsule-freezer.ts`):

- `freezeStoryCapsule(storyId, db, options?): FreezeStoryCapsuleResult`
- `freezePromptCapsules(promptId, db, options?): FreezeStoryCapsuleResult[]`

Worker-coding (`apps/worker-coding/src/capsule-verifier.ts`):

- `verifyBundleCapsule(bundle): CapsuleVerifyOutcome`
- `buildCapsuleDriftPayload(bundle, outcome): CapsuleDriftBlockerPayload`

## Migration

Migration `0037_story_capsule.sql` adds three columns to `stories`:

```sql
ALTER TABLE `stories` ADD COLUMN `capsule_hash` text;
ALTER TABLE `stories` ADD COLUMN `capsule_frozen_at` integer;
ALTER TABLE `stories` ADD COLUMN `capsule_version` text;

CREATE INDEX `story_capsule_hash_idx` ON `stories` (`capsule_hash`);
CREATE INDEX `story_capsule_frozen_at_idx` ON `stories` (`capsule_frozen_at`);
```

All three columns are nullable: legacy stories that pre-date this
migration carry `NULL` until they next round-trip through the
orchestrator. The schema's `superRefine` guard treats "all three NULL"
as the legitimate pre-capsule state and "any subset NULL" as an
integrity violation.

## Events

Two new entries in `packages/events-taxonomy-internal/registry.yaml`:

- `ticket.capsule-frozen` (info, actor: `task-scheduler`) — once per
  story at freeze. Payload: `storyId, promptId, status,
  capsuleHash, capsuleFrozenAt, capsuleVersion, reason`.
- `ticket.capsule-drift` (warning, actor: `worker-coding`) — once per
  drift escalation. Payload: `storyId, promptId, expectedHash,
  actualHash, reason, blockerId`.

## Future work

- Per-slice sub-hashes so drift reports identify which slice changed.
- Re-freeze API endpoint for operator-driven re-freeze without restarting the pipeline.
- Capsule lineage view on the dashboard (`/stories/[id]/journey`):
  show every freeze + every drift escalation as a timeline.
- `capsule_v2` shape that includes `requiredCapabilities[]` from the EA
  proposal §6.O Capability Hand-off (third-party paper analysis §F.2)
  once the broker integration lands.
