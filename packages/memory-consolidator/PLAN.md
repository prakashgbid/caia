# Plan — `@caia/memory-consolidator` (Layer 4)

**Plan type**: `implementation`
**Caller**: `claude-agent-mode/cowork`
**Submitter**: operator (Stolution)
**Affected components**: `agent-memory tree`, `INBOX.md`, `reports/`, `launchd`, new package `@caia/memory-consolidator`
**Branch**: `feature/memory-consolidator-2026-05-25`

## Brief

Layer 4 of the AI-first continuous discipline framework. Daily cron that scans memory files + recent research; runs consistency checks; surfaces drift findings to INBOX. Drift vectors addressed: stale memory files, INBOX drift, memory-file inconsistency, broken cross-references, stale `superseded_by:` chains, missing index entries.

This is the *minimum-viable* Layer 4: focused on memory-tree consistency (scanner + cross-referencer + freshness-checker + inbox-surfacer + reporter). The fuller framework-doc spec (Mem0-style fact extraction, AKG community summary regen, postmortem skeletons) is explicitly deferred to a follow-up package because it requires AKG community detection that ships in a separate PR.

## Package shape (Option-E standing rule)

- Private scope `@caia/memory-consolidator`; no public-npm publish.
- Parameterised public API: `corpusRoot`, `inboxPath`, `reportsRoot` are constructor args with CAIA defaults.
- Fixture-corpus tests inject fake memory trees; production injects CAIA defaults.
- Configuration matrix = 1 (CAIA only).
- ESM, Node ≥20, strict TypeScript, vitest.

## Public surface (parameterised)

```ts
export interface ConsolidatorConfig {
  corpusRoot?: string;
  researchRoot?: string;
  inboxPath?: string;
  reportsRoot?: string;
  clock?: () => Date;
  fs?: FsAdapter;
  dedupeWindowDays?: number;
}
export function runConsolidation(config?: ConsolidatorConfig): Promise<ConsolidationReport>;
```

## Pipeline

1. Scan: walk corpusRoot for `*.md`, parse frontmatter, extract `[[wiki-links]]`, `[text](file.md)` links, `superseded_by:` field.
2. Cross-reference: validate every link target exists. Flag dangling.
3. Freshness: detect stale `superseded_by:` chains; detect entries mentioned in INBOX but missing from MEMORY.md index.
4. Surface: append findings to INBOX under `## YYYY-MM-DD — memory drift`; dedup against last `dedupeWindowDays` days.
5. Report: write `<reportsRoot>/memory_consolidation_YYYY-MM-DD.md`.

## Reuse

- No `@chiefaia/*` runtime deps for this minimum-viable shape (no LLM calls, no AKG queries).
- Node stdlib + `yaml`.

## launchd

`com.caia.memory-consolidator-daily.plist` at 03:00 local. Driver: `bin/memory-consolidator-run`. Exit 0 even with findings (surface is INBOX, not exit code).

## Tests

≥30 unit + 1 integration against the operator's real memory tree (dry-run, asserts the scanner produces ≥0 findings without throwing).

## DoD

Tests + typecheck + lint green; PR opened; CI green; admin-squash-merge per True-Zero ratification.

## Risks

- yaml frontmatter parser breaks on edge cases → use permissive parser that returns null + logs warning.
- INBOX dedup churns → dedup key = `kind|sourceFile|detail(200ch)`, window 7 days.
- Integration test fails on clean tree → assert ≥0, not ≥1.
