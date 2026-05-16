# Thin Spawner — minimal Claude scheduled task that drains the spawn queue

**Architecture role**: bridge between the local-first state files (written by
`local-poller.sh` / `idle-detector.sh`) and the Cowork dispatch API. The local
scripts cannot call `mcp__cowork__start_task` — that requires a Claude
session. The Thin Spawner IS that minimal session: it reads the queue, calls
start_task once per item, exits.

**Cost target**: < 1 K tokens per run on idle ticks (queue empty, exits
immediately). < 5 K tokens per run when actually spawning (one start_task
call + 1-2 file reads to compose the spawn prompt).

**Why "thin"**: the operator's 2026-05-08 token-cost constraint requires that
the Cowork scheduled-task layer add no meaningful overhead. The poller runs
every minute (essentially free, pure bash). The Thin Spawner runs every 5
minutes — most ticks are no-ops; only ~10-20 ticks/day actually spawn.

## Scheduled-task definition

```json
{
  "taskId": "thin-spawner",
  "description": "Drains ~/.cache/orchestrator/spawn_queue. Pure mechanical: read queue, dispatch each line, exit. NO reasoning step. Runs every 5 minutes.",
  "cronExpression": "*/5 * * * *",
  "notifyOnCompletion": false,
  "prompt": "<see prompt template below>"
}
```

## Prompt template (kept under 500 tokens)

```text
<!-- STANDING-RULE-SENTINEL v2 -->
READ FIRST — these files override defaults:
  agent-memory/feedback_24_7_bulletproof_2026-05-08.md (highest)
  agent-memory/feedback_decision_classifier.md
  agent-memory/feedback_operator_does_not_code.md
  agent-memory/feedback_self_perpetuating_campaigns.md
  agent-memory/feedback_zero_dollar_budget_2026-05-08.md
  agent-memory/decision_defaults.yaml
Pipe every operator-facing draft through scripts/orchestrator/pre-send-classifier.sh.
On clean exit, spawn the next item from master_backlog_sequencing — never go idle.
<!-- /STANDING-RULE-SENTINEL v2 -->

You are the Thin Spawner. Mechanical loop only. NO reasoning, NO research,
NO operator-facing posts.

1. Run via Bash:
     QUEUE=~/.cache/orchestrator/spawn_queue
     if [[ ! -s $QUEUE ]]; then echo "queue-empty"; exit 0; fi
     head -n1 $QUEUE
     # this prints e.g. "B6.W1"

2. If output was "queue-empty", exit immediately. Done.

3. Otherwise resolve the item id to a directive path:
     ITEM=<id from above>
     DIR=~/Documents/projects/agent-memory/${ITEM}_directive.md
     if not exists, fall back to:
     DIR=~/Documents/projects/agent-memory/$(echo ${ITEM} | tr '[:upper:]' '[:lower:]')_directive.md

4. Compose spawn prompt = sentinel-block + directive content +
   10-stage DoD reminder. Use scripts/orchestrator/inject-sentinel.sh
   (pure bash) — no LLM call.

5. Call mcp__cowork__start_task with the composed prompt.

6. Pop the queue:
     sed -i '' '1d' $QUEUE   # mac
     sed -i '1d' $QUEUE       # linux

7. Append audit entry:
     echo "$(date -u +%Y-%m-%dT%H:%M:%SZ)\tspawned\t${ITEM}" \
       >> ~/.cache/orchestrator/spawn_log.tsv

8. Exit. No operator-facing message.

If start_task fails (transient API error, etc.):
  - leave item in queue for next tick
  - log failure to ~/.cache/orchestrator/spawn_failures.tsv
  - exit 0 (do NOT retry within this run)

If start_task fails 3+ times for the same item (read spawn_failures.tsv):
  - move item to ~/.cache/orchestrator/spawn_dead_letter
  - touch ~/.cache/orchestrator/audit_anomaly with
    {"kind":"spawn_dead_letter","item":"${ITEM}"}
  - the alerter will surface this on its next tick
```

## Cost analysis

- **Idle tick** (queue empty): runs `[[ -s queue ]]` → false → echo
  "queue-empty" → exit. About 200 tokens of context + 500 tokens of prompt
  per Anthropic's minimum session overhead. Total ~700 tokens. At 288 idle
  ticks/day (every 5 min): ~200K tokens/day.
- **Spawning tick**: 1 file read for directive (1-3 KB), 1 inject-sentinel
  call, 1 start_task call. ~3-5 K tokens. Maybe 20 spawns/day → 60-100K
  tokens/day.
- **Combined**: ~300K tokens/day for the entire spawn-driver layer. Compare
  with orchestrator's existing burn (millions of tokens/day for actual code
  work). This is well under the 1% budget the operator set.

## Why two layers (poller + spawner) instead of one Claude session

The poller MUST run every minute (or even more frequently) to catch idle
gaps quickly. Running a Claude session every minute would cost on order of
700K tokens/day even on no-op ticks — too expensive.

Splitting:
- The minute-frequency loop is pure bash (free).
- The 5-minute Claude tick is genuinely cheap (the session has nothing to do
  on idle ticks).

This is the local-first / pull-based queue pattern: cheap producer, expensive
consumer kept lazy.
