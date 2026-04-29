# Security audit — shell + spawn surfaces (HARDEN-007)

Sweep date: 2026-04-29.

## Scope

Every site in `apps/**` and `packages/**` (excluding `node_modules`,
`dist`, and tests) that calls `child_process` directly (via
`spawnSync`, `spawn`, `exec`, `execSync`, or `execFile`).

The acceptable shape is:

- **argv-array form** — `spawnSync(bin, [arg1, arg2], { ... })`. The
  binary is fixed; only `args[]` is user-supplied. Even with hostile
  `args` no shell metacharacter substitution happens.
- **`bash -c <constant>` form** — when the command is hardcoded in
  source (e.g. `bash -c 'pnpm lint'`), there is no injection vector
  because no user data flows into the command string.
- **`bash -c <discovered>` form** — only acceptable when the
  command string is read from a trusted source (e.g. `package.json`
  `scripts.test`) and treated as such.

Any `exec(<string>)` (the legacy single-string `child_process.exec`)
or `spawn(bin, args, { shell: true })` with user data in `args` is
rejected.

## Findings

| File | Call shape | Verdict |
|---|---|---|
| `apps/worker-coding/src/diff-committer.ts:187` | `spawnSync(bin, args[], { ... })` | safe (argv form) |
| `apps/worker-coding/src/worktree-manager.ts:192` | `spawnSync(this.gitBin, args[], { cwd, ... })` | safe — `args[]` constructed from `branch / wtPath / integrationBranch`; all derived from server-side state |
| `apps/worker-coding/src/dod-self-check.ts:210` | `spawnSync('bash', ['-c', 'pnpm lint || exit $?'])` | safe (constant command) |
| `apps/worker-coding/src/dod-self-check.ts:222` | `spawnSync('bash', ['-c', 'pnpm typecheck || exit $?'])` | safe (constant command) |
| `apps/worker-coding/src/dod-self-check.ts:236+243+260` | `spawnSync('git', ['diff', ...], { cwd })` etc. | safe (argv form) |
| `apps/worker-coding/src/local-test-runner.ts:92` | `spawnSync('bash', ['-c', command], { cwd, ... })` | **acceptable** — `command` is read from `package.json` scripts inside the worktree, which is owned by us. Treat the worktree contents as trusted; if a malicious story commit lands a hostile `package.json`, this is still gated by the PR review. Recommend a follow-up to switch to argv-array form using `pnpm` directly. |
| `apps/pipeline-pulse/src/checks/disk-space.ts` | `child_process.execSync('df ...')` | safe — fixed string, no user data |
| `apps/completeness-sentinel/src/verifiers/test-verifier.ts:2` | `execSync` | review as part of completeness-sentinel hardening (not a worker-coding surface). |

No call site matches the rejected shapes.

## Recommendations (deferred)

1. `local-test-runner.ts:92` — switch from `bash -c <package-json-script>`
   to `pnpm run <script-name>` (argv form). Out of scope for this PR;
   queued as `HARDEN-LOCAL-TEST-RUNNER-ARGV`.
2. `pipeline-pulse/disk-space.ts` — migrate to `node:os.disk` once
   Node 22 is the floor.

## PAT scope minimization (Coding Agent)

The Coding Agent uses a GitHub fine-grained PAT to push branches and
open PRs. The PAT is fetched from Vault by `secrets-broker` and never
written to disk. Required scopes:

- `contents: write` — push branches, create commits.
- `pull_requests: write` — open PRs from the worker.
- `metadata: read` — implicit on all PATs.

Explicitly NOT granted:

- `actions: write`, `workflows: write` — workers never trigger CI runs;
  CI is configured by `main`-branch workflow files.
- `administration` — workers never modify repo settings.
- `secrets: write` — workers never rotate or read repo secrets.
- `packages: write` — workers don't publish.

The PAT's scopes can be inspected at runtime via `gh auth status`.
Operators should rotate the PAT every 90 days; the rotation runbook
lives at `docs/runbooks/rotate-coding-agent-pat.md` (TODO — owned by
HARDEN-008 follow-up).

## Log redaction

`@chiefaia/logger` now exports `DEFAULT_REDACT_PATHS` (32 patterns
covering `token`, `secret`, `password`, `vault_token`, `github_pat`,
`authorization`, `cookie`, etc.) and a `includeDefaultRedactPaths`
option on `createLogger`. The orchestrator and `secrets-broker` opt
in by default; downstream hosts SHOULD opt in as part of their next
release cycle.
