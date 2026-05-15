# Operator recovery playbook

The canonical adjudication / re-arm / stop / resume playbook. Use this
when the chain is stuck and you need to put it back on the rails.

> **Hard rule.** Never hand-edit `state.json` or `lock.json`. Every
> mutation has a CLI verb. The CLI takes a backup before any mutation
> (`.backups/state.json.bak.<iso>`) and writes a structured audit event.
> Hand edits skip both and pollute future recovery.

All commands below omit the common `--chain-id <chain> --phases <yaml>`
suffix for brevity.

---

## 1. First-pass triage

When you don't yet know what's wrong:

```bash
caia-chain doctor                # one-shot health summary
caia-chain stall-root-cause      # walks dep graph to find blocker
caia-chain audit-tail -n 40      # last 40 events
caia-chain status                # phase-by-phase status table
```

`doctor` exits 0 healthy, 1 degraded (orphans, disk, network, gh-auth
issues), 2 stalled. The four sections it always prints:
locks / orphans / disk / network / gh-auth / preflight / quota.

---

## 2. Adjudication — operator-issued state transition

When the runner is wrong about what state a phase is in (e.g.,
worker hung after success, PR merged out-of-band, artifact present
but classifier missed it):

```bash
caia-chain adjudicate <id> --to done \
  --reason 'PR #434 merged; worker hung post-success; verified' \
  --evidence pr=https://github.com/.../pull/434 \
  --evidence artifact=~/path/to/file.md
```

Targets: `done` | `failed` | `blocked` | `pending`. Reason is required.
Multiple `--evidence key=value` pairs allowed.

Emits `phase_adjudicated` to the audit log. The audit event preserves the
operator's identity (`$USER`) and the full reason.

---

## 3. Re-arm — lift a blocked phase back to pending

When retries are exhausted (`phase_blocked`) but the root cause is
fixed (auth restored, dep updated, PR conflict resolved):

```bash
caia-chain re-arm <id> --reason 'auth re-established'

# Reset attempts to 0 so the phase gets a fresh retry budget:
caia-chain re-arm <id> --reset-attempts --reason 'transient infra'
```

Emits `phase_rearmed`.

---

## 4. Force-fail — explicit operator mark

For cleanup only. Marks a phase failed without going through the
retry/policy path:

```bash
caia-chain force-fail <id> --reason 'abandoned; superseded by phase 13'
```

Emits `phase_force_failed`. Combine with `caia-chain stall-root-cause`
to confirm downstream phases really can run with this phase short-
circuited.

---

## 5. Stop — kill a live worker

When a worker is running but should not be (wrong prompt, runaway
behavior, machine needs maintenance):

```bash
caia-chain stop --phase <id>                 # SIGTERM then SIGKILL after 10s
caia-chain stop --phase <id> --grace-ms 30000  # custom grace
```

`stop`:
1. Reads `lock.worker_pid` (recorded by `dispatchPhase`).
2. Sends `SIGTERM`, waits `--grace-ms`, sends `SIGKILL` if still alive.
3. Marks the phase failed with `source=operator_stop`.
4. Clears the lock.

Emits `lock_cleared{reason:'operator_stop'}` + `phase_failed`.

---

## 6. Reap — clean up orphans

When `caia-chain doctor` reports orphan worker processes (phase moved
to `done`/`blocked` but a claude child still lives):

```bash
caia-chain reap-orphans --dry-run    # what would be killed
caia-chain reap-orphans              # actually kill
```

Algorithm in `src/reap.ts`: walks pgrep for `claude --permission-mode
bypassPermissions --print`, maps each PID back to its chain via the
runner-script name, refuses to signal if the phase is still
`in_progress`. Emits `orphan_reaped` per kill.

The standard wake script invokes `reap_at_wake` from
`~/.caia/chain-watchdog/_wake_helpers.sh` before any dispatch.

---

## 7. Pause / resume

Suspend dispatch without losing state:

```bash
caia-chain pause --reason 'machine maintenance until 2026-05-15T08:00Z'
caia-chain resume
```

Pause sets `paused: true` + `paused_at`. Resume clears both. The
`paused_until` (auto-resume target) is independent — managed by
preflight when it detects a rate-limit reset time.

---

## 8. Budget control

`budget_consumed_pct >= budget_cap_pct` blocks dispatch.

```bash
caia-chain budget 50   # set the cap to 50%
caia-chain status      # shows consumed vs cap
```

The cap is a soft ceiling for chains that want self-throttling (e.g.,
the apprentice loop budget mode). The hardening chain ran with
`budget_cap_pct: 25`.

---

## 9. Acceptance / strict mode

