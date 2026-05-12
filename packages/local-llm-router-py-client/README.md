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
