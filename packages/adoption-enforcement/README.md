# @chiefaia/adoption-enforcement

Adoption enforcement substrate — the active loop for CAIA's priority #3.

Takes every artefact CAIA produces (a new utility, a new package, a refactored
API, a newly-integrated external open-source agent) and **mechanically drives it
to be in use everywhere it should be**, with `(a)` evidence of codebase-wide
adoption or `(b)` an explicit per-site justification for non-adoption, before
the originating change is allowed to clear DoD v2.

Design: [`agent-memory/decisions/p3_adoption_enforcement_substrate_2026_05_16.md`](../../../agent-memory/decisions/p3_adoption_enforcement_substrate_2026_05_16.md).

## Components

Five sub-modules, one per chain:

| # | Component | Chain | Sub-module |
|---|-----------|-------|------------|
| 1 | Scan engine | `p3-adoption-scan-engine` | `src/scan/` |
| 2 | Cross-reference | `p3-adoption-cross-ref` | `src/crossref/` |
| 3 | PR generator | `p3-adoption-pr-generator` | `src/pr/` |
| 4 | Verification | `p3-adoption-verification` | `src/verify/` |
| 5 | DoD-v2 adoption gate | `p3-dod-v2-adoption-gate` | `src/gate/` |

## Verify subsystem (V1+V2+V3) — shipped

`src/verify/` runs the per-PR gauntlet defined in §7 of the design doc:

| Check | Module | Command |
|---|---|---|
| V1 typecheck | `verify/typecheck.ts` | `pnpm --filter <pkg> typecheck` |
| V2 unit tests | `verify/tests.ts` | `pnpm --filter <pkg> test` |
| V3 build | `verify/build.ts` | `pnpm --filter <pkg>... build` |

Entrypoint: `bin/caia-adoption-verify.mjs` — discovers open `adopt/*` PRs, runs
each in a `/tmp/adopt-verify-<sha>` worktree, upserts a `<!-- adoption-verify -->`
PR comment with `verification.md`, and toggles `adoption-verified` /
`adoption-failed` labels idempotently. 15-min wall-clock cap per PR.

```bash
# Verify every open adopt/* PR
caia-adoption-verify

# Verify a single PR by number
caia-adoption-verify --pr 123

# Dry-run (no comment, no labels)
caia-adoption-verify --dry-run
```

## Run dispatcher — stub

`bin/caia-adoption-run.ts` — the orchestrator entrypoint named by design §2.2.
Argv parser only in v0; every subcommand (`scan`, `xref`, `pr-gen`, `verify`,
`gate`, `run`) logs and exits 0. Real implementations are wired in by the
sibling chains as their sub-modules land.

## Layout

```
src/
  index.ts          # public surface — re-exports the five sub-module barrels
  scan/             # new-exports / new-packages / new-external-agents detectors
  crossref/         # L1 literal, L2 ast-similarity, L3 llm-assisted
  pr/               # gh CLI helpers, worktree prep, per-PR orchestrator
  verify/           # typecheck + tests + build + (smoke + diff sanity + lint later)
  gate/             # ledger + DoD-v2 gate predicate
bin/
  caia-adoption-verify.mjs   # verify discovery CLI (live)
  caia-adoption-run.ts       # run dispatcher: scan | xref | pr-gen | verify | gate | run (stubs)
```
