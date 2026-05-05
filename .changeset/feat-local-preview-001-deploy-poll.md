---
"caia": patch
---

feat(local-preview-001): deploy.ts + poll-loop.ts + integration test (PR-B)

Adds the end-to-end deploy pipeline and the polling daemon to
`apps/local-preview-orchestrator/`, building on the PR-A skeleton (#312).

New modules:

- `src/shell-runner.ts` — injectable bash command executor with timeout +
  exit-code capture. Trust boundary: commands originate from compile-time
  SITES registry only.
- `src/git-ops.ts` — `fetch`, `resolveBranchSha`, `worktreeAdd`,
  `worktreeRemove` over the shell-runner. Strict-allowlist `shellEscape`
  for any token that might contain shell metacharacters.
- `src/deploy.ts` — the full deploy state machine: lock → fetch → compare
  → disk-check → worktree-add → build → copy artifacts → atomic-swap →
  restart → health-check → (rollback on failure) → prune → cleanup →
  state-write. Every failure mode returns a typed `DeployResult` rather
  than throwing.
- `src/poll-loop.ts` — 30s polling daemon. Per-site coalescing via an
  in-flight set; iteration is testable in isolation via `pollIteration`.
- `src/site-state.ts` — atomic JSON state writer the (PR-C) status
  dashboard will read.

Tests added (42 new, 71 total in this app):

- Unit tests for `shell-runner` (timeout / cwd / exit codes), `git-ops`
  (command shape + escape rules + error propagation), `site-state`
  (read/write/update + corrupt-json fallback), `deploy` (happy path,
  noop, build-failed, health-check rollback, rollback-failed, locked,
  missing-artifact), `poll-loop` (iteration, abort-during-sleep,
  in-progress reporting, error capture, max-iterations).
- Integration test (`deploy.integration.test.ts`) that initialises a
  real fixture git repo, runs `deploySite` end-to-end with the real
  `defaultShellRunner` + `makeGitOps`, and asserts: artifacts copied,
  symlink swapped, state.json reflects success, second invocation is
  noop, third invocation (after a new commit) succeeds with `previous`
  pointing at v1, and a build-failed deploy leaves `current` untouched.

No runtime side effects until PR-D wires the LaunchAgents.

References: `~/Documents/projects/reports/local-preview-deploys-analysis.md`,
`agent/memory/steward_local_preview_deploys_directive.md`.
