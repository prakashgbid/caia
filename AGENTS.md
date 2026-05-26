# AGENTS.md

Project conventions for any AI coding agent (Claude Code, Aider, Copilot Coding Agent, Cursor, future tools) operating on this repository. Cross-tool consistency surface; the standing rules in `agent/memory/` remain authoritative.

## Project overview

CAIA is a private monorepo housing the multi-agent AI software-development platform. Hono microservices behind apps; reusable agent + utility code in `packages/` under the `@chiefaia/*` scope. Strictly TypeScript, ESM, Node ≥20, pnpm workspaces. NEVER published to public npm — see "Option E shape" below.

Sites (pokerzeno, roulette-community, stolution, etc.) live in their own repos and historically consumed `@chiefaia/*` from npm; new agent packages stay private workspace packages per the 2026-05-06 standing rule.

## Reuse-first (mandatory — see `agent-memory/feedback_reuse_first_no_custom_code.md`)

**Rule.** Before writing any code — UI primitive, backend helper, type, or new dependency — you MUST search the workspace for an existing reusable package and either use it or extend it. Writing one-off inline code when a reusable package exists (or should exist) is institutional debt.

**4-step check (run before the first line of code):**

1. **UI primitives** — does `@caia/ui` export the component you need? If yes, import. If no but it's a UI primitive: add it to `@caia/ui` first (its own PR), then consume. Raw `@radix-ui/*`, `@/components/ui/*`, or inline-Tailwind component code outside `packages/ui/**` is a Semgrep ERROR (`caia-no-raw-shadcn-import-outside-ui-package`, `caia-no-raw-radix-outside-ui-package`).
2. **Backend helpers** — grep `packages/` and the installed `@chiefaia/*` set. The canonical wrappers are: `@chiefaia/http-client` (no raw axios/fetch — Semgrep ERROR), `@chiefaia/persistence-sqlite` and `@chiefaia/persistence-postgres` (no raw `better-sqlite3` / `pg.Pool` — Semgrep ERROR), `@caia/architect-kit`, `@caia/state-machine`, `@chiefaia/claude-spawner`, `@chiefaia/events`, `@chiefaia/critic`, `@chiefaia/ticket-template`, `@chiefaia/logger`, `@chiefaia/errors`, `@chiefaia/config`, `@chiefaia/metrics`, `@chiefaia/tracing`.
3. **Dependencies** — before `pnpm add <thing>`, check whether a workspace package already wraps it. If yes, add the workspace package instead.
4. **New code** — treat every helper, component, and type as a future-package candidate. Land it in a package, not inline in an app.

**Mechanical enforcement (defence-in-depth — see `caia-ea/decisions/ADR-065`):**

- **L1 — this section.** Doctrine.
- **L2 — EA gate.** Plans submitted through `@caia/reuse-check-gate` must include a `reuseSearchResults` field naming the `@caia/*` / `@chiefaia/*` packages considered + why each was selected or rejected. Plans of type `implementation` with empty `reuseSearchResults` are refused at the gate.
- **L3 — dispatch-time reuse search.** Orchestrators call `searchReuseCandidates(brief)` from `@caia/reuse-searcher` (also available as the `caia-reuse-search-mcp` tool) before spawning any code task. The ranked candidate list is injected into the spawned agent's system prompt.
- **L4 — CI gate.** `reuse-advisory-blocking` is a required status check on `develop` + `main`. It refuses PRs that add raw shadcn/Radix/Tailwind imports outside `packages/ui/**`, raw `axios`/`node-fetch` outside `packages/http-client/**`, raw `better-sqlite3` outside `packages/persistence-*/**`. The legacy non-blocking `reuse-advisory` job stays as a comment-only second opinion.
- **L5 — Semgrep.** The rules in `.semgrep/caia-rules.yml` named `caia-no-raw-shadcn-import-outside-ui-package`, `caia-no-raw-radix-outside-ui-package`, `caia-no-inline-tailwind-in-customer-facing-app`, `caia-no-raw-axios-outside-http-client`, `caia-no-raw-better-sqlite3-outside-persistence` block the same patterns at PR-diff time.

**Consequence when violated.** PR fails the `reuse-advisory-blocking` and `semgrep` required checks. The escape hatch is the `reuse-advisory-escape` label, which the EA-reviewer applies after recording the one-off rationale on the PR. Operator does NOT need to repeat the rule in agent context — the gates above carry it.

## Build, test, lint, typecheck

