# @chiefaia/verifier — Design

## Why a fourth sibling

Today (Critic + Code-Reviewer + Reviewer) covers **code-quality** dimensions
— security, correctness, style, craftsmanship. None of them ask "did the
implementor actually satisfy the acceptance criteria the spec listed?" The
forensic audit that motivated B15
(`completion_audit_report_2026-05-10.md`) found 41 nodes whose `status='done'`
flag was untrue: the implementor self-claimed completion but the AC
behaviour wasn't in the diff. That's the gap the VERIFIER closes.

## Disjoint-by-construction with the other three

Per `feedback_critic_agent_two_tier_detector_pattern.md`, sibling agents
must have **distinct severity lexicon, distinct domain, denylist of
sibling categories**. The verifier:

| Dimension         | Critic / Code-Reviewer / Reviewer | Verifier                                        |
| ----------------- | --------------------------------- | ----------------------------------------------- |
| Severity lexicon  | `critical / high / medium / low`  | `pass / fail-impl / fail-spec / uncertain`      |
| Verdict structure | findings list                     | verdict object + per-AC + per-test + per-stage  |
| Source of truth   | the diff                          | the diff **vs** the spec's acceptance criteria  |
| Domain            | code quality                      | spec satisfaction                               |

The verifier's category set (`acceptance_criteria_verdicts`,
`tests_required_verdicts`, `dod_stages_verdicts`) is disjoint from every
sibling's category enum. No cross-finding leakage by construction.

## Worktree isolation rationale

Per the design doc §6.3.3, the verifier MUST run in a **different worktree
than the implementing spawn** so its judgment is unbiased by:
- the implementor's working files (uncommitted state),
- any process-state the implementor left behind (env vars, tmp files),
- `git diff` against an artificially-quiet base.

A fresh `/tmp/verifier_<job_id>` checkout off the merged commit gives the
verifier exactly the post-merge state — what every downstream consumer
will see.

## Cleanup contract

Two cleanup layers stack:

1. **Agent-side** (`worktree.ts`): every `verify()` call uses try/finally;
   on exception, timeout, or successful completion the worktree handle's
   `cleanup()` runs before the function returns. Idempotent.
2. **Wrapper-side** (`bin/run-verifier.sh`): bash `trap cleanup EXIT INT
   TERM HUP` removes the worktree even if the node process is SIGKILLed
   mid-spawn (the trap doesn't fire on SIGKILL, but it does fire on every
   SIGTERM/timeout path the spawner uses).

If both layers somehow fail (e.g. the host crashes before either fires),
the **spawner-side reaper** (claude_spawner_agent.py's
`reap_worktrees_at_startup`, see `WORKTREE_LOCK_FILE` constants) sweeps
stale `/tmp/verifier_*` dirs at next process startup. Three layers of
defence.

## Budget contract

- 15-minute hard wall-clock (matches every other spawn type).
- One `claude --print` invocation only — the verifier does NOT recurse
  (no nested verifier on the verifier; that would be unbounded recursion
  with no termination signal).
- Subscription-only; `ANTHROPIC_API_KEY` is stripped from the spawn env.

## Phase 1 scope

This phase ships:
- The TypeScript agent + CLI + bash wrapper.
- The verdict JSON schema + validator.
- The prompt template + builder.
- The DB migration that gates `nodes.status='done'` on the verdict.
- A common review-sibling dispatcher script.
- The `.github/workflows/verifier.yml` workflow alongside the other 3.

Out of scope (deferred):
- Deterministic detectors (Phase 2 — once LLM-tier signal quality is
  validated, mirroring the Critic / Code-Reviewer Phase 1 → Phase 2 path).
- Full `verifier_queue` reconciler in claude_spawner_agent.py (B15.G);
  this phase wires the verdict consumer (the trigger) but the queue is
  a separate atomic.
- The slot-manager `shadow_slot_id` reservation (design §6.3.3) — that's
  a slot-manager change, not a verifier-package change.
