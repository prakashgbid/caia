# Contributing to CAIA

CAIA is **AI-first**: nearly every commit here is authored by an autonomous agent.
Humans (the operator + ratifier) act as reviewers and gate-keepers, not typists.
That constraint shapes every rule below.

## Ground rules

1. **Trunk-based, single-branch.** Long-lived branches: `main` only.
   `develop` is deprecated and MUST NOT be re-added. Ephemeral feature branches
   are opened by the task-env-provisioner and auto-deleted on merge.
2. **Definition of Done ([[dod-hard-rule]]).** A PR being *opened* is not done.
   Done = merged + deployed + live + wired into use.
3. **No temporary work ([[no-temporary-work]]).** No stopgaps, no "we'll fix it
   later", no interim solutions. Build the proper long-term fix or wait.
4. **No cost without sign-off ([[cost-signoff-rule]]).** Every new SaaS, paid
   API, or recurring subscription needs explicit operator approval.
5. **Self-hosted CI only ([[ci-cost-elimination-direction]]).** Never introduce
   a workflow that runs on GitHub-hosted runners.

## Branch & PR conventions

- Branch name: `sf-XX/short-slug` or `kernel-X/short-slug` or `infra/short-slug`.
- PR title: `[SF-XX] Short imperative description` — enforced by
  `.github/workflows/pr-title-check.yml`.
- Commit style: Conventional Commits with SF-scope, e.g.
  `feat(SF-42): implement generate-code microfactory`.
- Squash-merge on green CI. No merge commits on `main`.

## Local setup

```bash
pnpm install
uv sync
pnpm husky init  # first time only
```

## Adding a new microfactory (SF-XX)

1. `scripts/scaffold-sf.sh SF-XX <slug>` (once STOL-1035 lands the scaffold)
2. Write the input/output contract first in `packages/contracts/schemas/`
3. Add tests in `apps/sf-XX-<slug>/tests/`
4. Implement the smallest thing that satisfies the contract
5. Wire OTel spans, `/health`, and SLO annotations
6. Open PR — CI runs on self-hosted runner + free-LLM review

## Reference docs

- Master blueprint: [`docs/EA/designs/caia-141-microfactory-master-blueprint.md`](./docs/EA/designs/caia-141-microfactory-master-blueprint.md)
- Master epic: [STOL-1034](https://thivaan.atlassian.net/browse/STOL-1034)