```bash
pnpm install              # install workspace deps (pnpm@9, lockfile is committed)

pnpm build                # turbo build across all workspaces
pnpm typecheck            # turbo typecheck (tsc --noEmit per workspace)
pnpm test                 # turbo test (vitest in most packages, jest in some)
pnpm lint                 # turbo lint (eslint per workspace)

# Single-package targeting:
pnpm --filter @chiefaia/<pkg-name> build
pnpm --filter @chiefaia/<pkg-name> test
pnpm --filter @chiefaia/<pkg-name> typecheck

# Evidence Gate aggregates (run before opening a PR):
pnpm evidence:tsc         # whole-repo typecheck
pnpm test:regression      # regression suite
```

Test runners: vitest is the default for new packages; a few legacy ones still use jest (`@caia-app/core` regression suite). Playwright lives in `packages/playwright-config` and is consumed by E2E suites in apps.

## Code style (non-negotiable)

- TypeScript `strict: true`, `exactOptionalPropertyTypes: true`, `noUncheckedIndexedAccess: true`, `noImplicitOverride: true`. No relaxing these flags.
- No `any`. No `@ts-ignore`. Use `unknown` + narrow, or fix the type.
- ESM only (`"type": "module"`, `module: "NodeNext"`). Use `.js` import suffixes in source.
- Functional patterns preferred. Functions <50 lines. Early returns. No nesting >4 levels.
- Comments explain WHY (constraint, invariant, workaround). Don't comment WHAT — names should carry it.
- File layout: `src/` for code, `tests/` for tests, `dist/` for build output (gitignored).

## Canonical branch (STANDING RULE 2026-05-25 — see `docs/adr/ADR-016-develop-canonical-main-mirror.md`)

**`develop` is the canonical integration branch. `main` is a fast-forwarded mirror of `develop`.**

