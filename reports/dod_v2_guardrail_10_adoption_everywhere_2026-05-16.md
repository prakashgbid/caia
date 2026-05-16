---
title: DoD v2 — Guardrail #10 addendum, the adoption-everywhere gate
date: 2026-05-16
status: PROPOSED — for operator review; addendum to definition_of_done_v2_2026-05-14.md
extends: reports/definition_of_done_v2_2026-05-14.md
companion: agent-memory/decisions/p3_adoption_enforcement_substrate_2026_05_16.md (the substrate that implements this gate)
---

# Guardrail #10 — adoption-everywhere gate

This addendum extends `definition_of_done_v2_2026-05-14.md` with a tenth mechanical guardrail. The original DoD v2 closed the loop on **merged → deployed → consumed** via Guardrails 7/8/9. The recurring failure mode that motivates Guardrail #10 — visible in `caia/docs/DORMANT_PACKAGES.md` showing 41 of 73 packages dormant (~56%) — is the next layer beyond that loop: **a utility can be deployed and have its single intended consumer wired, yet the rest of the codebase continues to re-implement the same functionality at every site that should adopt it.**

The 9-guardrail DoD v2 catches "shipped but not deployed" (G7) and "deployed but no consumer" (G8) and "your PR duplicates existing code" (G9, advisory). It does not catch "your shared utility merged successfully, but every other call-site that should now use it still rolls its own implementation."

Guardrail #10 closes that gap.

## §1. The rule

```
G10. ADOPTION-EVERYWHERE GATE — refuse `caia-chain mark-done` for any
chain whose deliverable is a new utility/package/function until either:
  (a) every adoption opportunity in ~/.caia/adoption/ledger.jsonl for this
      deliverable is in state in {merged, deferred}; OR
  (b) the chain's mark-done invocation passes --adoption-pending-ok with
      a documented reason captured in the audit jsonl.
```

The unit of enforcement is the **adoption opportunity** — a tuple `(target_utility, target_export, call_site_file, call_site_line)`. The Adoption Enforcement Substrate (`agent-memory/decisions/p3_adoption_enforcement_substrate_2026_05_16.md`) produces opportunities and tracks their lifecycle:

```
discovered -> proposed -> opened -> verifying -> verified -> merged | failed | deferred | dropped
```

For a chain's deliverable, the gate consults the ledger:
- All opportunities in state `merged` or `deferred` -> gate passes.
- Any opportunity in `discovered`, `proposed`, `opened`, `verifying`, `failed`, `dropped` -> gate refuses.
- The gate also refuses if any opportunity has been in `opened` for > 14 days without progression (stuck PRs are not "done").

## §2. Where it lives

Two integration points, mirroring Guardrail #2's existing pattern (`gate-mark-done.sh` refuses mark-done with open PR):

| Surface | File | Behavior |
|---|---|---|
| Programmatic | `packages/chain-runner/src/gates/adoption-everywhere.ts` | `checkAdoptionGate(chainId): { ok, blockers[] }`. Called by `caia-chain mark-done`. Exits non-zero on `!ok` unless `--adoption-pending-ok` passed. |
| Shell | `scripts/gate-mark-done.sh` | Appends a final step `caia-adopt gate-check --chain "$CHAIN_ID"` (similar shape to the existing post-merge sweep). |
| Audit | `~/.caia/chain/<chain>/audit.jsonl` | Emits `{event: "adoption_gate_check", result: pass|fail|override, blocking_opportunities: [id, ...]}` on every invocation. |

Both surfaces consult the same source of truth: `~/.caia/adoption/ledger.jsonl`. The ledger is the substrate's output (see substrate design §5.4).

## §3. Escape hatches (both logged, neither silent)

### §3.a Per-site deferral file

A new file `caia/docs/adoption-deferrals.md` records explicit "do-not-adopt" decisions:

```markdown
# Adoption deferrals

This file documents call-sites that deliberately do not adopt
a shared utility, with the reason. The Adoption Enforcement Substrate
respects these rows and excludes them from the gate.

| Target utility | Call-site | Reason | Decided by | Date |
|---|---|---|---|---|
| @chiefaia/hmac-auth | apps/<x>/script.ts:42 | One-off bootstrap script; never enters runtime | operator | 2026-05-16 |
```

A PR adding deferral rows is itself peer-reviewable. The file is committed; the decision history *is* the diff history.

### §3.b Per-chain audit override

`caia-chain mark-done --adoption-pending-ok --reason "explanation"` captures the override into the chain's `audit.jsonl`:

```json
{"event":"adoption_gate_override","reason":"...","blockers":[...],"ts":"..."}
```

Used sparingly — visible in any subsequent retro. The override does **not** silently mark the opportunities as merged; they remain in their actual state and continue to surface in future scans.

## §4. Classification — when Guardrail #10 fires

The gate applies based on the chain's deliverable type (mirrors DoD v2 §5):

| Deliverable type | G10 fires? |
|---|---|
| New top-level export in `packages/*/src/index.ts` | Yes |
| New `packages/<name>/` directory | Yes (full export surface) |
| Bug-fix in existing utility *that changes observable behavior* | Yes (re-validates existing call-sites) — *deferred to substrate v2; v1 ignores* |
| Bug-fix that fixes an internal-only bug with no surface change | No |
| Docs only / changeset only / agent-memory only | No |
| Infra change (plist, K8s manifest, cron) | No — G7 handles |
| App-only change (`apps/<x>/**`) | No — apps consume, they don't produce reusable utilities |

