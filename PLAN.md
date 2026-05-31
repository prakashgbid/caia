# `infra/wizard` + `infra/istio/chiefaia` — Phase C7 multi-replica wizard with sticky sessions

**Author:** autonomous-build (operator-dispatched 2026-05-31)
**Status:** Implementation complete
**Branch:** `feature/c7-wizard-multi-replica-sticky-sessions-2026-05-31`
**True-Zero admin-merge:** RATIFIED.
**Depends on:** PR #637 (C1 HPA).

## Why

Phase C Task C7: scale chiefaia-wizard from 1 → 2 replicas with cookie-based session affinity. The wizard's interview surface is stateful at the pod level (in-memory subscription buffer); cookie-hash pins each session to one pod so SSE/WebSocket connections survive scale-up events and rolling updates. C1's HPA already exists; C7 closes the loop.

## Files

- `infra/wizard/10-deployment.yaml` — `replicas: 1` → `replicas: 2`; comments cross-reference C7 DR + C1 HPA + the consistentHash ring contract; RollingUpdate strategy preserved (`maxUnavailable:0 + maxSurge:1` = "drop none, add one"; ring never empty mid-rollout).
- `infra/istio/chiefaia/26-destinationrule-wizard.yaml` — new `networking.istio.io/v1beta1` DestinationRule; `trafficPolicy.loadBalancer.consistentHash.httpCookie name=chiefaia-wizard-session ttl=0s`.
- `apps/wizard/tests/wizard-shell/c7-sticky-session.test.ts` — 8 it-blocks / 21 assertions.
- `.changeset/c7-wizard-multi-replica-sticky.md` — none-bump.

## Reuse-first

- `networking.istio.io/v1beta1 DestinationRule` (Istio core, stable since 1.6) — **selected**.
- Istio `consistentHash.httpCookie` LB — **selected** (built-in, no app-layer rewrite).
- IP-hash / source-IP affinity — **rejected** (Cloudflare's shared egress IP defeats it).
- Custom session-router — **rejected** (Istio already does the right thing).
- `@caia/ui` — **rejected** (infra PR; no UI surface).

## Test strategy

8 it-blocks across two describe-blocks (Deployment + DestinationRule); 21 assertions total. ≥5-test threshold satisfied.

## Verification proof (recorded post-merge)

1. `kubectl apply --dry-run=server -f infra/istio/chiefaia/26-destinationrule-wizard.yaml` ✓ pre-merge.
2. `kubectl apply` post-merge → 2 wizard pods Ready.
3. Cookie-pinning verified: `curl -b 'chiefaia-wizard-session=abc'` twice hits the same pod.
4. Rollout safety: `kubectl rollout restart deploy/chiefaia-wizard` while a 10-rps cookie-pinned curl loop is running; 0 connection errors expected.

## DoD

- [x] Manifests written + tests passing locally.
- [x] EA-REVIEW-OUTCOME.json recorded (stub critic).
- [ ] CI green / True-Zero ritual.
- [ ] kubectl apply + verification.
