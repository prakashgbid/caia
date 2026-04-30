# Evidence Gate

> *The agent doesn't need to be trustworthy if the evidence is.*
> — third-party-caia-paper-analysis-2026-04-29.md §C.2

The Evidence Gate is the deterministic-evidence floor every PR must clear
before it can merge. It replaces "an LLM said the change is fine" with
"seven deterministic tools each emitted a green check." When all gates
pass, the merge button unlocks. When any blocking gate fails, the PR
stays open until the failure is fixed (or, in narrow cases, suppressed —
see *Suppression flow* below).

**Workflow file:** [`caia/.github/workflows/evidence-gate.yml`](../.github/workflows/evidence-gate.yml).
**Required-check propagation:** [`caia/scripts/setup-branch-protection.sh`](../scripts/setup-branch-protection.sh).
**Source rationale:** [§C.2 of the paper analysis](../../../../Documents/projects/reports/third-party-caia-paper-analysis-2026-04-29.md).

---

## What runs (7 parallel jobs)

| # | Job           | Tool                      | Threshold                                          | Mode (day-1)  |
|---|---------------|---------------------------|----------------------------------------------------|---------------|
| 1 | `typecheck`   | `tsc --noEmit` via turbo  | zero TypeScript errors                             | **blocking**  |
| 2 | `semgrep`     | semgrep `auto` + custom   | zero ERROR / WARNING in `.semgrep/caia-rules.yml`  | **blocking**  |
| 3 | `gitleaks`    | gitleaks-action           | zero high-confidence findings                      | **blocking**  |
| 4 | `bundle-size` | size-limit                | dashboard JS ≤ **500 KB gzipped** total            | **blocking**  |
| 5 | `lighthouse`  | LHCI                      | perf ≥80, a11y ≥90, best-practices ≥90, SEO ≥90    | warn-only*    |
| 6 | `axe`         | `@axe-core/playwright`    | zero **serious** + **critical** violations         | warn-only*    |
| 7 | `visual`      | Playwright `toHaveScreenshot` | ≤ **0.1%** pixel-difference vs `__visual_baselines__/` | warn-only* |

\* *Warn-only* means the job runs and reports — `continue-on-error: true`
in the workflow — but doesn't fail the gate yet. Promotion to blocking
is a one-line workflow edit (remove `continue-on-error`) that lands as a
follow-up PR after one daily release cycle confirms the dashboard's
current scores actually meet the floor. This honors the operator
mandate's *don't ship a gate that day-1 blocks every legitimate PR*
rule. Hitting "blocking" is the goal; warn-only is a deliberate two-step
landing.

---

## Threshold rationale

