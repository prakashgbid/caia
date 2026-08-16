# CAIA Kernel — Temporal Example (STOL-1035)

Minimal end-to-end proof that Temporal server on stolution accepts
workflow registrations and drives them to completion.

## Layout
- `worker.py` — Python worker registering the workflow + activity.
- `starter.py` — starts one workflow execution and prints the result.
- `workflows.py` — `GreetingWorkflow` (durable) + `compose_greeting` activity.
- `client_ts_example.md` — TS starter snippet using `@temporalio/client` for reference.

## Namespace + task queue
- Namespace: `caia`
- Task queue: `caia.factories.default`

## Run (from stolution box)
```
export TEMPORAL_HOST=127.0.0.1:7233
python3 -m venv .venv && source .venv/bin/activate
pip install temporalio==1.9.0
# Terminal 1
python worker.py
# Terminal 2
python starter.py "CAIA Kernel"
```
Expected output: `Result: Hello, CAIA Kernel from CAIA Temporal!`

Then verify in the UI: https://temporal.stolution.com/namespaces/caia/workflows
