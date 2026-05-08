---
"caia": patch
---

ops(velocity-tier0-001): stolution disk-cleanup script + operator runbook

Adds the Tier 0 prerequisite for the velocity-acceleration plan
(`velocity-acceleration-strategy-2026-05-06.md` §A.1):

- `scripts/stolution/disk-cleanup.sh` — five-step reclamation script
  (audit → docker prune → runner _work → journal vacuum → backups),
  dry-run by default, with safety rails (preview before each destructive
  step, interactive confirm unless `--yes`, postgres backups opt-in only).
- `docs/operator/stolution-disk-cleanup.md` — runbook covering when to
  run, how to run, tuning knobs, verification, and recovery from a
  runaway diagnostic that left `du` background processes hung.

**Rationale:** stolution's NVMe was at 96-97% utilisation as of
2026-05-06 (3.3 TB used / 129-142 GB free of 3.6 TB). Self-hosted runner
deployment (Tier 1.1) needs ~10-50 GB transient space per concurrent
job, so the disk must be ≤80% before runner expansion.

**Reliability:** ★ low. The `du` audit is non-recursive on the filesystem
(samples well-known directories only), specifically to avoid the
positive-feedback IO-pressure spiral that triggered an sshd
banner-exchange outage on 2026-05-06. Each destructive step previews
before executing.

**No execution in this PR.** The script lands; the operator runs it
out-of-band when stolution sshd is reachable.

Reference: `velocity-acceleration-strategy-2026-05-06.md` §A.1 (Tier 0).
