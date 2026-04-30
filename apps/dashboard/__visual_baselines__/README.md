# Approved visual baselines

Committed PNG snapshots that the evidence-gate's `visual` job diffs against.

**Diff threshold:** 0.1% pixel difference (`maxDiffPixelRatio: 0.001`),
configured in `apps/dashboard/playwright.config.ts`.

**How baselines get here:**

```
# from repo root
pnpm visual:update
```

The script boots the dashboard's production build, runs the visual suite
with `--update-snapshots`, and writes the resulting PNGs into this
directory. Commit them in the same PR as the change that prompted the
update — never accept a visual baseline change from a CI artifact.

**Why this directory exists separately from `__snapshots__`:**

Playwright's default snapshot location is co-located with each test
file. We override `snapshotPathTemplate` in `playwright.config.ts` to
land everything in here, so the diff history of "what the dashboard
looks like" is auditable in one place.

**Suppressing a flaky region:** add `data-visual-mask="true"` to the
element. The visual suite masks all such elements per-route. See
`tests/visual.spec.ts`.

**Reference:** `caia/docs/evidence-gate.md` §Visual regression.
