# @chiefaia/verifier

VERIFIER is the **fourth review-sibling**, alongside Critic
(`@chiefaia/critic` — security/regression/cost), Code-Reviewer
(`@chiefaia/code-reviewer` — correctness/style/types/tests), and Reviewer
(`@chiefaia/reviewer` — craftsmanship). Its domain is
**acceptance-criteria-satisfaction** — the spec-truth check that none of
the other three siblings cover.

## What it does

For every implementing-spawn PR, the verifier:

1. **Creates a fresh git worktree** at `/tmp/verifier_<job_id>` checked out
   at the implementor's PR head SHA. This gives the verifier zero shared
   state with the implementing spawn (different worktree, different prompt).
2. **Reads the implementor's strict-JSON DoD self-cert** (per
   `@chiefaia/local-llm-router-py-client`'s `spawn_output_schema.v2.json`
   from B15.C). Treats every claim as **untrusted**.
3. **For each acceptance criterion** in the spec: re-reads the changed
   files, decides `met / not-met / uncertain`, captures evidence (file:line
   or test name) — never lifts the implementor's claim verbatim.
4. **For each test in `tests_required`**: runs it against the head SHA in
   the fresh worktree, captures the runner output excerpt.
5. **For each DoD stage** in `dod_required_stages`: decides whether the
   diff materially contributes (using the diff itself, not the
   self-cert).
6. **Emits a strict-JSON verdict** conforming to
   `templates/verifier_verdict_schema.json`.
7. **Cleans up the worktree** via try/finally — runs on success, exception,
   timeout, and SIGTERM paths.

## Routing semantics

Per `~/Documents/projects/agent-memory/reliability_99pct_design_2026-05-11.md`
§6.3.6:

| Routing class       | Verdict use                                                                                               |
| ------------------- | --------------------------------------------------------------------------------------------------------- |
| `autonomous-loop`   | **BLOCKING** — gates `nodes.status='done'` via SPS B15.B `done_status_guard` trigger. `pass` is required. |
| `operator-routed`   | **ADVISORY** — verdict is logged + surfaced in the spawn report; operator decides on merge.               |

The `blocking` field on the verdict mirrors this — set by the prompt builder
based on the `routingClass` input.

## CLI

```sh
caia-verifier verify           --input inputs.json [--out verdict.json]
caia-verifier render-prompt    --input inputs.json
caia-verifier validate-verdict --verdict verdict.json
```

`bin/run-verifier.sh` is the operator/spawner-side wrapper that adds a bash
`trap` for worktree cleanup on EXIT/INT/TERM/HUP. Always prefer the wrapper
over calling the CLI directly when running outside the node agent's own
process.

## Subscription-only

The verifier's `claude --print` invocation runs with `ANTHROPIC_API_KEY`
**explicitly stripped** from the env (matching the convention every other
review-sibling follows — see `feedback_no_api_key_billing.md`). Auth flows
through `CLAUDE_OAUTH_TOKEN` only.

## Design refs

- `~/Documents/projects/agent-memory/reliability_99pct_design_2026-05-11.md`
  §6.3 — verifier spawn architecture, prompt template, verdict schema.
- `~/Documents/projects/agent-memory/feedback_reviewer_agent_advisory_only_pattern.md`
  — sibling advisory pattern (we adopt the autonomous-loop / operator-routed
  split).
- `~/Documents/projects/agent-memory/feedback_critic_agent_two_tier_detector_pattern.md`
  — sibling architecture conventions (Phase 1 ships LLM-only).
- `~/Documents/projects/caia/packages/local-llm-router-py-client/templates/spawn_output_schema.v2.json`
  — the implementor's strict-JSON output the verifier consumes.

## See also

- `infra/stolution/sps/migrations/2026-05-13_b15d_verifier_verdicts.sql` —
  DB layer that gates `nodes.status='done'` on this verdict.
- `.github/workflows/verifier.yml` — PR-time verifier workflow alongside
  the other sibling workflows.
- `scripts/review-siblings/dispatch.sh` — common review-sibling dispatcher
  that runs Critic + Code-Reviewer + Reviewer + Verifier in parallel.