**Lighthouse (perf 80 / a11y 90 / best-practices 90 / SEO 90).** The
analysis doc (§C.2) called for perf ≥90 / a11y ≥95. We started at the
lower floor (paper §0.2 #10's relaxed read: "≥ thresholds") because:

- **Performance ≥90** on a Next.js production build of a data-heavy
  dashboard is achievable but requires per-route code-splitting + image
  optimization + a CDN. Day-1, perf ≥80 is the realistic floor.
- **Accessibility ≥90** is the realistic floor for a working app; ≥95 is
  the *next-cycle* target once the axe job has surfaced what we currently
  miss. axe will catch the high-impact issues independently.
- **Best-practices ≥90** and **SEO ≥90** are well within reach today.

The doc notes the next promotion: once one daily cycle passes warn-only,
tighten Lighthouse to a11y ≥95 and perf ≥90, and remove
`continue-on-error` from the lighthouse, axe, and visual jobs.

**axe (zero serious + critical).** Industry standard for a11y CI.
*Moderate* and *minor* violations are logged for triage but never block;
they accrete in `apps/dashboard/playwright-report/` (uploaded as the
`a11y-report` artifact) for review during regular hardening passes.

**Semgrep (zero ERROR + WARNING).** `auto` covers OWASP top-10, CWE
top-25, and language-specific patterns. Custom rules in
`.semgrep/caia-rules.yml` add CAIA-specific patterns:

- `caia-no-admin-merge` — forbids `gh pr merge --admin` (bypasses
  required checks).
- `caia-no-force-push-non-backup` — forbids `git push --force` outside
  `backup/*`.
- `caia-no-hardcoded-vault-keys` — pairs with gitleaks; catches the
  *key-name + literal-value* shape gitleaks may miss.
- `caia-no-direct-pat-in-source` — forbids reading GitHub PATs
  directly from `process.env.GITHUB_PAT` / `gh auth token` outside
  `scripts/`.
- `caia-no-mcp-json-write` — forbids writing to `mcp.json` /
  `.mcp.json` / `.cursor/mcp.json` from agent code (paper §C.3,
  CVE-2025-54135).

**gitleaks (zero high-confidence).** Already deployed via
`secrets-scan.yml` for full-history scans + bundle-bake detection. The
evidence-gate's gitleaks job is a fast diff-only scan on the PR, scoped
to high-confidence findings (default behavior of
`gitleaks/gitleaks-action@v2`). The full secrets-scan workflow continues
to run in parallel.

**Bundle size (500 KB gzipped total client JS, 200 KB first-load).**
The 500 KB total ceiling is industry standard for a SPA. The 200 KB
first-load ceiling protects time-to-interactive on the dashboard's
landing route. Configured in `apps/dashboard/.size-limit.json`.

**Visual diff (0.1% pixel difference).** Playwright's
`toHaveScreenshot()` defaults are too strict (any pixel changes fail).
0.1% (`maxDiffPixelRatio: 0.001`) tolerates anti-aliasing rounding and
font-hinting noise while catching real layout regressions.

---

## Interpreting failures

### `typecheck` failed
Run `pnpm typecheck` locally. Fix the TypeScript error in your branch.
If a type error is from another package's recent change to develop,
`git pull origin develop` and re-run.

### `semgrep` failed
The annotation contains the rule id and offending line. Three classes:

1. **`auto` rule** flagged a known security or correctness pattern — fix
   the code, or add a `// nosemgrep: <rule-id>` inline suppression with
   a comment explaining *why* this case is safe (operator approval
   required for `auto` suppressions).
2. **`caia-no-*` rule** flagged a CAIA-specific anti-pattern — fix the
   code. Suppression of a CAIA rule requires an entry in
   `.semgrep/SUPPRESSIONS.md` with rationale and operator approval.
3. **False positive** in our custom rule — open a PR fixing the rule
   itself in `.semgrep/caia-rules.yml`.

### `gitleaks` failed
A secret value matched a pattern. **Do not just suppress.** Steps:

1. Rotate the secret (Anthropic / Cloudflare / Supabase / etc.) IMMEDIATELY.
2. Remove the secret from the diff (`git rebase -i` to amend the
   offending commit).
3. Update the vault entry to the new value.
4. Re-push.

If gitleaks misfires (e.g. flagged a synthetic test fixture), add an
allowlist entry to `.gitleaks.toml` with a clear reason.

### `bundle-size` failed
`size-limit` prints a delta vs the limit. Common causes:

- A new heavy dep was added. Swap for a lighter one or dynamic-import it.
- A library's tree-shaking broke. Check `next.config.js` `transpilePackages`.
- The 500 KB limit is too tight for a real new feature. **Raise the
  limit in `apps/dashboard/.size-limit.json`** in the same PR as the
  feature, with the rationale in the PR description.

### `lighthouse` failed (warn-only)
The annotation lists each category that fell below floor. The LHCI run
publishes a public-storage report URL — click through for the per-audit
breakdown. Common fixes:

- Perf — image optimization, code-splitting, font preload, third-party
  script defer.
- a11y — covered by the axe job too; fix there first.
- Best-practices — usually fixable by removing console errors,
  upgrading deprecated APIs, fixing CSP.
- SEO — meta tags, viewport, robots.

While warn-only: the score is in the PR check rollup but doesn't block
merge. Treat it as a continuous-improvement signal until promoted.

### `axe` failed (warn-only)
Each test (one per route) prints the offending rule + selector. Fix in
the React component. The HTML report under the `a11y-report` artifact
has a click-through view of every node.

### `visual` failed (warn-only)
A pixel-diff exceeded 0.1% on at least one route. Three real causes:

1. **Intentional UI change** — run `pnpm visual:update` locally,
   eyeball the new PNGs in `apps/dashboard/__visual_baselines__/`,
   commit them in the same PR.
2. **Unintentional regression** — check the diff PNG in the `visual-diffs`
   artifact. Fix the regression in code; do *not* update baselines.
3. **Flaky region** — animation, timestamp, queue count. Add
   `data-visual-mask="true"` to the offending element so the visual
   suite masks it.

---

## Updating visual baselines (the right way)

```
# from caia/ root, on your feature branch
pnpm visual:update
git status   # confirm only __visual_baselines__/ files changed
git add apps/dashboard/__visual_baselines__/
git commit -m "test(visual): refresh baselines for <reason>"
```

Never commit a baseline change without eyeballing the resulting PNGs.
Never update baselines from a CI artifact — only from a local run on a
clean working tree.

---

## Suppression flow (false positives only)

A suppression is *not* a workaround. It is a documented operator
decision that a specific finding is safe in a specific context and that
the rule will continue to apply elsewhere.

1. Open a PR titled `chore/evidence-gate-suppress-<rule-id>-<reason>`.
2. Add the suppression:
   - **semgrep auto rule:** inline `// nosemgrep: <rule-id> — <reason>`
   - **caia-* rule:** entry in `.semgrep/SUPPRESSIONS.md`
   - **gitleaks:** allowlist in `.gitleaks.toml` with a comment
   - **a11y / lighthouse / visual:** mask via `data-visual-mask` /
     skip per-test with `test.skip()` and a `// reason: ...` comment
3. PR description must include: *what was flagged*, *why it is safe*,
   *who approved the suppression* (operator: prakashgbid).
4. Merge through the same evidence-gate workflow.

Pass-through-suppressions (a single PR that both adds the suppression
*and* the change that needs it) are allowed but require the operator
approval line in the PR description.

---

## Operating runbook

**On a normal PR:** `pnpm flow start <id>-<slug>` → make changes → push
→ open PR → all 4 blocking jobs go green → merge. Warn-only jobs
appear as orange/red but don't block.

**On a PR that touches the dashboard:** expect Lighthouse, axe, and
visual to actually run on your changes (paths-trigger isn't required;
the workflow runs on every PR to keep coverage uniform). If you
intentionally changed UI, run `pnpm visual:update` locally and commit
the new baselines.

**On a PR that adds a heavy dep:** expect `bundle-size` to fail. Either
swap to a lighter dep, dynamic-import it, or raise the budget with
rationale.

**On a PR that adds a new secret:** route through the vault. Never
commit the value. gitleaks will catch you.

**Promoting warn-only → blocking:** open `chore/evidence-gate-promote-blocking`,
edit `evidence-gate.yml`, remove `continue-on-error: true` from the
three jobs, and ship. Pre-requisite: at least one daily release cycle
on develop with all three warn-only jobs reporting green.

---

## Maintenance

- **Threshold tightening:** edit `lighthouserc.cjs` and `.size-limit.json`.
  Rationale goes in the PR description and (if material) here.
- **New routes:** add to `ROUTES` in
  `apps/dashboard/tests/{a11y,visual}.spec.ts` AND `lighthouserc.cjs`.
- **New custom semgrep rule:** add to `.semgrep/caia-rules.yml` and
  document the rationale here under *Threshold rationale → Semgrep*.
- **Branch-protection alignment:** if you rename a job, update
  `scripts/setup-branch-protection.sh` and re-run
  `bash scripts/setup-branch-protection.sh all`.

---

## References

- `.github/workflows/evidence-gate.yml` — the workflow.
- `.semgrep/caia-rules.yml` — custom Semgrep rules.
- `.gitleaks.toml` — gitleaks config (shared with `secrets-scan.yml`).
- `apps/dashboard/lighthouserc.cjs` — LHCI thresholds.
- `apps/dashboard/.size-limit.json` — bundle-size budgets.
- `apps/dashboard/playwright.config.ts` — Playwright (a11y + visual).
- `apps/dashboard/tests/a11y.spec.ts` — axe a11y suite.
- `apps/dashboard/tests/visual.spec.ts` — visual regression suite.
- `apps/dashboard/__visual_baselines__/` — committed baselines.
- `scripts/setup-branch-protection.sh` — required-check propagation.
- `~/Documents/projects/reports/third-party-caia-paper-analysis-2026-04-29.md` §C.2.
- `feedback_pr_lifecycle_and_branching.md` (memory).
