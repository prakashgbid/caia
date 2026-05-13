---
"@chiefaia/verifier": minor
---

feat(verifier-001): @chiefaia/verifier — fourth review-sibling (B15.D)

New private package `@chiefaia/verifier` ships the VERIFIER spawn — fourth
sibling alongside `@chiefaia/critic` (security/regression/cost — blocking),
`@chiefaia/code-reviewer` (correctness/style/types/tests — blocking), and
`@chiefaia/reviewer` (advisory craftsmanship). Authority:
`~/Documents/projects/agent-memory/reliability_99pct_design_2026-05-11.md`
§6.3.

**Public API**

```ts
runVerifier({ inputs, config }) -> Promise<VerifierRunOutcome>
// VerifierRunOutcome { ok, verdict, worktreeCleanedUp, cleanupReason, ... }
```

**Domain**

Acceptance-criteria-satisfaction (the spec-truth check). Independent of every
other sibling's domain — distinct severity lexicon
(`pass / fail-impl / fail-spec / uncertain`), distinct verdict structure
(per-AC + per-test + per-DoD-stage rows + an `overall` binary).

**Worktree isolation**

Every verifier run creates a FRESH `/tmp/verifier_<job_id>` git worktree
checked out at the implementor's PR head SHA. Cleanup runs via two layers:
agent-side try/finally (agent.ts) AND wrapper-script bash trap
(`bin/run-verifier.sh`). Idempotent; runs on success, exception, timeout,
SIGTERM.

**Routing semantics (per design §6.3.6)**

| Routing class       | Verdict use                                                     |
| ------------------- | --------------------------------------------------------------- |
| `autonomous-loop`   | BLOCKING — gates `nodes.status='done'` via SPS B15.D trigger.   |
| `operator-routed`   | ADVISORY — verdict logged + surfaced; operator decides on merge. |

**DB integration**

`infra/stolution/sps/migrations/2026-05-13_b15d_verifier_verdicts.sql`
adds the `verifier_verdicts` table and replaces `done_status_guard` with a
version that requires a row in that table with `overall='pass'` for every
autonomous-loop subtask done-transition. Companion to B15.B's existing
trigger (which checks `verifier_verdict_json` column-side); the two arms
fire defence-in-depth.

**Subscription-only**

Per `feedback_no_api_key_billing.md`, the verifier strips
`ANTHROPIC_API_KEY` from the spawn env at two layers (agent-side env scrub
+ wrapper-side `unset`). Auth flows through `CLAUDE_OAUTH_TOKEN` only.

**Tests**

- 11 vitest tests (positive/negative verdict capture, exception cleanup
  audit, schema validation, prompt rendering, routing class flip).
- 6 SQL trigger tests (`infra/stolution/sps/tests/test_b15d_verifier_verdicts.sh`)
  proving the trigger blocks fail-verdict + missing-verdict transitions and
  allows pass-verdict transitions, with AFTER-trigger side-effects intact.

**Out of scope** (deferred to follow-up atomics)

- Phase 2 deterministic detectors.
- `verifier_queue` reconciler in claude_spawner_agent.py (B15.G).
- Slot-manager `shadow_slot_id` reservation (design §6.3.3).
- Operator-applied cluster-DB step on stolution (operator-routed; this PR
  ships the schema-as-code surface only).
