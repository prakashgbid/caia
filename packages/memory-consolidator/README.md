# `@caia/memory-consolidator`

**Layer 4** of the AI-first continuous discipline framework
(`research/ai_first_continuous_discipline_2026.md`).

Daily cron that scans the operator's memory tree, validates cross-references,
detects stale `superseded_by:` chains and missing index entries, then
surfaces findings to `INBOX.md` and writes a daily consolidation report.

## What this package does

1. **Scans** every `*.md` under `corpusRoot` (default `~/Documents/projects/agent-memory`).
   Parses YAML frontmatter, extracts `[[wiki-links]]` and `[text](file.md)` links,
   reads `superseded_by:` field.
2. **Cross-references** every link target against the file tree. Flags
   broken wiki-links + broken md-links.
3. **Freshness-checks** `superseded_by:` chains for missing targets, and
   flags files referenced from other memory files but not reachable from
   the corpus index (`MEMORY.md`).
4. **Surfaces** findings to the operator's `INBOX.md` under
   `## YYYY-MM-DD — memory drift`, deduplicating against the last
   `dedupeWindowDays` (default 7) days.
5. **Reports** the full run to
   `<reportsRoot>/memory_consolidation_YYYY-MM-DD.md`.

## Public surface

```ts
import { runConsolidation } from '@caia/memory-consolidator';

const report = await runConsolidation({
  corpusRoot: '~/Documents/projects/agent-memory',   // optional, defaults shown
  inboxPath: '~/Documents/projects/agent-memory/INBOX.md',
  reportsRoot: '~/Documents/projects/reports',
  dedupeWindowDays: 7,
  dryRun: false,
});
// → { runAt, filesScanned, findings, newInboxEntries, reportPath, dryRun }
```

All paths + the clock + the filesystem are constructor parameters per the
Option-E standing rule (`agent/memory/agent_architecture_shape_2026-05-06.md`).
Tests inject `makeMemoryFsAdapter()`; production injects `makeNodeFsAdapter()`.

## CLI

```
memory-consolidator-run [--quiet] [--dry-run] [--corpus=PATH] [--inbox=PATH]
                        [--reports=PATH] [--dedupe-days=N]
```

Exit code is always 0 on success regardless of findings. Failure surface is
`INBOX.md` + report, NOT the exit code. The cron returns 1 only on internal
errors (config invalid, fatal I/O).

## launchd

Plist staged at `launchd/com.caia.memory-consolidator-daily.plist` runs at
03:00 local. Install with:

```bash
ln -sf /Users/macbook32/Documents/projects/caia/packages/memory-consolidator/launchd/com.caia.memory-consolidator-daily.plist \
       ~/Library/LaunchAgents/com.caia.memory-consolidator-daily.plist
launchctl load -w ~/Library/LaunchAgents/com.caia.memory-consolidator-daily.plist
```

The plist is NOT loaded by the PR that ships this package; loading is a
deliberate manual operator step.

## What this package does NOT do (deferred)

The framework doc's Layer 4 brief also calls for Mem0-style fact extraction
over the last 24h of transcripts, AKG community summary regeneration, and
postmortem skeleton drafting for unresolved drift events. Those steps need
Layer 3 (knowledge-graph-dispatch-hook, PR #578) wiring and the AKG community
detection that ships separately. They will land as a follow-up PR.

## Tests

≥34 unit tests + 1 integration test that runs the pipeline against the
operator's real memory tree in dry-run mode. Run with `pnpm test`.

## See also

- `PLAN.md` — the implementation plan submitted to EA Architect for review.
- `EA-REVIEW-OUTCOME.json` — the recorded review verdict.
- `research/ai_first_continuous_discipline_2026.md` — framework spec, Layer 4.
