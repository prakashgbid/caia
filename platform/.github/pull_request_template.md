<!-- CAIA PR template — required for auto-review pass. -->

## What & why

<!-- One-paragraph summary. Reference the SF-XX / KERNEL-X / STOL ticket. -->

Closes STOL-____

## Contract impact

- [ ] No public contract change
- [ ] Contract added/changed in `packages/contracts/` (schema version bumped)
- [ ] Migration required (linked in the description)

## Test evidence

<!-- Paste `pnpm test` and/or `uv run pytest` outcome. CI must be green. -->

## DoD checklist (per [[dod-hard-rule]])

- [ ] All CI checks green on self-hosted runner
- [ ] Merged to `main`
- [ ] Deployed to at least staging
- [ ] Wired into use (linked from a caller or documented as unused-on-purpose)
- [ ] Observability hooked (OTel span + SLO annotation where applicable)
