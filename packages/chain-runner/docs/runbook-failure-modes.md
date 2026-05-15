# Runbook — failure modes

Authoritative per-`FailureClass` operator playbook. One section per class:
how the runner detects it, the default retry/action policy from
`retry-policy.ts`, the audit signal you'll see, and the one-line recovery
command.

The enum lives at `src/types.ts:142` (`FailureClass`). Default policy lives
at `src/retry-policy.ts:DEFAULT_RETRY_POLICY`. The classifier that maps a
worker log to a class lives at `src/classify.ts:classifyStaleLock`.

> **Recovery convention.** Anywhere this doc shows `<id>` substitute the
> phase id. Every recovery command takes `--chain-id <chain>` and
> `--phases <yaml>` — omitted below for brevity.

---

## worker_no_start_rate_limit

**Symptom.** Spawn succeeded, worker exited within seconds, dispatch log
contains `You've hit your limit, ...` / `5-hour limit reached` /
`reset at <time>`.

**Detection.** `classify.ts` greps the dispatch log for the banner. The
preflight gate (`preflight-dispatch`) usually catches this *before* spawn —
exits with code 2 and refuses to dispatch.

**Default policy.** `{ max_attempts: 0, action: 'pause_until_reset' }`.
Preflight writes `paused_until: <reset-iso>` into `state.json`; the wake
script's `respect_paused_until` shim no-ops until elapsed, then
auto-resumes.

**Audit.** `preflight_dispatch{status:'rate_limited', exit_code:2}` and
(post-classifier) `phase_failed{class:'worker_no_start_rate_limit'}`.

**Recover.**
- Wait for the reset; chain auto-resumes.
- Or override: `caia-chain resume` (un-pauses) then `caia-chain re-arm <id>
  --reset-attempts --reason 'manual resume — rate-limit ack'`.

---

## worker_no_start_auth_failure

**Symptom.** Worker exited fast; log mentions `Invalid authentication
credentials`, `401`, or `Please run 'claude /login'`.

**Detection.** Preflight gate (exit 3) or classifier on the dispatch log.

**Default policy.** `{ max_attempts: 0, action: 'pause_until_operator' }`.
This is an operator-only carve-out: the runner cannot re-auth itself.

**Audit.** `preflight_dispatch{status:'auth_failed'}`, `phase_failed`,
`alert_emitted{type:'operator_action_required'}`.

**Recover.** Interactive: run `claude /logout` then `claude /login`.
Then `caia-chain resume` + `caia-chain re-arm <id> --reset-attempts --reason
'auth re-established'`.

---

## worker_no_start_binary_missing

**Symptom.** Spawn failed with `ENOENT` / `command not found` for the
configured `--spawn` runner shell, or `claude` itself is not on PATH.

**Detection.** `dispatchPhase` (`src/runner.ts`) captures the child's early
exit and writes `dispatch_early_exit_failed{class:'worker_no_start_binary_missing'}`.

**Default policy.** `{ max_attempts: 0, action: 'pause_until_operator' }` —
the missing binary is a configuration problem, not a transient one.

**Recover.** Fix PATH / re-install the binary. Then `caia-chain re-arm <id>
--reset-attempts --reason 'binary restored'`.

---

## worker_no_start_spawn_error

