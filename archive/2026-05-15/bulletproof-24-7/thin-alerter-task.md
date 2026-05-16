# Thin Alerter — minimal Claude scheduled task that surfaces anomalies

**Architecture role**: the local poller / idle-detector / heartbeat-auditor
write *anomaly markers* to `~/.cache/orchestrator/`. The Thin Alerter is the
Claude session whose job is to read those markers and post a brief
SendUserMessage to the operator. It runs every 15 minutes and exits silently
unless markers are present.

**Why a Claude session at all**: SendUserMessage is the operator's surface in
Cowork. A bash script cannot post there. The Thin Alerter is the minimal
adapter between local-first state and the operator's Cowork inbox.

## Scheduled-task definition

```json
{
  "taskId": "thin-alerter",
  "description": "Reads ~/.cache/orchestrator/{idle_notify_pending,audit_anomaly,spawn_dead_letter}. Posts ONE SendUserMessage if any are present, then clears them. Otherwise silent exit.",
  "cronExpression": "*/15 * * * *",
  "notifyOnCompletion": false,
  "prompt": "<see prompt template below>"
}
```

## Prompt template

```text
<!-- STANDING-RULE-SENTINEL v2 -->
READ FIRST — agent-memory/feedback_24_7_bulletproof_2026-05-08.md, agent-memory/feedback_decision_classifier.md
<!-- /STANDING-RULE-SENTINEL v2 -->

You are the Thin Alerter. Pure mechanical alerting. NO reasoning beyond
formatting the marker contents into a user message.

1. Run Bash:
     CACHE=~/.cache/orchestrator
     for f in idle_notify_pending audit_anomaly spawn_dead_letter; do
       [[ -f $CACHE/$f ]] && echo "==MARKER:$f==" && cat $CACHE/$f
     done

2. If output is empty: exit silently. Done.

3. If markers exist: compose ONE SendUserMessage that lists them. Use
   factual format only — no asking, no decision-presenting:

     ⚠️ Bulletproof watchdog alert (auto-generated, 24/7 stack):
     • <kind>: <summary>
     • next action taken: <e.g., spawned B6.W1 from queue>
     • full marker: <one-line snippet>

   Pipe the draft through pre-send-classifier.sh BEFORE sending.
   If classifier exits non-zero, REVISE to remove banned phrasing — do NOT
   ask. The driver has already taken the decisive action; you're just
   reporting.

4. Call SendUserMessage with the composed text.

5. Clear the markers:
     rm -f $CACHE/idle_notify_pending $CACHE/audit_anomaly $CACHE/spawn_dead_letter

6. Exit. Done.

If SendUserMessage fails: leave markers in place; next tick retries.
```

## Cost analysis

Most ticks (no markers): bash check → empty → exit. ~700 tokens. 96
ticks/day (every 15 min) → 67K tokens/day.

Tick-with-marker: + 1 SendUserMessage. Maybe 5-10 such ticks/day max. + 5K
tokens each.

**Total: ~120K tokens/day. Under the cost budget.**

## Why 15 minutes (not 5)

Alerting at 5-min cadence creates noise. 15 min matches the operator's
cadence preference (per `feedback_hourly_status_updates.md` cadence is the
hour; 15 min for proactive alerts only). Anomalies that need faster surface
(e.g., critical spend-guard) write to a separate "urgent" marker file that
the poller checks every minute and the alerter reads first if present.
