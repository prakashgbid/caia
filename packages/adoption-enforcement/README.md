# @chiefaia/adoption-enforcement

Adoption enforcement substrate for CAIA. Detects newly-exported workspace artefacts at merge time, cross-references the codebase for adoption sites, generates adoption PRs, verifies them, and gates DoD v2 on the result.

Design: `agent-memory/decisions/p3_adoption_enforcement_substrate_2026_05_16.md`.

## Verify subsystem (V1+V2+V3)

`src/verify/` runs the per-PR gauntlet defined in §7 of the design doc:

| Check | Module | Command |
|---|---|---|
| V1 typecheck | `verify/typecheck.ts` | `pnpm --filter <pkg> typecheck` |
| V2 unit tests | `verify/tests.ts` | `pnpm --filter <pkg> test` |
| V3 build | `verify/build.ts` | `pnpm --filter <pkg>... build` |

Entrypoint: `bin/caia-adoption-verify.mjs` — discovers open `adopt/*` PRs, runs each in a `/tmp/adopt-verify-<sha>` worktree, upserts a `<!-- adoption-verify -->` PR comment with `verification.md`, and toggles `adoption-verified` / `adoption-failed` labels idempotently. 15-min wall-clock cap per PR.

## CLI

```bash
# Verify every open adopt/* PR
caia-adoption-verify

# Verify a single PR by number
caia-adoption-verify --pr 123

# Dry-run (no comment, no labels)
caia-adoption-verify --dry-run
```
