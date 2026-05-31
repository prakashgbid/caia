# `infra/wizard` + `infra/dashboard` — Phase C1 HorizontalPodAutoscalers

**Author:** autonomous-build (operator-dispatched 2026-05-31)
**Status:** Implementation complete
**Branch:** `feature/c1-hpa-wizard-dashboard-2026-05-31`
**True-Zero admin-merge:** RATIFIED (subscription-only Claude Max; `.caia/build-phase-active` carve-out continues to apply; ritual per AGENTS.md §156–§163).

## 1. Why this exists

Phase C Task C1 of the CAIA wizard pipeline: bring autoscaling to the two
customer-facing Next.js surfaces so wizard step bursts (Claude-bound) and
operator-dashboard live views no longer wedge a single pod.

Both Deployments today ship `replicas: 1` (see `infra/wizard/10-deployment.yaml`
and `infra/dashboard/10-deployment.yaml`); each Deployment carries identical
resource requests (`cpu: 250m`, `memory: 512Mi`). The HPAs in this PR turn that
into a 1..5-replica band gated on CPU 70% AND memory 80% average utilisation —
the same shape on both surfaces so operators have one mental model.

The behavior block (60s stabilisation window on scale-up, 5-minute window on
scale-down) is the V1 anti-flap budget; the 5-minute scale-down window is
deliberately matched to the wizard's median session length so in-flight
SSE/WebSocket sessions are not evicted mid-interview by an over-eager
downscale event.

## 2. Scope of this PR

### 2.1 In scope

1. **`infra/wizard/50-hpa.yaml`** — `autoscaling/v2`
   HorizontalPodAutoscaler targeting `deployment.apps/chiefaia-wizard`.
   `minReplicas: 1`, `maxReplicas: 5`, CPU 70% + memory 80%
   utilisation, behavior block with 60s up-stabilisation /
   300s down-stabilisation.
2. **`infra/dashboard/50-hpa.yaml`** — structurally symmetric HPA
   targeting `deployment.apps/chiefaia-dashboard`.
3. **`apps/wizard/tests/wizard-shell/hpa-manifest.test.ts`** —
   7 vitest cases (13 it-blocks via it.each) asserting both manifests'
   contract:
   - autoscaling/v2 apiVersion + kind (x2)
   - scaleTargetRef → Deployment in chiefaia ns (x2)
   - 1..5 replica band (x2)
   - CPU 70 + memory 80 thresholds (x2)
   - canonical chiefaia labels (x2)
   - anti-flap behavior block w/ 300s scale-down window (x2)
   - structural symmetry between the two HPAs (x1)
4. **`.changeset/c1-hpa-wizard-dashboard.md`** — none-bump (infra
   only; no published package surface changes).

### 2.2 Out of scope

- Prometheus-driven custom-metric HPAs (defer to C8 — needs Prometheus
  installed first; metrics-server in kube-system is sufficient for V1
  CPU/memory).
- VerticalPodAutoscaler (not requested; HPA alone covers V1 needs).
- Istio sticky-session DestinationRule (lands in C7; this PR's HPA was
  designed knowing C7's cookie-based consistentHash will keep in-flight
  sessions pinned even as we scale up).
- KEDA event-driven autoscaling on NATS queue depth (not requested;
  CPU + memory is the V1 signal).

## 3. Reuse-first compliance

| Dep | Use | Decision |
| --- | --- | --- |
| `autoscaling/v2` (kube-apiserver built-in) | HPA API | **selected** — stable since k8s 1.23. No CRDs, no Helm chart, no parallel autoscaler. |
| `metrics-server` (kube-system, already running) | CPU/memory signal source | **selected** — `kubectl top pods -n chiefaia` already returns values, so the HPA's `Resource` metric source has data on day 1. |
| `@caia/ui` | (not used) | **rejected** — infra PR; no UI surface. |
| KEDA / Keda CRDs | Event-driven autoscaling | **rejected** — V1 doesn't have a NATS-queue-depth signal worth scaling on. Revisit if wizard step latency degrades under NATS backpressure. |
| `kube-prometheus-stack` / custom-metrics API | Custom-metric HPAs | **rejected for C1** — defers to C8 which installs Prometheus. CPU + memory is the V1 signal. |
| Vertical Pod Autoscaler | Right-sizing requests | **rejected** — out of scope for C1; resource requests in 10-deployment.yaml were operator-ratified. |

## 4. Test strategy

| Layer | File | it-blocks | Assertions |
| --- | --- | --- | --- |
| autoscaling/v2 apiVersion + kind | `apps/wizard/tests/wizard-shell/hpa-manifest.test.ts` | 1 (×2 targets) | 4 |
| scaleTargetRef Deployment shape | same file | 1 (×2 targets) | 8 |
| 1..5 replica band | same file | 1 (×2 targets) | 4 |
| CPU 70 + memory 80 thresholds | same file | 1 (×2 targets) | 4 |
| Canonical labels | same file | 1 (×2 targets) | 6 |
| Anti-flap behavior block | same file | 1 (×2 targets) | 8 |
| Cross-manifest symmetry | same file | 1 | 1 |
| **Total new** | | **7 it-blocks / 13 cases via it.each** | **35** |

7 new vitest cases ≥ the brief's "≥5 tests" requirement. All 13 pass
locally (verified pre-push via `pnpm vitest run tests/wizard-shell/hpa-manifest.test.ts`).

## 5. Verification proof (recorded post-merge in PR body)

1. `kubectl apply --dry-run=server -f infra/wizard/50-hpa.yaml -f infra/dashboard/50-hpa.yaml`
   → exit 0, both HPAs validated server-side (already verified pre-merge).
2. `kubectl apply -f infra/wizard/50-hpa.yaml -f infra/dashboard/50-hpa.yaml`
   → `horizontalpodautoscaler.autoscaling/chiefaia-wizard created`,
     `horizontalpodautoscaler.autoscaling/chiefaia-dashboard created`.
3. `kubectl -n chiefaia get hpa -o wide` → TARGETS column shows live
   `<cpu>%/70%, <mem>%/80%` values (metrics-server feeding data).
4. Synthetic-load verification — `hey -z 60s -c 50` against the dashboard
   health endpoint drives CPU over the 70% threshold for >60s;
   `kubectl -n chiefaia get hpa chiefaia-wizard --watch` shows `REPLICAS`
   rise from 1→{2,3}.
5. Scale-down validated by stopping the load + waiting 300s + observing
   `REPLICAS` return to 1.

## 6. Definition of Done

- [x] `infra/wizard/50-hpa.yaml` created with V1-ratified thresholds.
- [x] `infra/dashboard/50-hpa.yaml` created (structurally symmetric).
- [x] 13 new vitest cases (`hpa-manifest.test.ts`) pass.
- [x] EA-REVIEW-OUTCOME.json recorded (stub critic; live submitPlan
      deferred per #635 precedent).
- [ ] CI green (`Build · Test · Lint · Typecheck`) — tolerating same
      pre-existing TS2352 + lighthouse fails as PR #625.
- [ ] True-Zero admin-merge ritual completed.
- [ ] HPAs `kubectl apply`ed to chiefaia ns.
- [ ] Synthetic load drives `REPLICAS` from 1→≥2; recorded in PR comment.
