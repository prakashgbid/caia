# Self-hosted runner — operator runbook

**Companion to:** `docs/self-hosted-runners.md` (install + design).
**Reference:** `velocity-acceleration-strategy-2026-05-06.md` §A.2.

## How to know if the pool is healthy

### From GitHub UI

Navigate to **Settings → Actions → Runners**. Each `caia-stolution-{N}`
should show status **Idle** or **Active** with a recent contact time. The
runners list refreshes every minute.

### From the `runner-pool-health.yml` workflow

The workflow runs every 15 minutes and emits:

- ✅ green: runner alive, disk ≤85%, docker reachable
- ⚠ warning at 85% disk: schedule cleanup
- ❌ failure at >90% disk: blocks runner-pool-health (and signals an alarm
  to Steward Gatekeeper)

View runs at:
`https://github.com/prakashgbid/caia/actions/workflows/runner-pool-health.yml`

### From stolution

```bash
ssh stolution 'systemctl list-units "actions.runner.caia-*.service" --no-pager'
```

Expected: each unit `active (running)`. A unit in `failed` state means
something is wrong; check journal:

```bash
ssh stolution 'journalctl -u actions.runner.caia-3.service -n 100 --no-pager'
```

## Common operations

### Restart a single runner

```bash
ssh stolution 'sudo systemctl restart actions.runner.caia-3.service'
```

The runner finishes its current job (if any) and respawns clean.

### Restart the whole pool

```bash
ssh stolution 'sudo systemctl restart "actions.runner.caia-*.service"'
```

Useful after a config change or token rotation.

### Drain a runner (graceful)

```bash
ssh stolution 'sudo systemctl stop actions.runner.caia-3.service'
```

Lets the current job finish; does not respawn. Use before maintenance.

### Tail logs

```bash
# Single runner
ssh stolution 'journalctl -u actions.runner.caia-3.service -f'

# All runners
ssh stolution 'journalctl -u "actions.runner.caia-*.service" -f'
```

### Disk pressure response

If `runner-pool-health.yml` reports >85% disk:

1. Run `scripts/stolution/disk-cleanup.sh` (dry-run first)
2. If still >85%, run with `--execute --yes`
3. If still >85%, run with `--include-backups` (after verifying offsite
   backups exist)
4. If still >85%, drain runners and investigate manually

### Runner deregistration

```bash
ssh stolution 'cd /home/s903/actions-runner-3 && \
  ./config.sh remove --token <fresh-token>'
ssh stolution 'sudo systemctl disable --now actions.runner.caia-3.service'
ssh stolution 'sudo rm /etc/systemd/system/actions.runner.caia-3.service'
```

## Alarm response

| Alarm | Source | Response |
| --- | --- | --- |
| 85% disk | `runner-pool-health.yml` warning | Schedule cleanup; non-urgent |
| 90% disk | `runner-pool-health.yml` failure | Run `disk-cleanup.sh --execute --yes` immediately |
| Runner pool unreachable | 3+ consecutive `runner-pool-health.yml` failures | Steward Gatekeeper proposes fallback PR re-pointing to `ubuntu-latest` |
| Runner stuck | Single `actions.runner.caia-N` in failed state | `systemctl restart actions.runner.caia-N.service`; if recurring, check `journalctl` |

## Disk-watch (Tier 0.5 follow-up)

A `disk-watch.ts` analyzer extension to Steward Gatekeeper is planned to
run in `daily` mode and emit warnings at >90% / hard-stops at >95%. Once
live, this runbook is the playbook for those alarms.

## Pool sizing decisions

| Concurrent jobs needed | Recommended pool size |
| --- | --- |
| 1-3 | 2 runners (start here) |
| 4-7 | 4 runners |
| 8-15 | 8 runners |
| 16+ | 16 runners (max recommended on 72-core stolution) |

Each runner reserves 16 GB RAM ceiling and 4-CPU equivalent. With 16
runners that's 256 GB RAM ceiling vs 251 GB physical — the kernel
overcommits, and runners rarely all peak together.

## See also

- `docs/self-hosted-runners.md` — design + install
- `scripts/stolution/disk-cleanup.sh` — disk reclamation
- `infra/stolution/systemd/actions.runner.caia.service.template` — systemd unit
- `scripts/stolution/install-runner-pool.sh` — install script
- `.github/workflows/runner-pool-health.yml` — 15-min health check
