# CAIA — Chief AI Agent

The single site/app/IT-system building platform. **Everything generic lives here.** Each site stays in its own repo and consumes `@chiefaia/*` packages from public npm.

## Layout

```
caia/
├── apps/                       # Internal apps (private, not published)
│   ├── orchestrator/           # Conductor engine: CLI, API, pump
│   ├── executor/               # Task executor daemon
│   ├── dashboard/              # Next.js admin dashboard
│   ├── completeness-sentinel/  # Completeness sweep daemon (every 2h)
│   ├── db-backup/              # Hourly DB backup
│   ├── task-run-poller/        # Task run completion poller
│   ├── story-backfiller/       # Story backfiller from blockers
│   ├── pipeline-pulse/         # Pipeline pulse health checker
│   └── orchestrator-middleware/  # HTTP/MCP middleware
├── packages/                   # Reusable packages
│   ├── cli, config, errors, events, logger, metrics, secrets, test-kit, tracing  # @chiefaia/* — published
│   ├── image-provider          # @chiefaia/image-provider — published v0.1.0
│   ├── secrets-broker, story-decomposer, dead-shell-detector, behavior-suite  # lifted from plugins/
│   ├── local-llm-router        # @chiefaia/local-llm-router — routes simple tasks to local Ollama, complex to Claude
│   ├── analytics, backend-core, cast-bridge, content-engine, dev-inspector, integrity-check, seo-program  # @pokerzeno/* — sites consume from npm
│   └── *-internal/             # Private, not published (event-bus-internal, events-taxonomy-internal)
├── templates/                  # Project templates
│   ├── site/                   # Generic Next.js site template
│   ├── site-pokerzeno/         # Pokerzeno brand-locked template
│   └── utility/                # Utility-package starter
├── docs/                       # Architecture, ADRs, governance
└── configs/                    # Shared configs (eslint, tsconfig, etc.)
```

## Workflow

```bash
# Install
pnpm install

# Build everything
pnpm build

# Typecheck
pnpm typecheck

# Test
pnpm test

# Add a changeset before merging
pnpm changeset
```

## Contributing

CAIA enforces a strict, mechanically-protected git flow:

```
feature/<id>-<slug>  →  PR to develop  →  squash-merge  →  branch deleted
develop              →  release/<date> PR to main       →  merge → tag
main                 ←  only develop or release/* may merge in
backup/<reason>      ←  preservation only, never merged
```

Quickstart:

```bash
pnpm flow start <id>-<slug>          # cut feature/<id>-<slug> from develop
# ...edit, commit, push as needed...
pnpm flow ready                      # push + open PR vs develop
pnpm flow ship                       # squash-merge when CI green; delete branch
pnpm flow release --auto             # end-of-day release develop → main
```

Direct commits/pushes to `main` or `develop` are blocked locally (Husky `.husky/pre-commit` + `.husky/pre-push`) and server-side (GitHub branch protection + the required `gitflow-conformance` check). A daily watchdog (`.github/workflows/hygiene-report.yml`) opens a tracking issue if branches go stale; a 30-minute auto-PR worker (`.github/workflows/auto-pr.yml`) opens drafts for branches that accumulate commits without a PR.

Full operator runbook: **[`docs/git-flow.md`](./docs/git-flow.md)**.

Standing rules: [`agent/memory/feedback_git_flow_enforced.md`](./agent/memory/feedback_git_flow_enforced.md).

## Sites (separate repos)

Sites stay in their own repos and consume `@chiefaia/*` from npm:
- `pokerzeno`, `ROULETTECOMMUNITY`, `poker-247`, `stolution`
- Future: `chiefaia.com`, `prakash-tiwari`, `ankitatiwari`, `edisoncricket`

See [MIGRATION-STATUS.md](./MIGRATION-STATUS.md) for the consolidation history and source-repo → destination map.

See [ARCHITECTURE-MIGRATION.md](./ARCHITECTURE-MIGRATION.md) for the architectural rationale.

## License

MIT — see [LICENSE](./LICENSE).
