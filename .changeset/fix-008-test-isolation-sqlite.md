---
"@chiefaia/test-isolation": minor
---

feat(test-isolation): per-test ephemeral SQLite (FIX-008)

New package `@chiefaia/test-isolation` with the `./sqlite` module.

Each call to `createTestDb({ migrationsFolder, schema? })` returns a
throwaway SQLite database at `${tmpdir}/caia-test-<uuid>.sqlite`,
seeded by running Drizzle migrations from a caller-supplied folder.
The file is deleted on `cleanup()` (or via `Symbol.dispose` for
TypeScript 5.2+ `using` declarations), and a best-effort
`process.on('exit')` hook scrubs any unfinalized files.

Also exposes:
- `listLiveTestDbs()` — observability hook for the FIX-013 dashboard
- `sweepStaleTestDbs({ maxAgeMs })` — periodic cleaner

The package is generic — it does not import from
`apps/orchestrator/src/db/schema`. Each consumer wires their own
schema, so the orchestrator, behavior-suite, and Fix-It runner can
all use the same primitive without coupling.

Phase B (FIX-008). Companion to FIX-007 (Browserless on stolution)
and FIX-009 (port allocator, separate PR).
