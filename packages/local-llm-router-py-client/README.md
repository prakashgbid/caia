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

## SPS-Prompting phase α — claude-argv builder (A.9.3 + A.9.6)

`src/spawner_argv.py` is a zero-dep helper that builds the subprocess argv
the spawner feeds to `subprocess.Popen`. Reference patch
`src/spawner_patch_v4.diff` wires it into `run_claude()` and adds six new
env knobs that the operator can flip without redeploying:

| Var | Default | Description |
|---|---|---|
| `HEADROOM_BINARY` | `/opt/homebrew/bin/headroom` | Headroom CLI path |
| `HEADROOM_WRAP_DISABLE` | `` | Set to `1` to bypass the wrap (kill-switch) |
| `HEADROOM_PROXY_PORT` | `8787` | Base proxy port |
| `HEADROOM_PROXY_OFFSET` | `0` | Add to port (use when cap > 1 spawns concurrently) |
| `HEADROOM_REUSE_PROXY` | `` | Set to `1` if a long-lived `headroom proxy` daemon is running |
| `STABILIZE_PREFIX_DISABLE` | `` | Set to `1` to drop `--exclude-dynamic-system-prompt-sections` |

When `HEADROOM_BINARY` exists on disk and the kill-switch is off, the spawn
argv is prefixed with:

```text
<HEADROOM_BINARY> wrap claude --port <port> --no-mcp --no-serena --no-context-tool --
```

so every Anthropic API call routes through the local compression proxy
(target: 30–50 % input-token reduction with ≥97 % accuracy per published
headroom benchmarks). When the binary is missing — e.g. stolution today —
the wrap is silently skipped (fail-open) so a single code path covers both
hosts.

Independently, the claude argv always carries
`--exclude-dynamic-system-prompt-sections` (unless `STABILIZE_PREFIX_DISABLE=1`)
so cwd/env/memory/git-status moves out of the cached system prefix into
the first user message — the precondition for Anthropic's 90 % prompt-cache
discount to hit the standing-rules prefix every spawn shares.

### Tests

```bash
cd packages/local-llm-router-py-client
python3 -m unittest tests.test_spawner_argv -v
```

Twelve tests pin the decision tree: wrap-on/off (kill-switch, missing
binary, empty binary), prefix-on/off, port offset, reuse-proxy flag,
allow-list expansion, permission-mode + max-turns threading, and the
`--print` long-form requirement (avoids the `-p` ↔ `--port` collision
in `headroom wrap claude`).
