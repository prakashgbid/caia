# Stolution disk cleanup runbook

**Audience:** operator + on-call.
**Cadence:** ad-hoc on alarm; weekly preventative once Tier 1.1 runner pool is online.
**Reference:** `velocity-acceleration-strategy-2026-05-06.md` §A.1.

## When to run this

- The 90% disk-usage alarm wired into Steward Gatekeeper fires (any host)
- New self-hosted runner is being added and the host is at >80% disk
- Manual ssh shows `df -h /` is at >85%
- Scheduled weekly preventative pass

## What it does

`scripts/stolution/disk-cleanup.sh` performs a five-step reclamation, in order:

1. **T0-1: audit** — non-recursive `du` on top-level directories, plus
   `docker system df` if available. Logs current free space; takes ~30
   seconds. Read-only.
2. **T0-2: docker prune** — `docker system prune -af --volumes`. Reclaims
   dangling images, stopped containers, and unused volumes. Tagged images
   for running services are preserved because the container holds a
   reference. Expect 50-300 GB.
3. **T0-3: runner _work cleanup** — `find /home/s903/actions-runner*/\_work
   -mtime +14 -delete`. Removes stale workflow checkouts older than 14
   days. Per-pool-runner-aware (handles `actions-runner-1` through
   `actions-runner-16`). Expect 10-50 GB.
4. **T0-4: journalctl vacuum** — keeps last 14 days of systemd journals.
   Expect 1-5 GB.
5. **T0-5: postgres backups** — opt-in via `--include-backups`. Removes
   `.dump` files older than 30 days. Expect 30-200 GB. **Disabled by
   default** because it cannot be undone; verify backups exist on
   secondary storage (MinIO sync) first.

## Safety

- Default mode is **dry-run**. Pass `--execute` to perform destructive ops.
- Interactive confirmation required unless `--yes` also passed.
- Each destructive step is preceded by a preview/snapshot.
- The `du` audit is **non-recursive on the filesystem** — it samples
  well-known directories only, to avoid amplifying IO pressure on a
  near-full disk. (Lessons learned 2026-05-06: an aggressive
  `du -sh /home/s903/*` triggered an sshd banner-exchange outage on the
  97%-full host.)

## Procedure

### Dry run (read-only diagnostic)

```bash
ssh stolution 'bash -s' < scripts/stolution/disk-cleanup.sh
```

This shows the audit, previews each destructive step, but performs no
deletions. Total wall-time ~1 minute.

### Execute (destructive)

```bash
ssh stolution 'bash -s' < scripts/stolution/disk-cleanup.sh -- \
  --execute --yes
```

Reclaims dangling docker, stale runner work, and old journals. Postgres
backups are NOT touched.

### Execute including backups

```bash
ssh stolution 'bash -s' < scripts/stolution/disk-cleanup.sh -- \
  --execute --yes --include-backups
```

Adds T0-5. Verify offsite backup integrity first.

## Tuning knobs

| Flag | Default | What it does |
| --- | --- | --- |
| `--runner-age N` | 14 | Reclaim runner `_work` older than N days |
| `--backup-age N` | 30 | Backup retention horizon |
| `--journal-keep-days N` | 14 | systemd journal vacuum window |
| `--target-use-pct N` | 80 | Cleanup target; script exits non-zero if final use > target |

## Verification

The script prints `df -h /` at the end and asserts `use ≤ --target-use-pct`.

Spot-check service health:

```bash
ssh stolution 'docker ps --format "table {{.Names}}\t{{.Status}}"; uptime'
```

Vault audit log rotation should already be configured per
`secrets_vault.md`; this runbook does not touch Vault.

## What this runbook does NOT do

- Does not stop or restart any service
- Does not modify postgres data files
- Does not touch `/etc`, `/boot`, or `/usr`
- Does not run `vacuum analyze` on postgres (consider as a separate runbook)

## Recovery from runaway diagnostic

If a previous diagnostic pass left `du` background processes hung
(consuming IO on a near-full disk):

```bash
ssh stolution 'pkill -f "du -sh /home/s903"'
# then wait 5-30 minutes for IO pressure to subside before trying again
```

If sshd itself is unreachable due to disk-pressure-induced banner-exchange
timeout, the only recovery path is out-of-band console access (cloud
provider IPMI, serial console, or physical access). At that point, drop
to the rescue shell and run `docker system prune -af --volumes` directly.

## Disk monitoring (Tier 0.5 follow-up)

A `disk-watch.ts` analyzer extension to Steward Gatekeeper is planned
(Story T0-5 in the velocity strategy). It runs in `daily` mode, hard-stops
at >95%, warns at >90%. Once that lands, this runbook is the response
playbook for those alarms.
