# `apps/wizard` + `apps/dashboard` — `WIZARD_AUTH_MODE` three-mode env-var branch

**Author:** autonomous-build (operator-dispatched 2026-05-26)
**Status:** Implementation complete
**ADR refs:** ADR-065 (reuse-first as enforced discipline)
**Branch:** `feature/wizard-middleware-cf-bypass-mode-2026-05-26`
**True-Zero admin-merge:** RATIFIED (subscription-only Claude Max; `.caia/build-phase-active` carve-out continues to apply).

## 1. Why this exists

Cloudflare Access has an IP-allowlist policy (precedence=1) that bypasses the Access login for the operator's Mac WAN IP `69.118.44.175` when reaching `dashboard.chiefaia.com` and `ops.chiefaia.com`. The bypass policy returns a 200 instead of issuing a `CF_Authorization` JWT cookie. But the Next.js middleware added in PR #601 (later renamed in PR #622) requires the cookie unconditionally and 307-redirects to `/sign-in` when it's missing — defeating the bypass.

This PR adds an env-var-driven branch to the middleware:

- `WIZARD_AUTH_MODE=cloudflare` (default) — strict JWT, current behaviour.
- `WIZARD_AUTH_MODE=cf-edge-only` — defence-in-depth bypass: `Cf-Ray` + `Cf-Connecting-Ip` allow-list + `X-Caia-Edge-Token` shared-secret match → resolve tenant from `BYPASS_TENANT_EMAIL`. Any failure → falls through to the strict JWT path.
- `WIZARD_AUTH_MODE=disabled` — middleware no-op (local dev only).

Both apps ship the same middleware shape, and the production ConfigMaps both flip to `cf-edge-only` so the operator can reach both `dashboard.chiefaia.com` and `ops.chiefaia.com` without a sign-in prompt, while non-allowlisted clients continue to be gated by Cloudflare Access at the edge.

## 2. Scope of this PR

### 2.1 In scope

1. **`apps/wizard/middleware.ts`** — add the env-var branch; default behaviour (cloudflare) is unchanged byte-for-byte.
2. **`apps/wizard/lib/auth/edge-bypass.ts`** — new module: `readAuthMode()` + `tryEdgeBypass()`. Pure functions, no Next.js imports, fully testable.
3. **`apps/dashboard/middleware.ts`** — verbatim port of (1), with REUSE-FIRST EXCEPTION marker pointing at the B-task to extract `@chiefaia/wizard-auth`.
4. **`apps/dashboard/lib/auth/*` + `apps/dashboard/lib/tenants/*`** — verbatim port of the wizard's auth + tenants modules, marked the same way.
5. **`apps/dashboard/app/sign-in/page.tsx`** — verbatim port of the wizard's `/sign-in` page so the strict-JWT fallback target exists.
6. **Tests** — `tests/wizard-shell/edge-bypass.test.ts` (14 cases) + `tests/wizard-shell/middleware.test.ts` (11 cases) on the wizard; mirrored under `apps/dashboard/tests/auth-gate/` (25 cases there too).
7. **Infra:**
   - `infra/wizard/30-configmap.yaml` and `infra/dashboard/30-configmap.yaml` both set `WIZARD_AUTH_MODE=cf-edge-only`, `BYPASS_ALLOWED_IPS=69.118.44.175`, `BYPASS_TENANT_EMAIL=prakash.stolution@gmail.com`.
   - `10-deployment.yaml` checksum annotations bumped to `v2-cf-edge-only-2026-05-26` so the pod restart picks up the ConfigMap on apply.
8. **READMEs** — `infra/wizard/README.md` and `infra/dashboard/README.md` both document the env vars, the security caveat, and the Cloudflare WAF Transform Rule setup operator follow-up.

### 2.2 Out of scope (sibling PRs own these)

- Extracting `@chiefaia/wizard-auth` as a shared workspace package (B-task; tracked below).
- The Cloudflare WAF Transform Rule itself (operator action — Cloudflare dashboard, not in this repo).
- WARP+Touch-ID flow which will ultimately deprecate `cf-edge-only` mode entirely.

## 3. Reuse-first compliance

The cross-app duplication of `lib/auth/*` + `lib/tenants/*` + `middleware.ts` is explicitly marked with the `REUSE-FIRST EXCEPTION: short-lived duplicate, refactor to shared package tracked at follow-up B-task` comment + a TODO ADR line at the top of every duplicated file. The reuse-check-strict + Semgrep rules from PRs #599 / #600 honour the marker per spec.

No raw `axios`, `node-fetch`, or `better-sqlite3` introduced. No new `@chiefaia/*` packages added. The cross-app dup is intentional and short-lived.

## 4. ReuseSearchResults

