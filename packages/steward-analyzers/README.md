# @chiefaia/steward-analyzers

Static analyzers for the **Steward Gatekeeper** — pre-merge checks that are
not predicate-evaluable on the `@chiefaia/steward-core` engine. They share
the Steward's `Finding` shape so output funnels into the same dashboard +
issue surfaces.

**Status:** v0.1.0 — first analyzer (Drizzle migration breakpoint linter)
ships behind the `steward-gatekeeper` GitHub Actions workflow as
`continue-on-error: true` for one cycle, then promoted to required-status
context on `develop` and `main`.

**Architecture:** see
`~/Documents/projects/reports/steward-gatekeeper-architecture-2026-05-04.md`
§3.1, §3.2, §3.3.

## What's in v0.1.0

- `migration-linter.ts` — scans every `.sql` file in
  `apps/orchestrator/src/db/migrations/` (and any other migration root
  configured); for each file, lightly tokenises (respecting `--` / `/* */`
  comments, `'string'` / `"identifier"` literals, `$$`-quoted bodies, and
  paren nesting) and counts top-level statements. If a file contains > 1
  top-level statement AND no `--> statement-breakpoint` markers separate
  them AND the journal manifest reports `breakpoints: false`, emits a
  blocking `Finding`.

  This is the check that would have caught the PR #287 root cause
  (`0052_smart_cicd_observations.sql` originally without
  statement-breakpoints).

## Public API

```typescript
import { lintMigrations, type Finding } from '@chiefaia/steward-analyzers';

const findings = await lintMigrations({
  migrationsDir: 'apps/orchestrator/src/db/migrations',
});

for (const finding of findings) {
  console.log(`${finding.severity}: ${finding.path}: ${finding.message}`);
}
```

The CLI shim at `bin/steward-gatekeeper.mjs` is what the
`.github/workflows/steward-gatekeeper.yml` workflow invokes. Run locally
to preview before pushing:

```
node packages/steward-analyzers/bin/steward-gatekeeper.mjs migration-linter
```

## Tests

```bash
pnpm --filter @chiefaia/steward-analyzers test
```

## Reference

- `~/Documents/projects/reports/steward-gatekeeper-architecture-2026-05-04.md`
- `agent/memory/steward_gatekeeper_directive.md`
- `caia/docs/steward.md` (operator runbook, ships with the campaign)
- `caia/packages/steward-core/` (the predicate-evaluable engine this
  package complements)

## v0.2.0 — Steward Phase-2c additions (failure modes 4, 5, 6)

Extends the analyzer surface to repo-state checks that don't fit the
pre-merge model — these run via cron (`hygiene-report.yml`) and via the
`steward preflight` pre-spawn hook (`feedback_operational_discipline.md`).

- `local-state.ts` exports four pure functions:
  - `checkStashCount(stashEntries[])` — flags any stash count > 0; high
    severity at > 5 (stashes block worktree cleanup; standing rule is 0).
  - `checkWorktreeCount(worktrees[])` — warn at > 8 secondary, high at > 12
    (per `feedback_operational_discipline.md` cap).
  - `checkOrphanBranches(branches[])` — flags branches > 7 days old with
    no open PR, ignoring `backup/*`, `release/*`, `dependabot/*`,
    `archive/*`, `main`, `develop`. High severity above cumulative 50
    (per architecture doc §3.5).
  - `preflightChecks({stashEntries, worktrees, dirtyTreeEntries})` —
    composite for the `steward preflight` pre-spawn hook; sub-second
    output covering stash + worktree + dirty-tree caps.

- CLI extensions on `bin/steward-gatekeeper.mjs`:
  - `preflight` — runs preflightChecks on the local repo. Exit 0 = OK to
    spawn substantial work; exit 1 = blocked. Sub-second.
  - `hygiene-daily` — runs the full daily set (stash + worktree +
    orphan branches). Used by `hygiene-report.yml` cron.

- `hygiene-report.yml` extended with a Section 4 that captures
  `hygiene-daily` output into the daily `Git Hygiene` issue.

Examples:

```sh
# Local pre-spawn: should run from your CAIA worktree before any substantial spawn
node packages/steward-analyzers/bin/steward-gatekeeper.mjs preflight
echo "exit code: $?"   # 0 = clean; 1 = stash/worktree/dirty-tree predicate fired

# What the daily cron will produce
node packages/steward-analyzers/bin/steward-gatekeeper.mjs hygiene-daily
```

The `preflight` check is intended to be wired into orchestrator spawn
paths in a follow-up PR (`@caia-app/orchestrator` task spawn → preflight
gate). Today it's a manual command; once the orchestrator-side hook
lands, no substantial-work spawn proceeds with non-zero preflight exit.
