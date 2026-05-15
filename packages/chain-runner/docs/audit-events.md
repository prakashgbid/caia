# Audit events reference

Every event name appended to `~/.caia/chain/<chain-id>/audit.jsonl`,
its payload shape, and an example. Authoritative source: the
`AUDIT_EVENTS` constant at `src/audit-schema.ts:49`.

## Schema contract

Each audit line is one JSON object with at minimum:

```json
{ "ts": "2026-05-14T18:08:08Z", "event": "<name>", ... }
```

`ts` is ISO-8601 UTC. `event` is one of the registered names below. The
registry declares each event's `required` fields with primitive types
(`string` / `number` / `boolean` / `object` / `array`). Extra fields are
allowed; the registry is a permissive minimum schema.

Set `CAIA_VALIDATE_AUDIT=1` to make `assertValidAudit` throw on missing
required fields (used in tests; no-op in production).

---

## Lifecycle

### `state_init`
First write of `state.json`. Payload: `phases: number`.
```json
{"ts":"2026-05-14T18:00:00Z","event":"state_init","phases":12}
```

### `state_migrated`
state.json migrated through `migrations.ts` (e.g., v1→v2 added
`paused_until`, `none_eligible_streak`, `last_failure_class`).
```json
{"ts":"...","event":"state_migrated","from":1,"to":2}
```

### `wake`
Wake-tick fired. Recorded by `caia-chain wake-observed`.
```json
{"ts":"...","event":"wake"}
```

### `paused` / `resumed`
Operator-issued pause / resume. Payload optional `reason: string`.

### `chain.paused` / `chain.unpaused` / `chain.retired`
Free-form chain-level operator events with arbitrary inventory payload.

### `all_done`
Final phase reached `done`. Terminal event for the chain.

### `none_eligible`
A wake produced no dispatchable phase. Payload: `streak: number`. The
`check-stall --alert-on-streak <n>` verb escalates when streak ≥ n.
```json
{"ts":"...","event":"none_eligible","streak":2}
```

### `budget_update`
`budget_consumed_pct` changed. Payload: `pct: number`.

---

## Phase transitions

### `phase_in_progress`
Lock acquired; attempt started. Required:
- `phase_id: number`
- `session_id: string`
- `attempt: number`

```json
{"ts":"...","event":"phase_in_progress","phase_id":3,"session_id":"phase3-...","attempt":1}
```

### `phase_done`
`mark-done` completed; lock cleared. Required: `phase_id: number`.

### `phase_failed`
`mark-failed` or stale-lock classifier marked a failure. Required:
- `phase_id: number`
- `reason: string`

Adds: `class: FailureClass`, `evidence: object` when emitted by the
classifier path. The retry policy may still rescue the phase (one of
the `BACKOFF <sec>` paths in `next-phase`).

```json
{
  "ts":"...","event":"phase_failed","phase_id":4,
  "reason":"rate limit; reset at 2026-05-14T19:00Z",
  "class":"worker_no_start_rate_limit",
  "evidence":{"log_grep":"You've hit your limit"}
}
```

### `phase_blocked`
Failed→blocked promotion (retries exhausted). Required: `phase_id`,
`reason`.

### `phase_adjudicated`
Operator-issued transition via `caia-chain adjudicate`. Required:
`phase_id`. Carries: `to: PhaseStatus`, `reason: string`,
`evidence: object`.

### `phase_auto_adjudicated`
The `worker_hung_post_success` auto-resolve path
(`chain_config.auto_resolve_hung_post_success: true`). Required:
`phase_id`.

### `phase_rearmed`
Operator re-armed a blocked phase to `pending`. Required: `phase_id`.

### `phase_force_failed`
Operator force-failed a phase. Required: `phase_id`.

### `phase_acceptance_ok` / `phase_acceptance_warn` / `phase_acceptance_failed`
`success_criteria` validation outcomes. Required: `phase_id`.
`_warn` fires in `warn` mode (mark-done proceeds), `_failed` fires in
`strict` mode (mark-done refused).

---

## Attempt loop

### `attempt_started`
A new dispatch attempt begins. Required: `phase_id`, `session_id`.

### `attempt_completed`
A dispatch attempt ended. Required: `phase_id`, `session_id`. Adds
`ran_substantively: boolean` — when false, `attempts++` is suppressed
(H-2: no-start retries are free).

---

## Dispatch

### `dispatch_spawned`
Background worker spawned. Required: `phase_id`, `session_id`,
`pid: number`. Adds `prompt_file: string`.

### `dispatch_log_open_failed`
Could not open the dispatch log for write — usually an FS perm issue.

### `dispatch_early_exit_clean` / `dispatch_early_exit_failed`
Worker exited within the 5s early-exit window with code 0 / non-zero.
The `_failed` variant carries `class: FailureClass` and `exit_code`.

---

## Lock

### `lock_cleared`
Lock removed. Required: `phase_id`, `reason: string` (one of
`mark_done`, `mark_failed`, `stale_heartbeat`, `stale_runtime`,
`operator_stop`, etc).

---

## Preflight

### `preflight_dispatch`
Result of `caia-chain preflight-dispatch`. Required:
- `status: string` (`ok` | `rate_limited` | `auth_failed` | `timeout`
  | `unknown` | `api_key_set`)
- `exit_code: number`

Adds `reset_at: string` on rate-limit detection.

### `preflight_healthz`
mentor + router `/healthz` summary. Required: `ok: boolean`. Adds
`results: HealthzCheckResult[]`.

### `preflight_verified`
Wake-event verification (cron-firing check post-bootstrap). Required:
`ok: boolean`.

---

## Watchdog

### `cron_stall_detected`
`last_wake` age exceeded `WAKE_STALL_THRESHOLD_SEC`. Required:
`age_sec`, `threshold_sec`.

### `cron_reregister_attempted` / `cron_reregister_skipped`
Watchdog tried (or skipped) re-bootstrapping the chain's LaunchAgent.

---

## Reap

### `orphan_reaped`
Stray worker terminated by `reap-orphans`. Required: `phase_id`,
`pid: number`. Adds `age_sec`, `signal: string` (`SIGTERM`/`SIGKILL`).

---

## Alerting

### `alert_emitted`
Alert fan-out completed (handoff + inbox + notification + audit per
`chain_config.alert_channels`). Adds `type: string`, `severity: string`,
`channels: string[]`, `detail: string`.

### `alert_suppressed_duplicate`
The 6-hour dedupe matched an existing fingerprint — alert not re-sent.

---

## Adding a new event

1. Add the spec to `AUDIT_EVENTS` in `src/audit-schema.ts`.
2. Emit via `appendAudit(ctx, '<name>', { ...payload })`.
3. Add a fixture in `tests/audit-schema.test.ts`.

`isKnownAuditEvent(name)` and `validateAudit(name, payload)` are the
two helpers tests should call.

## Reading the log

```bash
# Last N events
caia-chain audit-tail -n 30 --chain-id <chain> --phases <yaml>

# Aggregate stats
caia-chain stats --chain-id <chain> --phases <yaml>

# Calibrate phase max_minutes from history
caia-chain calibrate <phase-name> --p 95 --chain-id <chain> --phases <yaml>
```
