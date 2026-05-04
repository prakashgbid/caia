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