**Symptom.** Spawn failed with a transient error (`EAGAIN`, `EMFILE`, a
race on the runner script's `+x` bit, fork bomb pressure).

**Detection.** Same path as `binary_missing` but classifier sees a
transient errno.

**Default policy.** `{ max_attempts: 3, backoff_sec: [60, 300, 900],
action: 'retry' }`. State annotates `backoff_until: <iso>`; `next-phase`
returns `BACKOFF <secs>` until elapsed.

**Recover.** Usually nothing — the chain retries. If 3 retries exhaust,
inspect `~/.caia/chain/<chain>/audit.jsonl` for the underlying errno and
file an issue. Then `caia-chain re-arm <id> --reset-attempts`.

---

## worker_no_start_bad_args

**Symptom.** Worker exited 2/64/etc within seconds because the dispatcher
invoked it with malformed arguments (commander-style usage error).

**Default policy.** `{ max_attempts: 0, action: 'pause_until_operator' }`.

**Recover.** Fix the runner shell (`~/.caia/chain-watchdog/<chain>_wake.sh`
or the runner shell under `~/Documents/projects/agent-memory/`). Then
`caia-chain re-arm <id> --reset-attempts`.

---

## worker_hung_post_success

**Symptom.** The phase artifact / PR exists and looks good, but the worker
never called `mark-done` — heartbeat stopped, lock went stale.

**Detection.** `classifyStaleLock` checks for artifact presence. When the
artifact exists *and* the worker had a real run window (>1 min, log >1 KB),
the class is `worker_hung_post_success`.

**Default policy.** `{ max_attempts: 0, action: 'adjudicate' }`. With
`chain_config.auto_resolve_hung_post_success: true` (D-1 decision), the
classifier auto-adjudicates the phase to `done` and emits
`phase_auto_adjudicated`.

**Recover.** Auto-handled when the chain opts in. Otherwise:
```
caia-chain adjudicate <id> --to done --reason 'artifact present; worker hung after success' --evidence pr=<url>
```

---

## worker_hung_mid_work

**Symptom.** Heartbeat stopped, no artifact, but the log shows the worker
made real progress (>5 min run time, multiple tool calls).

**Default policy.** `{ max_attempts: 1, backoff_sec: [60], action: 'retry' }`.

**Recover.** Usually retried automatically. If the second attempt also
hangs, treat as `worker_crashed`: investigate the log, then
`caia-chain force-fail <id> --reason 'two hangs in a row'`.

---

## worker_crashed

**Symptom.** Worker exited non-zero after real work (stack trace in log,
SIGSEGV, OOM kill).

**Default policy.** `{ max_attempts: 2, backoff_sec: [120, 600],
action: 'retry' }`.

**Recover.** Inspect the log. If it's a flaky environment issue, let the
retries fire. If it's a real bug in the prompt/runner, fix it, then
`caia-chain re-arm <id> --reset-attempts`.

---

## mark_done_failed

**Symptom.** Worker called `mark-done` but the CLI errored
(transient FS, lock contention, `gate-mark-done.sh` rejected because PR
not yet merged).

**Default policy.** `{ max_attempts: 1, backoff_sec: [60], action: 'retry' }`.

**Recover.** If the PR is open and clean, `caia-chain check-lock-staleness`
(the next wake will retry). For permanent rejection:
`caia-chain adjudicate <id> --to done --reason '...' --evidence pr=<url>`
after manual gate verification.

---

## artifact_missing

**Symptom.** `success_criteria.output_file` configured but the file does
not exist at mark-done.

**Default policy.** `{ max_attempts: 1, backoff_sec: [60], action: 'retry' }`.

**Recover.** Often the worker forgot to write the file. After fixing the
prompt: `caia-chain re-arm <id> --reset-attempts`.

---

## artifact_malformed

**Symptom.** Artifact exists but fails `min_bytes` or `grep_match`.

**Default policy.** `{ max_attempts: 0, action: 'adjudicate' }`. Adjudicate
because the worker thinks it's done — operator must decide.

**Recover.**
```
caia-chain adjudicate <id> --to failed --reason 'artifact malformed: <details>'
caia-chain re-arm <id> --reset-attempts --reason 'fixed artifact spec'
```

---

## pr_unmerged_at_done

**Symptom.** `success_criteria.requires_merged_pr: true` but `gh pr view`
returns OPEN/CLOSED-without-merge at mark-done.

**Detection.** `acceptance.ts` performs the gh check before the state
transition; `mark-done` refuses in strict mode.

**Default policy.** `{ max_attempts: 0, action: 'adjudicate' }`.

**Recover.** Merge the PR manually (or via `caia-pr-merge-or-fail`), then:
```
caia-chain adjudicate <id> --to done --reason 'PR merged out-of-band' --evidence pr=<url>
```

---

## acceptance_failed

**Symptom.** Composite acceptance check failed under `enforce: strict`.

**Default policy.** `{ max_attempts: 0, action: 'adjudicate' }`.

**Recover.** Same shape as `artifact_malformed` — read the acceptance
report, fix, re-arm with reset-attempts.

---

## runtime_exceeded

**Symptom.** `started_at + max_minutes < now` while the lock is still
live. The worker is healthy but the phase is just too slow.

**Default policy.** `{ max_attempts: 0, action: 'alert' }`. The chain
*does not* auto-retry — that would mask a misclassified phase.

**Recover.** Three options:
1. `caia-chain calibrate <phase-name> --p 95` to learn the empirical
   distribution, then bump `max_minutes` in YAML.
2. Split the phase.
3. If a one-off: `caia-chain re-arm <id> --reset-attempts --reason
   'one-off long run; not bumping cap'`.

---

## unknown

**Symptom.** The classifier could not match any pattern. Lock was stale
but the log signature didn't fit any known shape.

**Default policy.** `{ max_attempts: 1, backoff_sec: [60], action: 'retry' }`.
Conservative — one retry, then human.

**Recover.** Inspect `audit.jsonl` and the worker log. If you spot a
pattern that should be classified, file a `classify.ts` test fixture.

---

## Common ground — three first-pass diagnostics

When any phase fails, three commands answer "what happened":

```
caia-chain stall-root-cause              # walks the dep graph from any in_progress/pending phase
caia-chain audit-tail -n 40              # last 40 audit events (phase transitions, alerts, etc.)
caia-chain doctor                        # one-shot health summary (locks, orphans, network, gh-auth, disk)
```

See `operator-recovery.md` for the full adjudication playbook and
`audit-events.md` for every event name + payload shape you'll see.
