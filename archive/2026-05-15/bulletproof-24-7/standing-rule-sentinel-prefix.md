# Standing-Rule Sentinel — short reference injected at top of every task prompt

**Token-cost-conscious version (operator constraint 2026-05-08).** The
orchestrator must prepend this short reference block (≈ 8 lines, ≈ 150 chars)
to every dispatched task prompt. The full rule lives in the canonical memory
file; the spawned task reads it ONCE on session start (it reads MEMORY.md
anyway, so this adds zero marginal token cost).

## The reference block (copy-paste verbatim)

```text
<!-- STANDING-RULE-SENTINEL v2 -->
READ FIRST — these files override defaults:
  agent-memory/feedback_24_7_bulletproof_2026-05-08.md (highest)
  agent-memory/feedback_decision_classifier.md
  agent-memory/feedback_operator_does_not_code.md
  agent-memory/feedback_self_perpetuating_campaigns.md
  agent-memory/feedback_zero_dollar_budget_2026-05-08.md
  agent-memory/decision_defaults.yaml
Pipe every operator-facing draft through scripts/orchestrator/pre-send-classifier.sh.
On clean exit, spawn the next item from master_backlog_sequencing — never go idle.
<!-- /STANDING-RULE-SENTINEL v2 -->
```

That is the entire prefix. ≈ 600 bytes. Negligible token impact.

## Why a SHORT reference rather than the full rule inline

- **Cost-of-enforcement budget**: per operator constraint 2026-05-08, the
  bulletproof guardrails cannot meaningfully consume Claude tokens. A 60-line
  inline sentinel adds ~1.5 KB per spawned task. Across 35-45 parallel tasks
  with frequent respawns, that's MBs of redundant context per day. Replacing
  with a 600-byte reference saves ~95% of the prefix overhead.
- **Memory files are already loaded**: every Claude Code session loads
  `MEMORY.md` and the indexed feedback files at startup. The reference
  reaffirms which files take precedence; it does not duplicate their content.
- **Adherence-during-first-tokens still preserved**: the reference IS in the
  first tokens of context. It points at the rule files. The task's first
  reasoning step ("which rules apply") finds the canonical files immediately.
- **Update propagation is automatic**: when the bulletproof rule changes
  (operator drops a new memory file), the reference still points at the same
  filename — no need to rebuild every spawn template.

## Mechanical injection (local script — zero Claude tokens)

```bash
# scripts/orchestrator/inject-sentinel.sh
SENTINEL='<!-- STANDING-RULE-SENTINEL v2 -->
READ FIRST — these files override defaults:
  agent-memory/feedback_24_7_bulletproof_2026-05-08.md (highest)
  agent-memory/feedback_decision_classifier.md
  agent-memory/feedback_operator_does_not_code.md
  agent-memory/feedback_self_perpetuating_campaigns.md
  agent-memory/feedback_zero_dollar_budget_2026-05-08.md
  agent-memory/decision_defaults.yaml
Pipe every operator-facing draft through scripts/orchestrator/pre-send-classifier.sh.
On clean exit, spawn the next item from master_backlog_sequencing — never go idle.
<!-- /STANDING-RULE-SENTINEL v2 -->
'
printf '%s\n\n---\n\n%s\n' "$SENTINEL" "$(cat)"
```

Used as: `cat raw_prompt.md | inject-sentinel.sh > final_prompt.md`. Pure bash,
no LLM, no token cost. Backlog Driver pipes its task prompts through this
before calling `start_task`.

## Audit (drift detection without LLM)

`scripts/orchestrator/audit-spawn-prefix.sh` is a local bash script:

```bash
# pseudo:
for prompt in $(find ~/.claude/projects -name '*.jsonl' -mmin -1440); do
  if ! grep -q 'STANDING-RULE-SENTINEL v2' "$prompt"; then
    echo "DRIFT: $prompt missing sentinel" >> ~/.cache/sentinel-drift.log
  fi
done
```

Runs nightly via cron. If drift is detected, the Heartbeat Auditor surfaces it
on its next anomaly tick. No Claude tokens consumed.