If `mark-done` keeps refusing because `success_criteria` doesn't match
(strict mode), three options:

1. Fix the artifact / PR, then re-call `mark-done`.
2. Override: `caia-chain adjudicate <id> --to done --reason '...'
   --evidence ...`. (Bypass acceptance because operator is the gate.)
3. Switch the phase to warn mode in YAML and re-deploy.

The audit event for the refusal: `phase_acceptance_failed`. The
classifier may also have written a `failure` with class
`acceptance_failed` or `pr_unmerged_at_done` — see
`runbook-failure-modes.md`.

---

## 10. Stuck-at-NONE_ELIGIBLE

When `caia-chain next-phase` returns `NONE_ELIGIBLE` for too long:

```bash
caia-chain stall-root-cause     # diagnose
caia-chain check-stall --alert-on-streak 2   # ensure the alerting backbone is wired
```

The 2026-05-14 incident pattern: phase 7 was `blocked`; phases 8-11
all depended on 7; `next-phase` returned `NONE_ELIGIBLE` silently for
hours. Now: the wake script counts the streak, alerts at 2 wakes
(30 min), and `stall-root-cause` names the blocker.

---

## 11. Schema migration / state corruption

If `caia-chain status` errors with a schema-version mismatch:

```bash
# All mutating commands take a backup automatically. To see them:
ls -lt ~/.caia/chain/<chain>/.backups/ | head

# Manual restore (rarely needed):
cp ~/.caia/chain/<chain>/.backups/state.json.bak.<iso> \
   ~/.caia/chain/<chain>/state.json
```

Migrations live in `src/migrations.ts`. New schema versions auto-run on
load; the old state file is preserved as `.backups/state.json.bak.pre-migrate.<iso>`.

---

## 12. The "I broke it" recovery

If the chain is in a state nothing fits cleanly:

1. `caia-chain pause --reason 'investigating'`.
2. Inspect `audit.jsonl` end-to-end.
3. Pick the right verb per the table below.
4. `caia-chain resume`.
5. Watch the next wake (`tail -f
   ~/.caia/chain-watchdog/logs/<chain>_<date>.log`).

| Situation | Verb |
|---|---|
| Phase reports `failed` but the work is actually done | `adjudicate --to done` |
| Phase reports `done` but the PR isn't merged | `adjudicate --to failed` then `re-arm --reset-attempts` |
| Phase is `blocked` and you fixed the cause | `re-arm` |
| Worker is hung and won't `mark-done` | `stop --phase <id>` |
| Chain is stuck at `NONE_ELIGIBLE` because a dep is `failed` | `re-arm` the blocker |
| Chain rate-limited; reset time known | wait — auto-resumes via `paused_until` |
| Auth broke | `claude logout && claude login`, then `re-arm --reset-attempts` |
| Whole chain wedged | `pause` → diagnose → fix → `resume` |

---

## 13. Standing-rule violations

The runner pre-dispatch refuses when any of:

- `ANTHROPIC_API_KEY` is set (block; subscription-only billing rule)
- a non-worktree concurrent dispatch is requested while another lock is live
- `--strict-true-zero` is on and any open PR is authored by `@me`

```bash
# Inspect:
caia-chain check-standing-rules --repo prakashgbid/caia [--strict-true-zero]
```

Fix the underlying violation; the next wake will dispatch cleanly. No
state mutation is needed.

---

## 14. Putting it all together — the 2026-05-14 incident, replayed

The chain that motivated this hardening campaign had three failures
overnight:

1. **Phase 3 hung post-success.** PR was merged, artifact existed,
   worker never returned to call `mark-done`. *Before:* lock went
   stale, classifier said `stale_lock`, retry decremented attempts
   for a phase that had really succeeded. *After:* classifier emits
   `worker_hung_post_success`; with `auto_resolve_hung_post_success:
   true`, phase auto-adjudicates to `done`.

2. **Phase 7 rate-limited at dispatch.** Worker spawned, exited in
   2s with the limit banner. *Before:* lock went stale at 60 min,
   classifier said `stale_lock`, attempts decremented to zero,
   chain blocked, NONE_ELIGIBLE for hours, no alert. *After:*
   preflight catches it pre-spawn, writes `paused_until`, chain
   auto-resumes after the reset, no attempts burned.

3. **Phase 11 hit a TCC permission revocation mid-run.** Files in
   `~/Documents` became inaccessible. *Before:* worker would have
   crashed silently. *After:* the doctor section probes
   filesystem access; the operator-recovery path is: grant the
   permission, then `caia-chain re-arm <id> --reset-attempts`.

In every case the recovery is a single CLI invocation. No `jq`, no
hand-edits, no spelunking through state.json.
