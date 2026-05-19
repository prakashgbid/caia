---
"@chiefaia/apprentice-retrainer": patch
---

fix(apprentice-retrainer): wire production pipelines for cron entry — the silently-broken daily retrain

The Phase 4 LaunchAgent has been failing every scheduled tick since deploy with `CorpusFailedError: no corpusAggregator injected`. The plist invoked `dist/cli.js run` but `cli.ts` is explicitly the dev-time / operator entry — it constructs `new ApprenticeRetrainer()` with NO pipelines wired by design, matching the docstring "this CLI is the dev-time / operator-driven entry point and runs without the heavy pipeline by default". The cron was never going to work via that entry; the README's note that "the cron shell script should construct an instance with the production wiring" was unmet — the shell script didn't exist.

This change adds `src/production-wiring.ts` exporting `createProductionRetrainer()` (factory that injects all four upstream pipelines via thin adapter shims), adds `src/cron.ts` as the new LaunchAgent entry point (`caia-apprentice-retrainer-cron` bin), updates the plist to point at `dist/cron.js`, and adds workspace deps for the three previously-uninvolved sibling packages.

Operator action required: reinstall the LaunchAgent (`scripts/install-apprentice-retrainer.sh`) so the next scheduled tick uses `dist/cron.js`. Existing 52-test suite still green; test seams unchanged.

Verification (2026-05-16T18:20:09Z): manual cron run completed end-to-end with outcome `gated-pending-quality` (avg=0.500 < 0.55 floor, count=73 < 300 floor) — the quality gate fired as designed on today's corpus; `lastError` cleared from state; digest entry appended.
