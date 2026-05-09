# @chiefaia/surface — DESIGN

Surface Agent — operator-curation lens. Filters and digests important findings from PR activity, agent-memory deltas, and agent transcripts so the operator gets a curated "what matters this week" view rather than a firehose.

Phase 0 ships heuristic-only, subscription-free. Phase 2 will add operator-voice rephrasing once the Apprentice operator-style adapter is mature (~2026-05-15 first adapter).

This package is **private** (`"private": true` in package.json) and follows the **Option E** shape per `agent_architecture_shape_2026-05-06.md`. It is never published. Project-bonding to CAIA happens at runtime via constructor defaults; tests inject fixture corpora.

## 1. Why this exists

The CAIA factory produces 30+ PRs/day, 200+ memory deltas/week, and N hourly heartbeat updates per active campaign. Without curation the operator either tunes most of it out (signal loss) or drowns in firehose. Mentor / Curator / Apprentice **capture** signal; Surface **filters** it for operator attention.

See `agent-memory/surface_agent_directive.md` for the full directive (this design's parent doc).

## 2. Sources (Phase 0)

All subscription-free. No API keys.

- **PR connector** (`src/connectors/pr.ts`) — shells out to `gh pr list --json` for merged + open PRs in `ghRepo` (default `prakashgbid/caia`). `gh` uses the operator's existing PAT.
- **Memory connector** (`src/connectors/memory.ts`) — runs `git log --name-status --since=...` over the agent-memory repo. Falls back to filesystem mtime walk if git fails.
- **Transcript connector** (`src/connectors/transcript.ts`) — walks `transcriptRoot` (default `~/Library/Application Support/Claude/local-agent-mode-sessions`) up to `maxDepth` (default 4); emits structural metadata only (no body extraction in Phase 0).

Each connector returns a `ConnectorResult` with `findings` and `warnings`. They never throw — failures bubble up as warnings that surface as `connector-degraded` annotation findings in the digest.

## 3. Importance heuristic

```
score = 0.4 * recency
      + 0.3 * tag_weight
      + 0.2 * severity_weight
      + 0.1 * size_signal
```

- `recency` — linear decay from 0.0 at older horizon to 1.0 at fresh moment
- `tag_weight` — keyword presence in title (🚨, BLOCKED, CRITICAL, security, complete, phase, merged, …) plus tag set boost (`feedback`, `directive`, `live`, `complete`, `failure`, `index`)
- `severity_weight` — by `kind`: `transcript-failure` and `pr-stale` highest (0.85), `memory-added`/`pr-merged` mid (0.6-0.7), `transcript-handoff` low (0.4)
- `size_signal` — `log10(bytes + 1) / 5` clamped 0..1

All deterministic. Stateless. No LLM in Phase 0.

## 4. Filter

Drops findings below `minImportance` (default 0.35). Sort kept findings by `(importance desc, ts desc, id asc)`. Cap at `maxFindings` (default 100). Overflow goes to `dropped[]` (kept on the result for tests + future feedback loop).

## 5. Digest

Markdown grouped by source (`Pull Requests` → `Agent Memory` → `Agent Transcripts` → `Connector Errors`). Header includes window, generated-at, finding counts, and a per-source summary table with warnings.

Hard size cap: throws `DigestSizeExceededError` if rendered markdown > `maxBytes` (default 50 KB). The error message tells the caller to raise `minImportance` or lower `maxFindings`.

## 6. Public API

```ts
import { SurfaceAgent } from '@chiefaia/surface';

const agent = new SurfaceAgent({
  corpusRoot: '~/Documents/projects/agent-memory',
  ghRepo: 'prakashgbid/caia',
  transcriptRoot: '~/Library/Application Support/Claude/local-agent-mode-sessions',
  maxBytes: 50_000,
  minImportance: 0.35,
});
const digest = await agent.generateDigest({ since: '1 day ago' });
```

CLI:

```
caia-surface generate --since "1 day ago" --output ~/Documents/projects/reports/digest-2026-05-09.md
caia-surface generate --since "7 days ago" --gh-repo prakashgbid/caia --min-importance 0.5 --output -
```

## 7. Determinism guarantee

Given identical sources + clock, two runs produce byte-identical digests. Tests assert this.

The intent: Surface runs daily under cron in Phase 1. Determinism enables idempotent re-runs and stable diff against the previous day's digest, which Phase 1's "delta-since-last-run" feature relies on.

## 8. Option E checklist (mechanical)

| Check | Status |
|---|---|
| `package.json` has `"private": true` | ✅ |
| Public API parameterised — every CAIA path / repo / threshold a constructor arg with default | ✅ (`SurfaceAgentConfig` ↔ `resolveConfig`) |
| Tests use fixture filesystems / fake runners — no live CAIA paths | ✅ (`FakeFs`, `FakeGh`, `FakeGit`) |
| Consumes Mentor + Librarian pre-spawn injection (system-prompt at runtime, not hard-coded prompts) | ✅ Phase 0 has no LLM call yet; Phase 2 LLM rephrasing layer will use the standard pre-spawn pipeline |
| No publishing / no second-customer abstraction | ✅ |

## 9. Roadmap

- **Phase 1** — Telegram + Slack delivery, cron schedule (LaunchAgent), delta-since-last-run state file
- **Phase 2** — LLM-rephrasing tier using subscription `claude` binary + Apprentice operator-style adapter
- **Phase 3** — Two-way feedback loop (operator reactions feed Mentor + Apprentice eval)
- **Phase 4** — Cross-source dedup

## 10. References

- `agent-memory/surface_agent_directive.md` — full directive
- `agent-memory/agent_ecosystem_expansion_directive.md` — Tier-A summary (this is the expansion of A3)
- `agent-memory/agent_architecture_shape_2026-05-06.md` — Option E shape
- `agent-memory/master_backlog_sequencing_2026-05-05.md` — item 11
- `agent-memory/feedback_no_api_key_billing.md` — subscription-only constraint
