# `@chiefaia/local-llm-router-py-client`

Python client for the local-llm-router HTTP daemon. Vendored into
`claude_spawner_agent.py` deployments to add the **pre-spawn classify-and-maybe-route gate** (L9/L10 of the Local-LLM-First build plan).

## Why a separate package

The spawner is operator-deployed Python sitting outside the npm workspace
graph. We still want the routing-client code under version control in caia
so the M3 + stolution copies stay in sync. This package is the source of
truth; deployments vendor `src/local_llm_router_client.py` next to their
`claude_spawner_agent.py`.

## Installation (deployment)

```bash
# On M3 (when M3 spawner enrollment completes):
cp src/local_llm_router_client.py \
   ~/Documents/projects/reports/claude-spawner-agent/

# On stolution:
ssh stolution 'cat' > /home/s903/apps/claude-spawner/local_llm_router_client.py < src/local_llm_router_client.py
```

Then apply `src/spawner_patch.diff` with `patch -p0` from the spawner's
working directory. Restart the spawner.

## Environment variables (read by the patch)

| Var | Default | Description |
|---|---|---|
| `LOCAL_LLM_ROUTER_URL` | `http://100.68.247.58:7411` | M3 Tailscale-private daemon URL |
| `LOCAL_LLM_ROUTER_TIMEOUT` | `10.0` | Per-call HTTP timeout (seconds) |
| `ROUTER_GATE_ENABLED` | `true` | Set to `false` to bypass the gate without redeploying |

## Smoke test

```bash
python3 src/local_llm_router_client.py "rename foo to bar in helpers.ts"
```

Expected output: `intent: rename`, `recommended_tier: local-7b`, then a
local-7b response. If the daemon is unreachable, the helper returns
`(None, {tier: "claude", reason: "router-unreachable"})` so the caller
falls through to the existing claude subprocess.

## Operator approval required before merge

The reference patch in `src/spawner_patch.diff` modifies the `/spawn`
handler — production-critical code. Operator should review the diff,
test on a non-production spawner first, and apply with `patch -p0`
manually. Do NOT auto-deploy.

## B15.C — v2 spawn prompt + strict JSON output schema

The `templates/spawn_prompt_v2.md` + `src/spawn_prompt_loader.py` ship the
v2 spawn template that replaces `build_prompt_real_edit` in
`claude_spawner_agent.py`. Design authority:
`~/Documents/projects/agent-memory/reliability_99pct_design_2026-05-11.md`
§6.2.2.

Wire-up (reference): `src/spawner_patch_v3.diff`.
Output schema: `templates/spawn_output_schema.v2.json`.

The v2 template injects four contract sections — `acceptance_criteria`,
`file_scope`, `tests_required`, `dod_required_stages` — from the task's
`prompt_material` (populated by the orchestrator's BA/EA agents via UDP),
and demands the implementor emit a strict-JSON final line that the spawner
validates before deciding outcome. The B15.D VERIFIER spawn reads the
same JSON to grade the diff independently.

### Env knob for rollback

| Var | Default | Description |
|---|---|---|
| `SPAWN_PROMPT_VERSION` | `v2` | Set to `v1` for emergency rollback to legacy prompt (no AC, no schema, rc-only outcome). |

### Run the tests

```bash
cd packages/local-llm-router-py-client
python3 -m unittest tests.test_spawn_prompt_v2 -v
```

Eighteen tests cover template rendering, env-driven version dispatch,
the strict schema validator (positive + 6 negatives), and an end-to-end
fixture task ("add SPDX header to file X") that renders the v2 prompt
and validates a simulated spawn output against the schema.
