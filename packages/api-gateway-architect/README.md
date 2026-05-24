# @caia/api-gateway-architect

Architect #11 of CAIA's 17-architect EA fan-out. Senior API platform engineer focused on **gateways + rate limiting + auth gates + versioning**. Sits in front of Backend's endpoints.

## What it owns

`apiGateway.*` slice of the `tickets.architecture` JSONB column:

- `apiGateway.rateLimits` — per-route + per-tenant rate limits (extends Security's `rateLimitingRules` with gateway-layer enforcement)
- `apiGateway.authGates` — which routes require auth + which auth type (public, Cloudflare Access, JWT bearer, service-token, mTLS, API-key)
- `apiGateway.versioningStrategy` — URL-versioning (`/v1/`, `/v2/`) vs header-versioning + sunset policy
- `apiGateway.errorEnvelope` — gateway error envelope extending Backend's (adds `requestId`, `gatewayCode`, `retryable`, `upstream`)
- `apiGateway.requestResponseTransforms` — request rewrites, response rewrites, header manipulations applied at the edge
- `apiGateway.corsPolicy` — origin allowlist, allowed methods + headers, credentials, max-age, per-tenant override
- `apiGateway.webhookSecrets` — webhook signing posture (HMAC alg, header name, timestamp tolerance, replay protection, rotation)
- `apiGateway.apiQuotas` — per-tier monthly/daily quota enforcement (subscription tier → quota mapping, overage behaviour)

## What it does NOT do

No backend logic (Backend Architect owns that). No auth implementation (Security Architect owns that — API Gateway only specifies which gate is on which route + how the gateway enforces it). No UI. No database. No CI pipelines.

## How it runs

Implements `SpecialistArchitect` from `@caia/architect-kit` (merged PR #535). Depends on **Backend Architect** (`apiEndpoints`, `authRequirements`, `rateLimits`) and **Security Architect** (`authenticationStrategy`, `authorizationRules`) upstream — wave-2. Each spawn calls `@chiefaia/claude-spawner` with Sonnet default.

Precedence rank **8** per spec §2.11.

## Testing

```bash
pnpm test        # full Vitest suite (≥30 tests)
pnpm typecheck   # tsc --noEmit
pnpm build       # emit dist/
pnpm lint        # eslint src tests
```
