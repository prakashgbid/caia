# @caia/security-architect

Architect #10 of CAIA's 17-architect EA fan-out. Senior security engineer focused on OWASP top-10 mitigations, authentication (Cloudflare Access / OAuth / JWT), authorization (RBAC + ABAC), secrets handling (forward-reference to `@caia/secrets-adapter`), and multi-tenant isolation (per-tenant Postgres schema isolation + scoped credentials).

## Position in the architect fan-out

- **Wave**: 2 (depends on Backend Architect + Database Architect).
- **Precedence rank**: **1 (highest)** per spec §5.2.
- **Runtime model**: Sonnet.

## What it owns

`security.*` slice of the `tickets.architecture` JSONB column:

- `security.authenticationStrategy`
- `security.authorizationRules`
- `security.secretsHandling`
- `security.owaspMitigations` (covers ALL OWASP Top-10 2021 categories)
- `security.securityHeaders`
- `security.inputValidation`
- `security.rateLimitingRules`
- `security.auditLogRequirements`
- `security.tenantIsolationGuarantees`

## What it does NOT do

No component code, no API endpoint implementations, no SQL DDL, no CI/CD, no UI. Security specifies how every endpoint is authenticated, authorized, rate-limited, and audited.

## Quick start

```ts
import { SecurityArchitect, SecurityArchitectContract } from '@caia/security-architect';

const architect = new SecurityArchitect();
const output = await architect.run({
  ticket, businessPlan, designVersion, tenantContext,
  upstream: { outputs: { backend, database } },
  budget: {
    maxInputTokens: 60_000, maxOutputTokens: 8_000,
    maxWallClockMs: 60_000, preferredModel: 'sonnet',
    hardCostCeilingUsd: 0.5,
  }
});
```

## Testing

```bash
pnpm test        # full Vitest suite (>=30 tests, including OWASP top-10 golden)
pnpm typecheck   # tsc --noEmit
pnpm build       # emit dist/
pnpm lint        # eslint src tests
```

The test suite includes interface compliance, contract structural checks, registration disjointness vs frontend + backend + database, output validation, run() idempotency, dependency declaration (`['backend','database']`), cross-architect invariants (OWASP coverage, CSP strict-dynamic, HSTS preload, deny-by-default, defence-in-depth tenant isolation, never-log secrets, required audit events), and an end-to-end golden test against a known prakash-tiwari contact-form Story ticket.

## Why precedence rank 1

Security holds rank 1 in the canonical precedence ladder (spec §5.2). When two architects disagree semantically (e.g. Frontend wants a Calendly embed, Security wants `frame-src 'none'`), the Dispatcher resolves by precedence — Security's field survives, the loser's field carries a `_dissent` annotation. Operator override is the only escape valve, and it requires Reviewer acknowledgement.

## Forward references

- `@caia/secrets-adapter` — runtime implementation of `secretsHandling.provider: "vault"`.
- `@chiefaia/capability-broker` — irreversible-action gating for operator-elevated cross-tenant break-glass.
- `@chiefaia/secrets-broker` — older sibling; the adapter supersedes it.