The classifier is the same single piece of judgement DoD v2 §5 already requires; G10 just adds the rows.

## §5. Interaction with Guardrails 7-9

| # | Layer | What it catches | When G10 fires alongside |
|---|---|---|---|
| 7 | deployed | Merged but deployment surface not refreshed | G10 *after* G7 (must be deployed before adoption matters) |
| 8 | consumed | Deployed but no consumer >= 7 days | G10 is upstream of G8 — adoption PRs *create* the consumers G8 measures |
| 9 | reviewer-advisory | New code duplicates existing utility (per-PR advisory comment) | G10 is the active follow-through — if G9 flagged a duplicate, the substrate proposes the adoption PR, G10 refuses mark-done until that PR lands or is deferred |
| **10** | **adoption-everywhere** | **Utility shipped -> not adopted at applicable sites across the rest of the codebase** | — |

G10 is the *next link in the chain* — G9's hint becomes G10's enforcement.

## §6. Effort to stand G10 up

Per the substrate design §11, the gate is one of five chains:

- `p3-dod-v2-adoption-gate` chain — 3 phases, ~6-8 h Claude-time. Builds:
  - `packages/chain-runner/src/gates/adoption-everywhere.ts` (gate logic).
  - `scripts/gate-mark-done.sh` extension (one new step).
  - `caia/docs/adoption-deferrals.md` (initial empty template).
  - This addendum file (already shipped as this PR).
  - The corresponding DoD v2 §4 table row.

The gate **cannot enforce** until the substrate's other layers (scan, xref, generate, verify) populate the ledger. Until then, G10 is a no-op (the ledger is empty -> no blockers -> gate trivially passes). This is intentional — the gate ships first, the population sources land incrementally, and operator visibility into "no adoptions surfaced this week" is itself useful signal.

## §7. Update to DoD v2 §4 table

Replace the existing 9-row table with:

| # | Guardrail | DoD layer | Status |
|---|---|---|---|
| 1 | `caia-pr-merge-or-fail` | merged | live |
| 2 | `gate-mark-done.sh` (refuses mark-done with open PR) | merged | live |
| 3 | `pr-drainer-hourly` | merged | live |
| 4 | `caia-pr-create-safe` | merged | live |
| 5 | Post-merge sweep | merged | live |
| 6 | `hygiene-audit-daily` (+plist-drift) | infra | live |
| 7 | `post-merge-deployment-gate` (post-merge-signal pipeline) | deployed | live (PR #452) |
| 8 | `consumption-probe-daily` | consumed | live (PR #474) |
| 9 | `reuse-completeness-reviewer-prompt` | integrated everywhere (advisory) | live (PR #453) |
| **10** | **`adoption-everywhere-gate`** | **adopted everywhere** | **PROPOSED — substrate scaffolded 2026-05-16** |

## §8. Update to DoD v2 §5 classifier table

Add a new column to the existing table:

| Change type | Required gates |
|---|---|
| Docs only / `.changeset/` only / agent-memory only | 1, 2, 3 |
| `packages/<x>/src/**.ts` change | 1-6 + 7 + 8 + 9 + **10** |
| New `packages/<x>/` (new package) | 1-6 + 7 + 8 + 9 + **10** |
| `caia/infra/**` change | 1-6 + 7 + drift-audit |
| `caia/apps/<x>/**` change | 1-6 + 7 + 8 |
| `agent-memory/_*_run_phase.sh` change | — (flagged for migration) |

## §9. Non-goals (explicit, prevents scope creep)

- G10 does not retroactively chase adoption for the 41 currently-dormant packages. Those are handled by the parallel `stolution-dormant-package-deep-dive` chain. G10 prevents *new* adoption gaps.
- G10 does not block PR merges — it blocks *mark-done* for the originating chain. The originating PR merges normally; only the chain's "done" signal is gated.
- G10 does not consume Claude tokens. The substrate's semantic-match Tier C uses the local-llm-router only. G10 itself is a pure shell/JS check against the ledger jsonl — no LLM call.

## §10. Rollback

If G10 produces too many false-positive blockers in its first week:
- Set `~/.caia/adoption/gate-policy.json` `enforce: false` to revert to advisory-only (logs blockers, doesn't refuse mark-done).
- The substrate continues to populate the ledger; only the gate's refusal behavior is toggled.
- Operator returns to manual mark-done with full advisory visibility.

---

## Appendix — Why this is the right shape (continued from DoD v2 §Appendix)

The DoD v2 appendix argued for *chokepoints, not checklists* — guardrails that intercept at a system boundary (GHA workflow, cron, PR template). G10 follows the same pattern: it intercepts at the `caia-chain mark-done` boundary, the same boundary G2 already uses. No new chokepoint surface; one new policy applied at the existing chokepoint.

The pattern continues to hold: *find a recurring failure mode -> make the next-step mechanically inescapable*. The recurring failure mode is "I built it, I merged it, I deployed it, I wired the first consumer — and then I forgot about the other six places that should also have adopted it." G10 makes forgetting mechanically impossible.
