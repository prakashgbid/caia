# `@caia/secrets-adapter`

> Provider-agnostic multi-tenant secrets contract.

The `SecretsAdapter` interface is the **single line CAIA application code crosses
to read or write any tenant credential**. The concrete adapter — Postgres
encrypted-column (`@caia/secrets-postgres`) for Phase-1 bootstrap, Infisical
project-per-tenant (`@caia/secrets-infisical`) for Phase-1 hot path, and
whatever comes in Phase-3 — lives behind this interface. Provider swaps become
a Friday-afternoon exercise.

## What's in the box

- **`SecretsAdapter`** — `put` / `get` / `list` / `rotate` / `delete` /
  `deleteAllForTenant` / `auditLog` / `ping`.
- **`AccessContext`** — mandatory caller envelope (`callerType` ∈
  `agent|user|deploy-worker|cron|system`, `callerId`, optional `ticketId` /
  `capabilityTokenId` / `requesterIp`, free-form `reason` ≤ 500 chars). Passed
  on every `get` so the *adapter* writes the audit row — making it
  impossible-by-construction to fetch a secret without an audit trail.
- **`AccessLogEntry`** — one row per access (success and failure). `ok=false`
  rows are still recorded; failed-fetch is signal.
- **`SecretMetadata`** — metadata only, never the secret value.
- **Typed errors** — `SecretNotFoundError` / `SecretPolicyDeniedError` /
  `SecretRateLimitedError` / `SecretProviderError` mapping cleanly to
  `AccessLogEntry.errorClass`.
- **Zod schemas** — runtime validation of every payload that crosses the
  adapter boundary.

## Reference

`research/multi_tenant_secrets_architecture_2026.md` §5 + §6.
