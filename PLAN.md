# `caia-ea` + `caia/docs/adr` — ADR-067 snapshotter convergence decision (Phase C4)

**Author:** autonomous-build (operator-dispatched 2026-05-31)
**Status:** Implementation complete
**Branch:** `feature/c4-snapshotter-row-level-adr-2026-05-31`
**True-Zero admin-merge:** RATIFIED (subscription-only Claude Max; `.caia/build-phase-active` carve-out continues to apply; ritual per AGENTS.md §156–§163).

## 1. Why this exists

Phase C Task C4 of the CAIA wizard pipeline: resolve the snapshotter ↔
rest-of-system tenant-isolation drift with a recorded ADR.

The design-ingest snapshotter (`@chiefaia/design-ingest`) is the lone
surface in the platform that uses **row-level tenant_id** persistence —
everything else (wizard, dashboard, `@caia/wizard-tenant-bootstrap`) is
**schema-level**. Operator directive: "decide for me, optimize for what
reduces drift."

**Decision: keep row-level for V1; defer the destructive migration to a
future ADR triggered by row count (>10M) or tenant count (>25).** This
is the cleanest V1 path because the migration itself is the larger risk
than the drift it removes, and the drift is now intentional and dated.

## 2. Scope of this PR

### 2.1 In scope

1. **`caia-ea/decisions/ADR-067-snapshotter-row-level-tenant-id-canonical-for-v1.md`**
   — the canonical EA decision record (Nygard-style; written per the
   `caia-ea/templates/adr-template.md` shape). Lives outside this repo
   because caia-ea is a separate, non-git'd EA notes directory; the
   mirror at `caia/docs/adr/ADR-067-...md` is the in-monorepo greppable
   copy.
2. **`caia/docs/adr/ADR-067-snapshotter-row-level-tenant-id-canonical-for-v1.md`**
   — verbatim mirror of the caia-ea ADR with a top-line callout to
   the canonical source.
3. **`apps/wizard/tests/wizard-shell/adr-067-snapshotter-shape.test.ts`**
   — 6 vitest cases asserting the ADR mirror exists, declares Accepted
   status, names the snapshotter as affected, commits to row-level for
   V1, carries both migration triggers (10M / 25), and cites its
   canonical source.
4. **`.changeset/c4-adr-snapshotter-convergence.md`** — none-bump
   (docs/EA only; no published package surface change).

### 2.2 Out of scope

- The schema-level migration itself — DEFERRED per the ADR's decision.
  Future ADR-XXX owns the migration when triggers fire.
- The semgrep rule enforcing `WHERE tenant_id = $1` on snapshotter
  SQL — listed in the ADR's "Neutral / follow-on work" but not in C4.
- The operator-dashboard widget surfacing snapshotter row count / tenant
  count vs. triggers — also listed, also deferred.
- Any change to `@chiefaia/design-ingest` runtime behaviour — this PR
  is documentation-only.

## 3. Reuse-first compliance

| Dep | Use | Decision |
| --- | --- | --- |
| `caia-ea/templates/adr-template.md` | Nygard ADR shape | **selected** — every section in this ADR follows the template's structure. |
| `caia/docs/adr/` directory | In-monorepo ADR mirror surface | **selected** — extends the existing curated mirror (last entry was ADR-016) with a single high-leverage decision; full resync of ADRs 017–066 is out of scope. |
| `@caia/ui` | (not used) | **rejected** — docs/EA PR; no UI surface. |
| New ADR schema / Decision Records framework | Decision tracking | **rejected** — we already have a working ADR convention. |

## 4. Test strategy

| Layer | File | it-blocks | Assertions |
| --- | --- | --- | --- |
| ADR mirror exists in caia/docs/adr/ | `apps/wizard/tests/wizard-shell/adr-067-snapshotter-shape.test.ts` | 1 | 1 |
| Status: Accepted | same file | 1 | 1 |
| @chiefaia/design-ingest named as affected | same file | 1 | 1 |
| Decision sentence: keep row-level for V1 | same file | 1 | 1 |
| Both migration triggers (10M, 25) present | same file | 1 | 2 |
| Cites canonical source in caia-ea | same file | 1 | 1 |
| **Total new** | | **6** | **7** |

6 new vitest cases ≥ the brief's de-facto "≥5 tests" minimum.

## 5. Verification proof

1. `cat caia-ea/decisions/ADR-067-...md` returns the canonical ADR text.
2. `cat caia/docs/adr/ADR-067-...md` returns the verbatim mirror with
   canonical-source callout.
3. `pnpm vitest run tests/wizard-shell/adr-067-snapshotter-shape.test.ts`
   — 6/6 pass.

## 6. Definition of Done

- [x] ADR-067 written in caia-ea (canonical).
- [x] ADR-067 mirrored in caia/docs/adr/.
- [x] 6 new vitest cases pass locally.
- [x] EA-REVIEW-OUTCOME.json recorded (stub critic; live submitPlan
      deferred per #635 precedent).
- [ ] CI green.
- [ ] True-Zero admin-merge ritual completed.
- [ ] PR comment links the ADR location.
