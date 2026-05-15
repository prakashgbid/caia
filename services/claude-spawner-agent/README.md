# claude-spawner-agent — Host-Side Spawner Daemon (Phase 5)

Canonical source for the claude-spawner-agent service. Python 3.11 / FastAPI; runs as a
launchd-managed daemon on each M1/Mac host that hosts a claude-binary spawn capacity.
Slot-manager (this repo, sibling service) dispatches spawn payloads here; the daemon
validates `permission_mode` + `allow_list`, invokes the local `claude` CLI in the spawn's
working branch, and (optionally) auto-PRs the result.

## Layout

| File                                           | Role                                                                       |
|------------------------------------------------|----------------------------------------------------------------------------|
| `claude_spawner_agent.py`                      | FastAPI app — spawn validation, claude-CLI invocation, auto-PR             |
| `local_llm_router_client.py`                   | HTTP client for the optional local LLM router gate                         |
| `spawner_argv.py`                              | Pure `argv` builder for the `claude` CLI (testable; no I/O)                |
| `spawner_patch_v2.diff`                        | Reference patch (v2 router gate) — kept for audit traceability             |
| `launchd/com.caia.claude-spawner-agent.plist.template` | macOS launchd plist template (placeholders substituted at install time) |
| `scripts/install.sh`                           | Renders the plist from the template + bootout/bootstrap (Guardrail-7 hook) |
| `requirements.txt`                             | Python dependencies (pinned to minor)                                      |
| `smoke.sh`                                     | Smoke test: syntax + plist-xml-parse + install.sh syntax + import          |
| `package.json`                                 | `pnpm -F @caia/services-claude-spawner-agent run smoke` wrapper            |
| `m1-deployment-bundle/`                        | M1-host install bundle (install_m1_spawner.sh + concrete plist + assets)   |

## Runtime contract

- Listens on `127.0.0.1:7780` by default (per the launchd plist).
- Validates `--add-dir` paths against `${ALLOWED_ROOT}` (default `~/Documents/projects`).
  Blocklist includes `/etc`, `/var`, `/System`, `/usr`, `/Library`, `/boot`.
- Strips `ANTHROPIC_API_KEY` from the spawn subprocess env on every call. The zero-dollar
  rule (`feedback_no_api_key_billing.md`) is non-negotiable.
- `permission_mode ∈ {"plan","acceptEdits","bypassPermissions"}`. Default is `plan`
  (read-only, `--max-turns 1`). Slot-manager never auto-promotes to `bypassPermissions`.
- Auto-PR enabled only when `auto_pr: true` AND the spawn returns ok AND new commits exist
  on the spawn's working branch since spawn-start. `risk_tier == "high"` NEVER gets
  auto-merge regardless of `auto_merge` flag.

## Source-history continuity

Before 2026-05-15 the Phase 5 source lived outside the caia monorepo at:

    ~/Documents/projects/reports/claude-spawner-agent/        (M3)
    /home/s903/apps/claude-spawner/                           (stolution worker)

Both directories remain intact for historical reference; this directory is the live source
from B2 migration (PR `feat/b2-slot-manager-spawner-migrate-2026-05-15`) onward. The
migration was source-relocate only — no code edits, no re-architecture. See
`reports/integration_b2_slot_manager_migrate_2026-05-15.md` for the migration report.

## Sibling service

`services/slot-manager/` is the dispatcher that calls this daemon. The two co-evolved
(slot-manager defines the wire contract; claude-spawner-agent is the host-side executor).
They are migrated together in B2.

## Installation on an M1 host

Preferred (caia checkout, in-repo installer — the Guardrail 7 post-merge gate
calls this exact script):

```bash
git clone https://github.com/prakashgbid/caia.git ~/caia
bash ~/caia/services/claude-spawner-agent/scripts/install.sh
# Override defaults via env vars; see the script's header for the full list.
```

Alternative (M1-bundle-only — used when the M1 host has no caia checkout, e.g.
during the initial bring-up before the post-merge gate is wired). See
`m1-deployment-bundle/install_m1_spawner.sh` — it pulls the bundle from M3
over SSH and installs into `$HOME/.caia/spawner/`.

Manual fallback (rarely needed; both installers above wrap this):

```bash
python3 -m venv ~/.caia/spawner-venv
~/.caia/spawner-venv/bin/pip install -r ~/caia/services/claude-spawner-agent/requirements.txt
sed -e "s|CLAUDE_SPAWNER_VENV|$HOME/.caia/spawner-venv|g" \
    -e "s|CLAUDE_SPAWNER_REPO|$HOME/caia|g" \
    -e "s|CLAUDE_SPAWNER_LOG_DIR|$HOME/Documents/conductor-logs|g" \
    -e "s|SLOT_MANAGER_BASE_URL|http://stolution.local:8081|g" \
    -e "s|CLAUDE_BINARY|/opt/homebrew/bin/claude|g" \
    -e "s|ALLOWED_ROOT|$HOME/Documents/projects|g" \
    -e "s|NODE_BIN_PATH|/opt/homebrew/bin|g" \
  ~/caia/services/claude-spawner-agent/launchd/com.caia.claude-spawner-agent.plist.template \
  > ~/Library/LaunchAgents/com.caia.claude-spawner-agent.plist
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.caia.claude-spawner-agent.plist
```

## CI

A path-filtered smoke workflow at `.github/workflows/services-smoke.yml` runs on every PR
that touches `services/claude-spawner-agent/**`. The workflow invokes `bash smoke.sh` in
this directory.
