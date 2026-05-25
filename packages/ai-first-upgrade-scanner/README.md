# `@caia/ai-first-upgrade-scanner`

**Layer 6** of the AI-first continuous discipline framework
(`research/ai_first_continuous_discipline_2026.md`).

Daily cron that WebSearches Anthropic / OpenAI / Cognition / arxiv / Hacker News
for new agent-engineering patterns; LLM-filters for CAIA relevance; drafts
candidate ADRs; surfaces them to INBOX under
`## YYYY-MM-DD — AI-FIRST-UPGRADE CANDIDATES`.

**AI-first discipline**: LLM judgment IS the primary tool — the deterministic
part is just cadence (daily) and the source list (curated).

**Deterministic backstop**: no candidate-ADR is auto-accepted — only proposed.
EA Architect + operator decide acceptance.

## Pipeline

1. **Load** curated source list from `sources/00-default-sources.json`.
2. **Search** last `lookbackHours` (default 24) items per source via
   the `WebSearcher` adapter.
3. **Filter** each item via `RelevanceCritic.judge(...)` — LLM call
   (subscription only). Verdicts above `confidenceThreshold` (default 0.7) are
   marked relevant.
4. **Draft** candidate ADRs at
   `<decisionsRoot>/candidate-<YYYY-MM-DD>-<slug>.md` with status
   `Proposed-by-daily-upgrade-cron`.
5. **Surface** up to `inboxDailyCap` (default 5) candidates to INBOX under
   `## YYYY-MM-DD — AI-FIRST-UPGRADE CANDIDATES` with 30-day dedup.
6. **Report** to `<reportsRoot>/daily_upgrade_scan_YYYY-MM-DD.md`.

## Public surface

```ts
import { runScan } from '@caia/ai-first-upgrade-scanner';

const report = await runScan({
  sourcesPath: '<package>/sources/00-default-sources.json',
  decisionsRoot: '~/Documents/projects/caia-ea/decisions',
  inboxPath: '~/Documents/projects/agent-memory/INBOX.md',
  reportsRoot: '~/Documents/projects/reports',
  webSearcher: new MyWebSearcher(),     // production: subscription-channel
  relevanceCritic: new MyClaudeCritic(),// production: @chiefaia/claude-spawner
  confidenceThreshold: 0.7,
  inboxDailyCap: 5,
  lookbackHours: 24,
});
```

All paths + adapters + the clock + the filesystem are parameterised per the
Option-E standing rule (`agent/memory/agent_architecture_shape_2026-05-06.md`).
Tests inject `CannedWebSearcher` + `StubRelevanceCritic` + `makeMemoryFsAdapter`;
production wires real subscription-Claude adapters.

The shipped `NullWebSearcher` + `NullRelevanceCritic` are safe defaults: if the
package is invoked without adapters, it produces an empty (but well-formed)
scan report rather than throwing — the cron records "noted, not actionable."

## CLI

```
ai-first-upgrade-scan [--quiet] [--sources=PATH] [--decisions=PATH]
                      [--inbox=PATH] [--reports=PATH] [--threshold=N]
                      [--cap=N] [--lookback-hours=N]
```

Exit code is always 0 on success regardless of candidate count / per-item
errors. Failure surface is INBOX + report, not the exit code.

## launchd

Plist staged at `launchd/com.caia.ai-first-upgrade-daily.plist` runs at
04:00 local (after Layer 4 at 03:00). Install:

```bash
ln -sf /Users/macbook32/Documents/projects/caia/packages/ai-first-upgrade-scanner/launchd/com.caia.ai-first-upgrade-daily.plist \
       ~/Library/LaunchAgents/com.caia.ai-first-upgrade-daily.plist
launchctl load -w ~/Library/LaunchAgents/com.caia.ai-first-upgrade-daily.plist
```

The plist is NOT loaded by this PR; loading is a manual operator step.

## Subscription-only

Production `RelevanceCritic` wraps `@chiefaia/claude-spawner` — runs against
Claude Max via the subscription channel. No API keys.
`@chiefaia/llm-cache` can wrap the critic for re-run dedup
(opt-in; not a hard dep).

## Tests

≥22 unit tests across 7 module suites + 1 integration test exercising the
full pipeline end-to-end with canned adapters (hermetic; no live HTTP).

## See also

- `PLAN.md` — the implementation plan submitted to EA Architect for review.
- `EA-REVIEW-OUTCOME.json` — the recorded review verdict.
- `sources/00-default-sources.json` — the curated source list.
- `research/ai_first_continuous_discipline_2026.md` — framework spec, Layer 6.
