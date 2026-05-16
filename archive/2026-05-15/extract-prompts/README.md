# Archived: extract-prompts.py

**Archived:** 2026-05-15 (phase B5, integration-remediation-b)
**Original location:** `~/Documents/projects/scripts/extract-prompts.py`
**Status when archived:** One-time use, completed.

## What it did

Swept every Claude Cowork session under `~/Library/Application Support/Claude/local-agent-mode-sessions/*/audit.jsonl`, extracted real (non-system-injected) user prompts, deduplicated voice-to-text retries within a sliding window, classified each as `EXECUTE | ANALYZE | CONVERSATION | BACKLOG`, and emitted a chronological list for Phase 1 backlog ingestion.

## Why archived

Per integration_remediation_plan_2026-05-14.md §B Phase B5: *"scripts/extract-prompts.py: archive into agent-memory/archive/."*

(Substituted target: archived to `caia/archive/2026-05-15/extract-prompts/` instead of `agent-memory/archive/` — `agent-memory/` is not a git repo, so version-controlled preservation requires landing under `caia/`. This is the consistent destination for every B5 archive entry.)

It was a one-shot tool — the prompt sweep it produced has already been ingested. The script is preserved because the parsing rules (system-injection filters, dedup window) capture useful know-how if a similar sweep is needed for a future store of session transcripts.

## Resurrection note

The session-store schema has shifted since this was written (April 2026 vintage). Before rerunning, verify that `audit.jsonl` still has `type`, `message.role`, `message.content`, `parent_tool_use_id`, and `_audit_timestamp` fields. If the field names have moved, update the filter logic — don't trust a clean run alone.
