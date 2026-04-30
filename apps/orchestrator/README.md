# `@caia-app/core` — orchestrator

The CAIA orchestrator daemon. Listens on `CONDUCTOR_HTTP_PORT` (default
`7776`), runs the prompt → PO decomposer → BA → EA → Validator →
Test-Design → Task-Manager pipeline, and serves the lineage / pipeline
APIs the dashboard at `localhost:7777` consumes.

## Build

```sh
pnpm --filter @caia-app/core build
```

This runs `tsc -p tsconfig.build.json` and then a `postbuild:copy-migrations`
step that mirrors `src/db/migrations` into `dist/src/db/migrations` —
`tsc` doesn't copy `.sql` files on its own, so without the postbuild
step the daemon boots with a partial migration set and either crashloops
or silently skips schema work. See `caia/docs/migration-runner.md`.

## Runtime — **`tsx` is required**

The launchd plist (`com.caia.orchestrator`) does **not** invoke a
plain `node dist/...` boot. It uses `tsx` directly:

```
node \
  /Users/MAC/Documents/projects/caia/node_modules/.pnpm/tsx@4.21.0/node_modules/tsx/dist/cli.mjs \
  /Users/MAC/Documents/projects/caia/apps/orchestrator/scripts/boot-orchestrator.cjs
```

Why:

- A handful of internal workspace packages still have
  `"main": "src/index.ts"` (see `chore/packages-build-step-tsx` for the
  in-flight migration to `dist/index.js` mains). When the orchestrator
  imports them, Node will try to require a `.ts` file and fail. `tsx`
  installs the CJS preflight + ESM loader hooks that transpile on the
  fly so those `src/*.ts` mains resolve.
- The `tsx` CLI is the only entrypoint that installs **both** hooks.
  `node --import tsx/esm` alone misses the CJS-side `--require
  preflight.cjs`, which we need because `boot-orchestrator.cjs` is CJS
  and reaches into ESM-flavoured workspace packages.
- Use the direct `.pnpm/tsx@…/dist/cli.mjs` path. Do **not** invoke
  `node_modules/.bin/tsx` from launchd — it's a `/bin/sh` shim and
  launchd refuses to exec it ("Operation not permitted").

If you want a `node`-only boot in production:

1. Land `chore/packages-build-step-tsx` for every package whose `main`
   is still `src/index.ts` (most are flipped; a few may remain — see
   `grep -l '"main":[[:space:]]*"src/index\.ts"' packages/*/package.json`).
2. Confirm `pnpm --filter <each-pkg> build` produces a `dist/index.js`.
3. Flip the plist's `ProgramArguments` to:
   ```
   /opt/homebrew/Cellar/node/<ver>/bin/node
   /Users/MAC/Documents/projects/caia/apps/orchestrator/dist/src/api/start.js
   ```
4. Reload (`launchctl unload && launchctl load`) and verify
   `lsof -i :7776 | grep LISTEN` reports a single LISTEN socket.

Until then, `tsx` is a hard runtime dependency of the orchestrator
launchd job.

## Configuration

The plist at `~/Library/LaunchAgents/com.caia.orchestrator.plist` wires:

- `CONDUCTOR_HTTP_PORT` — HTTP port (default `7776`).
- `CONDUCTOR_DB_URL` — absolute path to the SQLite DB
  (default `~/.conductor/db.sqlite`).
- `NODE_ENV` — `production`.
- `PATH`, `HOME` — standard.
- `ANTHROPIC_API_KEY` — required for the validator's Claude path.
  If absent, `ClaudeAdapter` throws on construction and the validator
  falls into a tight retry loop (the local Ollama fallback masks the
  symptom but the pipeline doesn't advance past `ea_decomposed`).
  See `daemon_repoint_2026-04-30.md` for the full debug story.

## Endpoints

- `GET  /health` — `{ ok: true, db: "connected", schema: "v2" }`.
- `POST /prompts` — accept a new prompt. Body shape:
  ```json
  {
    "body": "Add a contact form to the homepage.",
    "run_mode": "plan-only" | "test-only" | "full",
    "received_via": "api" | "mcp"
  }
  ```
- `GET  /prompts/{id}/pipeline` — full lineage object.
- `GET  /prompts/{id}/events` — event timeline for a prompt.
- `GET  /prompts?limit=N` — recent prompts.

## See also

- `caia/docs/migration-runner.md` — drizzle migrator quirks + recovery.
- `caia/docs/git-flow.md` — `pnpm flow` lifecycle.
- `agent/memory/daemon_repoint_2026-04-30.md` — daemon-repoint case study.
