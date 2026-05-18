# @chiefaia/logger

Structured logging for CAIA applications.

## Install

```bash
pnpm add @chiefaia/logger
```

## Usage

```ts
import { createLogger } from '@chiefaia/logger';

const log = createLogger({ name: 'my-service', level: 'info' });

log.info('server started', { port: 3000 });

const reqLog = log.child({ reqId: 'abc123' });
reqLog.debug('handling request');
```

## API

### `createLogger(options: LoggerOptions): Logger`

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `name` | `string` | — | Logger name, included in every line |
| `level` | `LogLevel` | `'info'` | Minimum level to emit |
| `pretty` | `boolean` | `false` | Pretty-print (dev only) |

### `Logger`

Methods: `trace`, `debug`, `info`, `warn`, `error`, `fatal`, `child`.

Each method signature: `(msg: string, ctx?: LogContext) => void`

---

## Adoption ratchet (TODO — substrate handover)

**Current state (2026-05-18, after PR #478 logger first-wave migration):**

- **Adopted (production code):** `apps/orchestrator/src/api/start.ts`,
  `apps/orchestrator/src/db/seeds/agents.ts`,
  `apps/task-run-poller/index.ts`,
  `apps/completeness-sentinel/src/{daemon,sentinel}.ts`,
  `packages/local-llm-router/src/router.ts` — ~30 sites migrated in the
  first wave.
- **Remaining migration surface:** ~79 `console.{log,error,warn,info,debug}`
  call sites across `apps/*` + `packages/*` production code (excluding
  tests, `cli/`, `scripts/`, `examples/`, and `install.ts`-style installers
  where stdout/stderr IS the user-facing output).

**Hottest remaining files (post-wave-1, by count):**

| File | Sites | Notes |
|------|-------|-------|
| `packages/seo-program/src/reporter.ts` | 16 | Report printer — keep `console.log` OR migrate behind `--json` flag |
| `packages/integrity-check/src/report/terminal.ts` | 13 | Terminal reporter — same call as above |
| `packages/mentor-fastpath/src/postmerge/consumer-cli.ts` | 6 | Post-merge consumer — daemon-shaped, migrate |
| `packages/dev-inspector/src/hooks/useConsole.ts` | 6 | Special: this *replaces* `console` — leave alone |
| `apps/orchestrator/src/api/routes/prompts.ts` | 5 | Route handler — migrate |
| `packages/reviewer/src/detectors/console-logging.ts` | 4 | Detector for console-logging anti-pattern — leave |
| `packages/analytics/src/integrations/ga4.ts` | 4 | Migrate |
| `apps/local-preview-orchestrator/src/deploy.ts` | 4 | Migrate |
| `apps/orchestrator/src/db/migrate-from-jsonl.ts` | 4 | Daemon-shaped, migrate |
| ...long tail of 50+ files with 1–3 sites each | ~50 | Eligible for batched ratchet PRs |

**Ratchet plan (for the P3 adoption substrate to pick up):**

1. **Phase 1 — daemons + library code (next 3–4 PRs).**
   Batches of 5–10 files per PR, each PR captioned
   `refactor(adoption): logger wave N — <theme>`. Skip CLI tools,
   reporters with chalk/picocolors styling, and files in `cli/scripts/
   examples/` paths unless the site is clearly background logging.
2. **Phase 2 — ESLint guardrail.**
   Add `no-console: ['warn', { allow: [] }]` to
   `configs/eslint-config/index.cjs` with a per-package override allowing
   CLI/script paths. Start at `warn`; flip to `error` after the wave-1
   files are merged and the lint warnings drop below ~30.
3. **Phase 3 — substrate enforcement.**
   The G10 adoption-everywhere gate (chain-runner) already counts logger
   adoption per package; once the per-package console-count is below a
   threshold (say, ≤3 in non-CLI files), the gate flips to blocking. At
   that point new code must go through `@chiefaia/logger` or carry an
   explicit `// eslint-disable-next-line no-console -- <reason>`.

**Why not migrate everything in one PR?** The audit (P3 v2, Section 5 #3)
identified 109 sites; large-blast-radius refactors of this kind tend to
break unrelated tests (logger output is captured by `vi.spyOn(console,
…)` in many places). Ratcheted rollout is intentional — each wave lands
green, the ESLint warning count goes down, the substrate picks up the
rest.

**For the substrate operator:** the canonical pattern this README
demonstrates (file-level `createLogger` + per-context `child()` binding)
is what the auto-generated `adopt/*` PRs should produce. See
`apps/orchestrator/src/observability/logger.ts` for the
host-app-wired bus-transport variant.
