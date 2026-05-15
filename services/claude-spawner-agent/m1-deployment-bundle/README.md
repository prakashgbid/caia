# m1-deployment-bundle

Self-contained install bundle for the `claude-spawner-agent` on an M1/Mac host
that does **not** have a caia checkout. Used during initial bring-up before
the post-merge deployment gate (Guardrail 7) is wired to the M1 fleet.

Hosts that have a caia checkout should use the canonical installer instead:

    bash $CAIA_REPO/services/claude-spawner-agent/scripts/install.sh

## Bundle contents

| File | Role |
|------|------|
| `install_m1_spawner.sh` | Bash installer — SCPs from M3, builds venv, registers plist into `gui/` domain |
| `claude_spawner_agent.py` | Daemon source (snapshot of the M1-tagged build) |
| `com.caia.claude-spawner-agent.plist` | **Concrete** plist (placeholders already filled for the M1 host) |
| `requirements.txt` | Python deps (pinned to minor; includes `eval_type_backport` for py3.9) |
| `schema.sql` | SQLite schema used by the spawner's local spawn-tracking DB |

## How to run on an M1 host

1. Log in to the M1 GUI session as the operator user (typically `MAC`).
2. Open Terminal (must be a GUI session, not SSH — `launchctl bootstrap gui/$UID`
   only inherits keychain access from a GUI process; SSH-launched scripts
   cannot read `Claude Code-credentials-*` keychain entries).
3. Pull this script from M3 and run it:

   ```bash
   scp macbook-pro:/Users/macbook32/Documents/projects/caia/services/claude-spawner-agent/m1-deployment-bundle/install_m1_spawner.sh /tmp/
   bash /tmp/install_m1_spawner.sh
   ```

4. If `/health` returns `api_error_status=401`, run `/Users/MAC/.local/bin/claude /login`
   on the M1 host to re-auth the OAuth token (same expiry pattern observed on stolution).

The script is idempotent — re-running it on a host already configured is a
no-op-or-rerender, never a failure.

## Why a separate bundle vs the in-repo installer?

The canonical `scripts/install.sh` assumes a caia checkout on the host. For M1
fleet members that are first being brought up, that checkout doesn't exist yet,
and pre-creating it requires SSH access into a GUI session (rare). The bundle
gives the operator a single SCP + bash invocation that works from a freshly-
provisioned M1.

Once the post-merge deployment gate (Guardrail 7) drives `scripts/install.sh`
on every M1 via the fleet manager, this bundle becomes legacy. Until then, both
paths produce a functionally identical agent.

## Subscription guard

`ANTHROPIC_API_KEY` is intentionally not set anywhere in this bundle. The
spawner strips it from every subprocess env on every call. The zero-dollar
rule (`feedback_no_api_key_billing.md`) is non-negotiable.

## Source-history continuity

This bundle was migrated byte-for-byte (`cp -a`) from M3 at
`~/Documents/projects/reports/claude-spawner-agent/m1-deployment-bundle/`
in the B2 follow-up PR on 2026-05-15. The original directory remains intact
for historical reference; this directory is the live source going forward.
