# caia/archive/

Frozen artifacts from completed phases — kept under git for provenance, not for live use.

## Layout

```
archive/
  <YYYY-MM-DD>/
    <name>/
      README.md     ← why archived, what it was, resurrection notes
      <files...>    ← original tree OR tarball
```

Each `<name>/` directory's `README.md` is required and documents:

1. What the artifact did when live.
2. Why it was archived (not migrated).
3. Whether to resurrect, and if so, what to update first.

## Rules

- **No imports from `archive/`** — nothing in the active tree (apps/, packages/, services/, scripts/, infra/) may import or shell out to anything under `archive/`. Enforced socially today; if needed later, add a `repo-policy/no-archive-imports.sh` check.
- **Append-only at the date level** — once a date directory is committed, new entries for the same artifact go under a new date directory, not in-place edits to the old one.
- **Tarball large dumps** — anything > ~100 KB or > ~50 files should be a `.tar.gz` inside the named directory. Keep `README.md` next to the tarball.

## Origin

Created 2026-05-15 by phase B5 of integration-remediation-b. Plan: `~/Documents/projects/reports/integration_remediation_plan_2026-05-14.md` §B Phase B5 + invariant AR-5.
