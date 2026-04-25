# This repo has moved into the CAIA monorepo

As of **2026-04-25**, the contents of `prakashgbid/conductor` have been
consolidated into the CAIA monorepo at https://github.com/prakashgbid/caia.

**New location inside CAIA:** `apps/orchestrator/, apps/executor/, apps/dashboard/, apps/completeness-sentinel/, apps/db-backup/, apps/task-run-poller/, apps/story-backfiller/, apps/pipeline-pulse/, apps/orchestrator-middleware/`

Why: CAIA is the single site/app/IT-system building platform.
Everything generic (non-site-specific) now lives in one monorepo.

**Consolidation PR:** https://github.com/prakashgbid/caia/pull/43

This repository is now archived (read-only). Existing references to this
repo continue to work for historical purposes, but new development
happens in CAIA.

If you depended on this repo via npm or git URL, please update to
the corresponding `@chiefaia/*` package or the new path inside CAIA.
