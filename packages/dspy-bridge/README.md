# @chiefaia/dspy-bridge

> **Substrate pick #1** — DSPy as the new prompt substrate, per the AI tech
> modernization proposal §6. This package is the Node ↔ Python bridge.

## What it does

CAIA is a TypeScript codebase but DSPy is Python-only. This package owns
the Node side of a sub-process bridge:

- spawns a `uv`-pinned Python interpreter (no system pollution)
- speaks JSON-Lines RPC over stdin/stdout
- exposes typed `loadProgram()` / `predict()` / `compile()` calls
- routes all model traffic through `@chiefaia/local-llm-router` so the
  Ollama-default / Claude-binary-on-quality-breach contract is honoured
  on the Python side too (the Python LM adapter calls back via HTTP into
  a small loopback that fronts the router)

## Hard constraints

- **No API key.** Claude path is the binary subscription only — same
  rule as the rest of CAIA. The Python adapter never reads
  `ANTHROPIC_API_KEY`.
- **Local-first.** Default model is `qwen2.5-coder:7b` via Ollama.
- **No system pollution.** Python deps are isolated under `python/`
  managed by `uv` — never `pip install` into system Python.

## Usage (TypeScript)

```ts
import { DspyBridge } from '@chiefaia/dspy-bridge';

const bridge = new DspyBridge();
await bridge.start(); // spawns uv-pinned Python sub-process

const out = await bridge.predict({
  program: 'po-scope-detector',
  version: 'latest',
  input: {
    promptText: 'add a logout button to the user-menu dropdown',
  },
});
// out.targetScope === 'story'

await bridge.stop();
```

## Lifecycle

A bridge instance owns one Python sub-process. The sub-process keeps
loaded DSPy programs warm so `predict()` is hot-path; cold-start is
~700–900 ms on an M1 Pro because DSPy + the Ollama LM adapter import
once per process.

## Files

- `src/bridge.ts` — Node-side bridge (spawn, JSONL, lifecycle)
- `src/protocol.ts` — wire-protocol types shared with Python
- `python/caia_dspy_bridge/` — Python source (server + LM adapter)
- `python/pyproject.toml` — uv-managed deps (dspy-ai, pydantic)
- `python/bootstrap.sh` — installs the Python env via `uv sync`