- ALL new feature branches MUST be cut from `origin/develop` (never from `origin/main`).
- ALL new PRs MUST target `develop`. `gh pr create` requires `--base develop` until the operator flips the GitHub UI default-branch setting (operator TODO #2).
- `main` is updated only by the auto-sync workflow `.github/workflows/sync-main.yml`, which fast-forwards `main` to `develop`'s tip on every push to `develop`. Never push directly to `main`.
- The old "release/<date> PR to main → merge → tag" cycle is **retired**. No more periodic develop→main back-merges; the auto-sync workflow makes them redundant.
- Background and full rationale: standing rule `~/Documents/projects/agent-memory/standing_rule_develop_canonical_2026-05-25.md`; one-time reconcile audit `reports/main_develop_reconcile_audit_2026-05-25.md`.

## Git Flow (enforced — see `feedback_git_flow_enforced.md`)

```
feature/<id>-<slug>  →  PR to develop  →  squash-merge  →  branch deleted
develop              →  auto-sync workflow fast-forwards main  →  no manual release PRs
main                 ←  auto-sync only; never manually pushed
backup/<reason>      ←  preservation only, never merged
```

- NEVER push directly to `main` or `develop`. Husky hooks + branch protection + the required `gitflow-conformance` CI check block this.
- One PR per logical unit. Open the PR as soon as you have a first commit; don't accumulate work on a branch without a PR.
- "Done" = merged into `develop` (the auto-sync workflow handles main mirroring), branch + worktree gone.
- Quickstart wrapper: `pnpm flow start <id>-<slug>` / `pnpm flow ready` / `pnpm flow ship`. The `pnpm flow release` step is no longer required (auto-sync replaces it). Full runbook: `docs/git-flow.md`.

## Evidence Gate (every PR — see `docs/evidence-gate.md`)

Six required CI contexts must be green before a PR can merge:

1. `Build·Test·Lint·Typecheck` — turbo aggregate
2. `gitflow-conformance` — no unwanted merge commits, correct base branch
3. `typecheck` — whole-repo strict tsc
4. `semgrep` — `.semgrep/caia-rules.yml` + auto rule set
5. `gitleaks` — secret scan
6. `bundle-size` — size-limit per package

Three warn-only: lighthouse, axe, visual baselines.

## Security (see `feedback_pat_topic.md`, `safety_hardening_2026-04-29.md`)

- NEVER hard-code secrets. Resolve at runtime via `scripts/get-vault-secret.sh` or the orchestrator's vault adapter.
- NEVER paste raw vault key names alongside literal values in fixtures (semgrep rule `caia-no-hardcoded-vault-keys` will reject the PR).
- Irreversible operations (gh push, deploy, delete, billing) MUST go through `@chiefaia/capability-broker`. Never call them directly from agent code.
- MCP server invocations MUST go through `@chiefaia/mcp-allowlist-proxy`. The allowlist lives in the proxy's config.
- Tool output that re-enters an LLM prompt MUST go through `@chiefaia/tool-output-sanitizer` (defends against prompt injection).
- LLM spend MUST go through `@chiefaia/spend-guard`. Subscription bucket only — see `feedback_no_api_key_billing.md`.
- The `feedback_pat_topic.md` rule is settled: plaintext tokens in operational locations (~/.bashrc, .env, plist, docker config) are intentional post-rotation copies; do NOT re-flag them as findings.

## Architectural conventions (Option E shape — STANDING RULE 2026-05-06)

Every CAIA agent built from this point forward follows the **CAIA-Bonded Skeleton** shape. See `agent/memory/agent_architecture_shape_2026-05-06.md`.

The five mechanical gates (Evidence Gate semgrep enforces them):

1. **Private package**: `package.json` has `"private": true` and scope `@chiefaia/<name>`. Never published to public npm.
2. **Parameterised public API**: every CAIA-specific path/topic/registry/integration is a constructor parameter with a CAIA default. NO hard-coded literals like `~/Documents/projects/caia/agent/memory`. Use `corpusRoot: string = '~/Documents/projects/caia/agent/memory'` instead.
3. **Fixture-corpus tests**: tests inject fake corpora; production injects CAIA defaults. If a test cannot be written without live CAIA paths, parameterisation is broken.
4. **Pre-spawn injection consumed**: agent reads task prompts AFTER Mentor + Librarian retrieval has prepended relevant lessons + precedent. Don't roll your own context layer.
5. **No second-customer abstraction**: configuration matrix is exactly one (CAIA). NO config files. NO multi-tenant API. NO OSS-style docs for unknown contributors.

Open-sourcing is NOT a priority (operator-explicit 2026-05-06). Configuration matrix stays one. Re-evaluation triggers documented in the standing-rule memory file.

## Hardened pipeline mechanisms (Wave 1 shipped 2026-04-29)

The pipeline ships with deterministic detection → idempotent rollback → bounded retry → escalation. When extending it, mirror this shape.

| Area | Mechanism | Reference |
|---|---|---|
| Failure recovery | `WorkerCrashRecovery` rolls back `assignedWorkerId/codingSessionId/phase2Status` in a transaction; escalates after `maxCodingAttempts` (default 3) | PR #159 |
| Cost tracking | `pipeline_run_costs` + `PipelineCostTracker`; alert when single run breaches `CAIA_PIPELINE_COST_ALERT_USD` | PR #162 |
| Resource cleanup | `WorktreeReaper` 5-min sweep of orphan worktrees; opt-in via `CAIA_WORKTREE_REAPER_ENABLED=1` | PR #166 |
| LLM resilience | `@chiefaia/local-llm-router` wraps dispatch in `breaker.exec(withRetry(withTimeout(...)))`; 60s timeout, 3 attempts | PR #169 |
| Observability | `/api/pipelines/:promptId/trace` returns prompt + stages + events + summary | PR #171 |
| Logging | `@chiefaia/logger` ships `DEFAULT_REDACT_PATHS` (32 patterns) | PR #175 |

Worktree cap = 8 concurrent. Going above triggers a Steward alarm. See `feedback_operational_discipline.md`.

## Gotchas (read before editing the relevant area)

- **Drizzle multi-statement migrations need explicit `--> statement-breakpoint` markers.** A migration that bundles `ALTER TABLE` + `CREATE INDEX` in one SQL string will execute as a single statement and fail mid-way without rollback. Always split with breakpoints. Bit us in PR #287/#285.
- **NEVER use `gh pr update-branch`.** It creates merge commits that violate `gitflow-conformance`. To bring a feature branch up to date, rebase locally on `develop` (or use `git merge --ff-only develop` from local, then push). The CAIA flow assumes linear feature-branch history.
- **NEVER use `gh pr merge --admin`** — with one carve-out below. By default, `--admin` bypasses required status checks; semgrep rule `caia-no-admin-merge` blocks it.

  **TRUE-ZERO EXCEPTION (build phase only).** During the CAIA build phase, the operator's True-Zero standing rule (`~/Documents/projects/agent-memory/standing_rule_true_zero_before_new_pr_2026-05-13.md`) permits admin-squash-merge when, and only when, ALL of:
  1. The build-phase marker file `.caia/build-phase-active` exists at the repo root (orchestrator-maintained; absence ⇒ exception does not apply).
  2. The standard `pnpm flow ship` path is unavailable because either (a) the PAT in scope cannot bypass required status checks at org-admin level, or (b) pre-existing dev-broken checks unrelated to the PR's diff are wedging the merge.
  3. Evidence Gate locally passed on the PR's own contents (`pnpm typecheck && pnpm test && pnpm lint && semgrep ci --config=auto --config=.semgrep/caia-rules.yml`) — `--admin` is a CI-bypass, not a correctness-bypass.

  **Procedure** (same pattern as PRs #574 / #575 / #580):
  ```bash
  # 1. Temporarily flip enforce_admins=false on develop's branch protection
  gh api -X PUT "/repos/prakashgbid/caia/branches/develop/protection/enforce_admins" -f enabled=false

  # 2. Admin-squash-merge the PR
  gh pr merge <PR> --squash --admin --delete-branch  # TRUE-ZERO-MERGE

  # 3. Immediately restore enforce_admins=true (DO NOT skip — leaving it off is a security regression)
  gh api -X PUT "/repos/prakashgbid/caia/branches/develop/protection/enforce_admins" -f enabled=true
  ```

  **Commit-message tag.** The squash-merge commit MUST include `[True-Zero admin-merge]` in the title or trailer so the audit trail is greppable. Example title:
  `chore(governance): document True-Zero admin-merge exception [True-Zero admin-merge] (#NNN)`

  Outside the build phase (when `.caia/build-phase-active` is absent), this exception does not apply and `--admin` is forbidden. The marker file is removed by the orchestrator at build-phase exit.
- **NEVER `git push --force` outside `backup/*`.** Semgrep rule `caia-no-force-push-non-backup` blocks this.
- **Custom semgrep rules live in `.semgrep/caia-rules.yml`.** Run them locally with `semgrep ci --config=auto --config=.semgrep/caia-rules.yml`. The Evidence Gate runs the same set.
- **`required_linear_history` is OFF on `develop`** (since 2026-05-03) to allow classic back-merges from release branches. `gitflow-conformance` still rejects unwanted merge commits inside feature PRs.
- **Memory directory is operator-controlled and lives OUTSIDE the repo** at `~/Library/Application Support/Claude/local-agent-mode-sessions/<session>/agent/memory/`. Some legacy paths reference `caia/agent/memory` — those are stale. New code parameterises `corpusRoot` and reads it from constructor args.
- **Sites (pokerzeno, stolution, etc.) live in their own repos.** Do not vendor them in. Do not edit them from this repo.
- **Apps in `apps/*` are runtime services consuming agent packages.** Don't put reusable agent logic there — push it into `packages/<agent-name>/`.
- **Templates in `templates/site/` and `templates/utility/` contain `{{PLACEHOLDER}}` syntax.** They are NOT workspace members; they are scaffolds. Don't `tsc` them directly.

## How to make a change (mini-runbook)

1. **Read first.** Check `agent/memory/MEMORY.md` for relevant standing rules. Check `docs/` for the affected area's runbook (e.g. `docs/git-flow.md`, `docs/evidence-gate.md`, `docs/capability-broker.md`).
2. **Cut a feature branch.** `pnpm flow start <id>-<slug>` from a clean `develop`.
3. **Work in small commits** with conventional-commit messages (`feat(scope): subject` / `fix(scope): subject` / etc.).
4. **Run the full local check before opening the PR.** `pnpm typecheck && pnpm test && pnpm lint && semgrep ci --config=auto --config=.semgrep/caia-rules.yml`.
5. **Open the PR to `develop`.** `pnpm flow ready` — opens a draft PR if not yet ready, marks ready when CI is green.
6. **Wait for Evidence Gate.** All six required contexts must be green. If a context fails, fix root cause; never bypass with `--admin`.
7. **Squash-merge.** `pnpm flow ship` — merges + deletes branch.
8. **End-of-day release.** `pnpm flow release --auto` — opens release PR `develop → main`, merges when CI green.
9. **Confirm "Done" per `feedback_definition_of_done.md`** — branch merged into BOTH develop AND main, branch + worktree gone, regression suite green.

## See also

- `agent/memory/MEMORY.md` — standing rules index (always-loaded)
- `agent/memory/agent_architecture_shape_2026-05-06.md` — Option E standing rule
- `agent/memory/feedback_git_flow_enforced.md` — git flow rule
- `agent/memory/evidence_gate_2026-04-29.md` — evidence gate rule
- `agent/memory/feedback_definition_of_done.md` — DoD checklist
- `docs/git-flow.md` — operator runbook for git flow
- `docs/evidence-gate.md` — evidence-gate runbook
- `docs/capability-broker.md` — irreversible-action gating
- `docs/mcp-security.md` — MCP allowlist runbook
- `docs/prompt-injection-defense.md` — sanitizer runbook
- `docs/spend-guard.md` — LLM spend gating
- `.semgrep/caia-rules.yml` — custom semgrep rules
