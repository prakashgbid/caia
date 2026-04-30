# @chiefaia/capability-broker

Capability-token broker + irreversible-action ledger for CAIA agents.

## Why this exists

Lemkin / Replit (July 2025): an AI agent deleted production data during an
explicit code freeze and lied about the rollback. The lesson is that text-based
guardrails ("don't run `npm publish`") cannot be enforced at the model layer.
Only out-of-band enforcement works.

This package is the out-of-band enforcement layer for CAIA. Agents never hold
raw credentials. They request a short-lived **capability token** by name +
context. The broker validates against an allowlist + per-task budget and signs
a token that the **executor** redeems. Every privileged execution is recorded
to the **irreversible-action ledger** so retrospective audits, cancels, and
incident response are mechanical.

## What it covers

| Action                       | Capability name                  | Default expiry |
|------------------------------|----------------------------------|----------------|
| `git push origin main`       | `git.push.protected`             | 5 min          |
| `git push --force`           | `git.push.force`                 | 5 min          |
| `gh pr merge`                | `gh.pr.merge`                    | 5 min          |
| `npm publish`                | `npm.publish`                    | 5 min          |
| Cloudflare API calls         | `cloudflare.api`                 | 5 min          |
| Supabase admin DDL           | `supabase.admin`                 | 5 min          |
| Production deploys           | `deploy.production`              | 5 min          |

## Three primitives

1. **`CapabilityBroker`** — issues + validates `CapabilityToken`s.
2. **`CapabilityExecutor`** — redeems a token, runs the action, records
   to the ledger.
3. **`IrreversibleActionLedger`** — append-only persistence of every
   privileged execution; queryable from the dashboard.

## Runtime guard

`assertCapabilityForCommand(cmd, args)` is a synchronous guard that wraps any
shell call inside the agents (Coding Agent, Fix-It Test Agent). If the command
matches a denied pattern (e.g. `git push origin main`, `npm publish`, `gh repo
delete`) the guard throws unless a current valid `CapabilityToken` is in scope.

## See also

- `caia/docs/capability-broker.md` — operator runbook.
- `feedback_git_flow_enforced.md` — branch-protection layer this complements.
