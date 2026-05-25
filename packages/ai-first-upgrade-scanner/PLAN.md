# Plan — `@caia/ai-first-upgrade-scanner` (Layer 6)

**Plan type**: `implementation`
**Caller**: `claude-agent-mode/cowork`
**Submitter**: operator (Stolution)
**Affected components**: `caia-ea/decisions/`, `INBOX.md`, `reports/`, `launchd`, new package
**Branch**: `feature/ai-first-upgrade-scanner-2026-05-25`

## Brief

Layer 6. Daily cron that WebSearches Anthropic / OpenAI / Cognition / arxiv / Hacker News for new agent-engineering patterns; LLM-filters for CAIA relevance; drafts candidate ADRs; surfaces them to INBOX under `## AI-FIRST-UPGRADE CANDIDATES`.

AI-first discipline: LLM judgment IS the primary tool — the deterministic part is just cadence + source list.

## Package shape

- Private `@caia/ai-first-upgrade-scanner`.
- Parameterised: `sourcesPath`, `decisionsRoot`, `inboxPath`, `reportsRoot`, `webSearcher`, `relevanceCritic` (adapters; CAIA defaults).
- Subscription-only; production critic uses `@chiefaia/claude-spawner`; tests inject stubs.

## Public surface

```ts
export interface ScannerConfig {
  sourcesPath?: string;
  decisionsRoot?: string;
  inboxPath?: string;
  reportsRoot?: string;
  webSearcher?: WebSearcher;
  relevanceCritic?: RelevanceCritic;
  clock?: () => Date;
  fs?: FsAdapter;
}
export function runScan(config?: ScannerConfig): Promise<ScanReport>;
```

## Pipeline

1. Load sources from `sources/00-default-sources.json`.
2. WebSearcher.search each source → SearchResult[].
3. RelevanceCritic.judge each item → `{relevant, reason, confidence, recommendation}`.
4. Draft `candidate-<YYYY-MM-DD>-<slug>.md` under `decisionsRoot/` for items above threshold.
5. Surface up to 5 candidates/day to INBOX under `## YYYY-MM-DD — AI-FIRST-UPGRADE CANDIDATES`.
6. Write `<reportsRoot>/daily_upgrade_scan_YYYY-MM-DD.md`.

## Reuse

- WebSearch tool abstracted via adapter.
- `@chiefaia/claude-spawner` for production critic.
- `@chiefaia/llm-cache` optional for re-run dedup.

## launchd

`com.caia.ai-first-upgrade-daily.plist` at 04:00 local.

## Tests

≥20 unit + 1 integration against canned source results.

## DoD

Tests + typecheck + lint green; PR; CI green; admin-squash-merge.

## Risks

- WebSearch junk → confidence threshold + 5/day cap.
- LLM failure → per-item try/catch.
- Filename collisions → date prefix.
- Source URLs stale → HTTP errors logged.
