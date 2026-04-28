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

## Sites (separate repos)

Sites stay in their own repos and consume `@chiefaia/*` from npm:
- `pokerzeno`, `ROULETTECOMMUNITY`, `poker-247`, `stolution`
- Future: `chiefaia.com`, `prakash-tiwari`, `ankitatiwari`, `edisoncricket`

See [MIGRATION-STATUS.md](./MIGRATION-STATUS.md) for the consolidation history and source-repo → destination map.

See [ARCHITECTURE-MIGRATION.md](./ARCHITECTURE-MIGRATION.md) for the architectural rationale.

## License

MIT — see [LICENSE](./LICENSE).
