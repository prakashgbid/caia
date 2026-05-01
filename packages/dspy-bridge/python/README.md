# caia-dspy-bridge (Python side)

Owned by `@chiefaia/dspy-bridge`. Don't run directly — the Node bridge
spawns this via `uv run --directory python python -m caia_dspy_bridge.server`.

## Layout

- `caia_dspy_bridge/server.py`   — JSON-Lines RPC server on stdin/stdout
- `caia_dspy_bridge/lm.py`       — DSPy LM adapter that calls Ollama HTTP
- `caia_dspy_bridge/programs/`   — registered DSPy modules (one file per
                                   program, e.g. `po_scope_detector.py`)
- `caia_dspy_bridge/storage.py`  — load/save compiled pickles + CURRENT
                                   pointer file
- `caia_dspy_bridge/smoke.py`    — manual smoke check (`pnpm py:smoke`)

## Bootstrap

```bash
pnpm --filter @chiefaia/dspy-bridge run py:bootstrap
```

Runs `uv sync` against `pyproject.toml`, materialising a venv under
`python/.venv`. `uv` is the pinned package manager; never `pip install`
into system Python.
