---
name: main-develop-reconcile-audit-2026-05-25
description: Audit of commits unique to main (not on develop) ahead of the develop-canonical reconciliation. Operator decision 2026-05-25 — develop is canonical; main will be force-aligned to develop.
metadata:
  type: project
---

# Audit: `main` vs `develop` divergence in `prakashgbid/caia`

**Date:** 2026-05-25
**Auditor:** agent (per operator's "make informed decisions for me" directive)
**Standing rule:** `~/Documents/projects/agent-memory/standing_rule_develop_canonical_2026-05-25.md`

## Captured SHAs (at audit time)

| Ref              | SHA                                        |
|------------------|--------------------------------------------|
| `origin/main`    | `75a8cff5000220fdbec9400f434aa6ac7ad61e92` |
| `origin/develop` | `983f9793bd20247af1381a5f9b9d88615e635906` |
| merge-base       | **NONE** — `git merge-base` exited 1; the two histories are truly unrelated |

## Headline

The two branches share **no common ancestor**. `main` is essentially the old CAIA codebase (architecture-registry / orchestrator / worker-coding / validator stack from late April–early May 2026), and `develop` is the post-rewrite codebase (Atlas / EA fan-out / 17 architects / stewards / lifecycle conductor stack from mid-late May 2026). The "divergence" is not a normal feature-branch fork — it's an orphan-history situation. The expected `PR #596 wizard 3-4` content is **NOT** present in this audit because PR #596 is still **OPEN, not merged**.

## Numbers

- Commits on `origin/main` **not on** `origin/develop`: **50** (49 non-merge)
- Commits on `origin/develop` **not on** `origin/main`: **89**
- Merge-base: none (orphan histories)

## What's actually unique to `main`

Tip-first listing (full list at bottom of file). Categorized:

### Tip-of-main (recent)
- `75a8cff` — `build(deps): bump the npm_and_yarn group across 3 directories with 3 updates (#426)` — Dependabot bumping `next` 14.2.35 → 15.5.18, `hono` 4.12.15 → 4.12.18, `@opentelemetry/exporter-prometheus` 0.215 → 0.218 across `/`, `/apps/dashboard`, `/templates/site`. **Worth considering for cherry-pick** — but the touched files (`apps/dashboard`, `templates/site`) may not exist or may have different shape on develop. Dependabot will re-open this against develop on its next scheduled run, so abandoning is safe.

### Old `release(...)` merges (April 29 – May 4)
- `fdc8c76` `release(2026-05-04): develop → main back-merge — dashboard redesign + accumulated work since #281 (#259)`
- `8e70ab2` `release(2026-05-02): cleanup wave — Skills Registry + EA Rubric + DSPy 1-3 + Smart CI/CD PR1 + GraphRAG PR1 + observability foundation + safety hardening + no-API-key compliance (#281)`
- `c426116` `release(2026-04-30-obs-foundation): merge develop -> main (#270)`
- `5413177` `release(2026-04-30-no-api-key-compliance): cherry-picked LAI-001 + decomposer-widening + scaffolder-fix + routing-default → main (#256)`
- `7ce17a3` `release(2026-04-30-broker-wireup): broker wireup — develop → main (#235)`
- `759e0f2` `release(2026-04-30): EA mesh P0 + tail of develop → main (#229)`
- `084fba3` `release(2026-04-30-po-decomposer-p0-v2): PO recursive decomposer P0 → main (#219)`
- `e426cab` `release(2026-04-30): Track 3 recovery + run-modes (D1+D2) (#212)`
- `db44bbc` `release(2026-04-29-safety-hardening): cap-broker + mcp + sanitizer + spend-guard (#211)`
- `efd1660` `release(2026-04-29): merge develop → main (#204)`

These were the historical develop→main back-merges that built the OLD codebase. The functionality has all been re-architected on the post-rewrite develop. Cherry-picking these would resurrect deleted abstractions.

### Old git-flow + ci foundation (mid-late April)
- `233a51f`, `fe0c3b6`, `4faf656`, `73df4e0`, `05416c4`, `512c685`, `d05b93a`, `e4a2ccc` — gitflow-conformance L2-L9, husky guards, scheduled draft-PR opener, hygiene cron. The current develop has different (and more comprehensive) governance via the steward stack and lifecycle conductor.

### Old orchestrator / worker-coding / validator stack
- `ed17d40`, `2c88f8b`, `90b128e` (PHASE2E-001..003)
- `1ae0554` (ACR-007)
- `804dfee`, `6a0403b`, `eaf49d2` (CODING-007..009)
- `68ed9f2`, `ecaaaa0`, `6c7fe47`, `4788d94` (VAL-004..009)
- `98020b1`, `b6e47c8`, `7c80186`, `83dfb23`, `acecef6`, `541f2c3` (CODING-001..006)
- `52e07ce`, `521f63d`, `a594062`, `54f85e5`, `c5f5d95`, `253a259` (TASKMGR-001..006)
- `1bb5b10`, `f3a1a07`, `4e545bc`, `a4701ca`, `b82abe5`, `1abe8a2`, `dd4641d`, `9f938e6` (arch-002..009)

These are the entire old architecture-registry → orchestrator → worker-coding → validator pipeline. Develop has superseded them with the principal-engineer / FSE dispatcher / per-story-tester / EA dispatcher / lifecycle-conductor / state-machine stack (PRs #532+ on develop).

### PR #596 status
- **PR #596 (`feat(apps/dashboard): wizard steps 3-4 — interview + architecture routes`) is OPEN, not merged.** Its branch `feature/wizard-steps-3-4-2026-05-25` exists but its content is NOT on main's tip. The standing-rule expectation that PR #596 was the cause of main's divergence was a partial description — the divergence predates PR #596 by weeks. The actionable corollary: PR #596 must be re-targeted at `develop` once main is aligned, OR closed and re-opened against develop.

## Reconciliation decision

Cherry-picking 50 commits from the old codebase onto the new develop architecture would:

1. Resurrect deleted abstractions (worker-coding, validator, old orchestrator) that the new develop has consciously replaced.
2. Generate severe, near-unresolvable conflicts because file paths, package boundaries, and APIs have all moved.
3. Land technical debt onto the new architecture that we'd then need a follow-up cleanup wave to delete.

Per operator's standing instruction *"if conflicts are severe, document them and CONTINUE rather than force the merge"* — and given the architectural supersession evident above — the reconcile PR will:

- Attempt to cherry-pick **only `75a8cff` (the dependabot bump)** as a sanity probe.
- If that conflicts (likely), abandon it and let dependabot re-open against develop on its next run.
- Open the reconcile PR as primarily a **documentation PR** (this audit + a CHANGELOG note) rather than re-applying old work. This still gives us the audit trail in the develop merge log.
- Proceed to step 5 (force-align main to develop) regardless, since the old work has been superseded.

## Risks captured for PR description

1. **Cloudflare Pages or other deploy automations against `main`** — if `main` is wired to a production deploy target, that target will silently start serving the develop tip after alignment. This is the *intended* outcome (main = mirror of develop = production-ready), but should be confirmed by the operator before the force-align push fires. **Assessment:** consistent with the develop-canonical doctrine; no action needed unless deploy automation has a stale-asset assumption.
2. **GitHub default-branch flip** — operator TODO entry #2 in `operator_todo_account_creations.md`. Agent cannot do this via the API without `repo` + `admin:repo` scope. Leave to operator.
3. **PR #596 (and any other open PR targeting main)** must be re-targeted at develop once main is aligned, or it'll be auto-closed / auto-merged-into-itself in confusing ways. Re-targeting is a one-liner per PR via `gh pr edit <n> --base develop`. Agent should sweep open PRs at the end of this reconciliation and re-target them.

## Full list of commits unique to `origin/main` (oldest → newest)

```
9f938e6 feat(architecture-registry): ts-morph AST extractors for components/APIs/services (ARCH-002) (#127)
dd4641d feat(architecture-registry): drizzle introspect + monorepo package scanner (ARCH-003) (#131)
1abe8a2 feat(architecture-registry): sqlite-vec storage + EmbeddingClient (ARCH-004) (#128)
b82abe5 feat(architecture-registry): per-domain query API + RRF fusion (ARCH-005) (#130)
a4701ca feat(orchestrator): ea agent akg integration + pipeline reorder (arch-006) (#138)
4e545bc feat(orchestrator,dashboard): /architecture page + /api/architecture routes (arch-007) (#141)
f3a1a07 test(orchestrator): e2e ea agent + akg architecturalInstructions (arch-008) (#143)
1bb5b10 docs(architecture-registry): comprehensive architecture-registry.md guide (arch-009) (#145)
253a259 feat(orchestrator): phase 2 worker-pool schema (TASKMGR-001) (#146)
c5f5d95 feat(orchestrator,events): worker pool registry (TASKMGR-002) (#147)
54f85e5 feat(orchestrator,events): ready-pool consumer with atomic assign (TASKMGR-003) (#148)
a594062 feat(orchestrator,events): backpressure monitor (TASKMGR-004) (#149)
521f63d feat(orchestrator,events): bucket health metrics emitter (TASKMGR-005) (#150)
52e07ce feat(orchestrator,docs): workers api routes + task manager runbook (TASKMGR-006) (#151)
541f2c3 feat(worker-coding): skeleton + bundle reader (CODING-001) (#152)
acecef6 feat(worker-coding): worktree manager (CODING-002) (#153)
83dfb23 feat(worker-coding): implementation engine + mock LLM adapter (CODING-003) (#154)
7c80186 feat(worker-coding): local test runner with command discovery (CODING-004) (#155)
b6e47c8 feat(worker-coding): diff committer + PR opener (CODING-005) (#156)
98020b1 feat(worker-coding): dod self-check before coding-complete (CODING-006) (#157)
4788d94 feat(orchestrator): story validator agent — six-step pipeline (VAL-004) (#115)
6c7fe47 feat(orchestrator): wire validator loop into pipeline (VAL-005) (#118)
ecaaaa0 docs(validator): operator runbook + rubric reference (VAL-008) (#121)
68ed9f2 feat(orchestrator): ea re-invocation branch in validator loop (VAL-009) (#123)
eaf49d2 feat(worker-coding,orchestrator): ipc server + wirePhase2 glue (CODING-007) (#165)
6a0403b docs(coding-agent): operator runbook (CODING-008) (#168)
804dfee test(worker-coding): real-git end-to-end (CODING-009) (#174)
1ae0554 feat(orchestrator): flip Validator to composed templates + scope backfill (ACR-007 Step B + Step C) (#178)
90b128e test(orchestrator): phase 2 happy-path e2e acceptance (PHASE2E-001) (#182)
2c88f8b test(orchestrator): phase 2 diverse-prompt acceptance suite (PHASE2E-002) (#183)
ed17d40 test(orchestrator): comprehensive pipeline + agent regression suite (PHASE2E-003) (#184)
e4a2ccc ci: add gitflow-conformance required check (gitflow-enforcement L5) (#186)
d05b93a build(scripts): add setup-branch-protection.sh (gitflow-enforcement L2) (#187)
512c685 ci(auto-pr): scheduled draft-PR opener for orphaned branches (L3) (#188)
05416c4 ci(hygiene): daily git-hygiene report at 17:00 UTC (L4) (#189)
73df4e0 build(husky): client-side guards against committing/pushing main or develop (L6) (#190)
4faf656 feat(scripts): caia-flow lifecycle wrapper + 'pnpm flow' (L7) (#191)
fe0c3b6 docs(git-flow): operator runbook + README contributing section (L8/L9) (#192)
233a51f chore(gitflow): expand conformance prefixes for CAIA work-streams (#197) (#199)
efd1660 release(2026-04-29): merge develop → main (#204)
db44bbc release(2026-04-29-safety-hardening): cap-broker + mcp + sanitizer + spend-guard (#211)
e426cab release(2026-04-30): Track 3 recovery + run-modes (D1+D2) (#212)
084fba3 release(2026-04-30-po-decomposer-p0-v2): PO recursive decomposer P0 → main (#219)
759e0f2 release(2026-04-30): EA mesh P0 + tail of develop → main (#229)
7ce17a3 release(2026-04-30-broker-wireup): broker wireup — develop → main (#235)
5413177 release(2026-04-30-no-api-key-compliance): cherry-picked LAI-001 + decomposer-widening + scaffolder-fix + routing-default → main (#256)
c426116 release(2026-04-30-obs-foundation): merge develop -> main (#270)
8e70ab2 release(2026-05-02): cleanup wave — Skills Registry + EA Rubric + DSPy 1-3 + Smart CI/CD PR1 + GraphRAG PR1 + observability foundation + safety hardening + no-API-key compliance (#281)
fdc8c76 release(2026-05-04): develop → main back-merge — dashboard redesign + accumulated work since #281 (#259)
75a8cff build(deps): bump the npm_and_yarn group across 3 directories with 3 updates (#426)
```
