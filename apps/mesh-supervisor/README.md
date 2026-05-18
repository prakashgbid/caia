# @caia-app/mesh-supervisor

P5 Agent-Mesh supervisor. LangGraph 1.2 + PostgresSaver + A2A v1 dispatch.

Per `~/Documents/projects/agent-memory/decisions/p4_agent_mesh_implementation_plan_2026_05_16.md` §3 M0 + §4.

## Layout

```
apps/mesh-supervisor/
├── package.json         # Hono TS front (M1 wiring still pending — see status)
├── python/
│   ├── requirements.txt # langgraph 1.2 + a2a-sdk 1.0 + letta 0.6 + psycopg
│   ├── state.py         # CaiaMeshState TypedDict + reducers per §4.3
│   ├── checkpointer.py  # PostgresSaver bound to mesh_supervisor schema
│   ├── supervisor.py    # LangGraph graph: intake → echo → [sql_compose] → terminal
│   ├── xiyansql_agent.py# A2A wrapper around XiYanSQL (mock + real modes)
│   ├── smoke_test.py    # M0 smoke test (echo only)
│   └── m1_smoke_test.py # M1 smoke test (full chain through XiYanSQL)
└── .venv/               # Python 3.13 venv (gitignored)
```

## Quick-start

```bash
# 1. Open the SSH tunnel to the CAIA Postgres on stolution (dev only)
ssh -fN -L 15432:127.0.0.1:5432 stolution

# 2. Activate the venv
source .venv/bin/activate

# 3. Smoke-test the M0 path (echo graph, no specialist)
MESH_PG_URL='postgresql://stolution:****@127.0.0.1:15432/stolution' \
    python python/smoke_test.py

# 4. Start the XiYanSQL agent (mock mode — flips to real once weights are on disk)
XIYAN_SQL_MODE=mock python python/xiyansql_agent.py &

# 5. Smoke-test the M1 path (supervisor → A2A → XiYanSQL → SQL artifact)
MESH_PG_URL='postgresql://stolution:****@127.0.0.1:15432/stolution' \
    python python/m1_smoke_test.py
```

## Flipping to real XiYanSQL

Once `~/.chiefaia/models/xiyansql-32b-q4km/XiYanSQL-QwenCoder-32B-2504.Q4_K_M.gguf`
is on disk (background download in progress as of 2026-05-17):

```bash
# Option A: serve the GGUF via llama-server (already on PATH if llama.cpp installed)
llama-server -m ~/.chiefaia/models/xiyansql-32b-q4km/XiYanSQL-QwenCoder-32B-2504.Q4_K_M.gguf \
    --host 127.0.0.1 --port 8411 --metal -c 8192 &

XIYAN_SQL_MODE=xiyansql MLX_LM_URL=http://127.0.0.1:8411 \
    python python/xiyansql_agent.py
```

Option B (MLX): see `~/Documents/projects/agent-memory/decisions/p5_m0_m1_execution_2026_05_17.md`
for the convert + serve recipe.

The flip is a single env var on the same agent endpoint — no rewiring of
the supervisor, the a2a-adapter, or any consumer of `@chiefaia/sql-helper`.

## Plan deviations

Documented in `p5_m0_m1_execution_2026_05_17.md` §"plan-vs-reality". TL;DR:

- `langgraph-checkpoint-postgres` jumped to 3.x; plan said 1.2.*
- `a2a-sdk` is 1.0.x; plan said 1.2.*
- `letta` is 0.6.x; plan said 0.5.* (0.5.x retired upstream)
- TS A2A SDK is `@a2a-js/sdk` (not `@a2a/sdk` as the plan said)
- `backend-core` was a Supabase wrapper with no NL→SQL helper to replace,
  so the helper lives in the new `@chiefaia/sql-helper` package per §3 M0 spirit.