| Candidate package | Considered for | Decision | Reason |
| --- | --- | --- | --- |
| `@chiefaia/wizard-auth` | shared middleware + auth helpers | **rejected — does not exist yet** | The package would be the right home for the middleware + `lib/auth/cf-access` + `lib/tenants/*` modules. It does not exist on develop, and the operator's instruction was to inline the duplication and track extraction as a B-task. Marked with REUSE-FIRST EXCEPTION on every duplicated file. |
| `@chiefaia/http-client` | Cloudflare JWKS fetch | rejected — does not exist yet | AGENTS.md references it; not shipped. `jwks-cache.ts` uses native `fetch`. |
| `@chiefaia/secrets-infisical` | tenant Infisical provisioning | rejected for create-path | The package wraps the secrets-data CRUD, not workspace creation. `lib/tenants/infisical.ts` keeps its hand-rolled admin client. |
| `@caia/ui` | sign-in page primitives | **selected** | `app/sign-in/page.tsx` (both apps) consumes Card / Button only from `@caia/ui`. |
| `jose` | JWT verification | **selected (already in use)** | `lib/auth/jwks-cache.ts` uses `jose`'s `createRemoteJWKSet` + `jwtVerify`. Unchanged in this PR. |
| `node:crypto` (`timingSafeEqual`) | secret comparison | **selected** | `lib/auth/edge-bypass.ts` uses `timingSafeEqual` for the `X-Caia-Edge-Token` ↔ `EDGE_SHARED_SECRET` compare. Length-mismatch fallthrough handled explicitly to avoid leaking expected length. |
| `pg` | tenant store | **selected (already in use)** | `lib/tenants/store.ts` uses the `pg` driver directly. AGENTS.md's `@chiefaia/persistence-postgres` does not exist yet. |
| `@chiefaia/event-bus-nats` | tenant.provisioned publish | **selected (already in use)** | `lib/tenants/wire.ts`'s `HybridEventBus` routes the event when the env flag flips. Unchanged in this PR. |

## 5. Test strategy

| Layer | Files | Cases |
| --- | --- | --- |
| Wizard unit (pure) | `tests/wizard-shell/edge-bypass.test.ts` | 14 |
| Wizard integration | `tests/wizard-shell/middleware.test.ts` | 11 |
| Dashboard unit (pure) | `tests/auth-gate/edge-bypass.test.ts` | 14 |
| Dashboard integration | `tests/auth-gate/middleware.test.ts` | 11 |
| **Total** | | **50** |

Cases cover the mode × JWT × bypass-header matrix:
- `disabled` mode short-circuits regardless of cookie / headers.
- `cloudflare` mode: no-cookie → 307, bad-JWT → 307, good-JWT → 200 + tenant headers.
- `cf-edge-only` mode: all 3 checks pass → 200 (operator tenant); any check fails → falls through to strict JWT (307 if no cookie); valid bypass AND JWT cookie both present → bypass wins.
- Edge cases: empty `BYPASS_ALLOWED_IPS`, missing `EDGE_SHARED_SECRET`, malformed `BYPASS_TENANT_EMAIL`, length-mismatched edge token, unknown `WIZARD_AUTH_MODE` value → fails closed to strict mode.

## 6. Definition of Done

- [x] `apps/wizard/middleware.ts` extended; default behaviour unchanged byte-for-byte.
- [x] `apps/dashboard/middleware.ts` created (verbatim port).
- [x] `apps/dashboard/lib/auth/*` + `apps/dashboard/lib/tenants/*` duplicated with REUSE-FIRST EXCEPTION markers.
- [x] `apps/dashboard/app/sign-in/page.tsx` created.
- [x] 50 vitest cases pass across both apps.
- [x] Both `infra/{wizard,dashboard}/30-configmap.yaml` flipped to `cf-edge-only`.
- [x] Both `10-deployment.yaml` checksum annotations bumped.
- [x] Both READMEs document the env vars + Transform Rule setup + security caveat.
- [ ] PR merged via True-Zero admin-merge squash.
- [ ] `EDGE_SHARED_SECRET` generated and stashed in both K8s Secrets.
- [ ] Both deployments rolled out.
- [ ] `curl -I https://dashboard.chiefaia.com` and `curl -I https://ops.chiefaia.com` from the operator's Mac IP return HTTP 200 (not 307).

## 7. Follow-up B-task: extract `@chiefaia/wizard-auth`

Track in `agent-memory/` once this PR lands. Scope:

- Move `apps/wizard/lib/auth/*` + `apps/wizard/lib/tenants/*` into a workspace package `packages/wizard-auth/`.
- Move the middleware factory into the same package; both apps import `createWizardMiddleware()` and pass app-specific config (matcher, sign-in path).
- Remove the REUSE-FIRST EXCEPTION markers from both apps and delete the duplicated `apps/dashboard/lib/auth/*` + `lib/tenants/*` trees.
- Same env-var contract; same tests move into `packages/wizard-auth/tests/`.
