"""
JSON-Lines RPC server that fronts DSPy.

Wire protocol (mirrors packages/dspy-bridge/src/protocol.ts):

  request:  { id, method, params }
  response: { id, ok: true,  result }
       OR:  { id, ok: false, error: { code, message, detail? } }

Methods: ping, load_program, predict, compile, list_programs, shutdown.

The server is single-threaded — one JSON line in, one JSON line out. The
TypeScript bridge is also single-flight per instance, so this matches the
intended concurrency model.

Runs as `python -m caia_dspy_bridge.server`. STDOUT carries protocol
JSON only; STDERR carries human-readable logs.
"""

from __future__ import annotations

import json
import sys
import time
import traceback
from pathlib import Path
from typing import Any

# DSPy import is deferred until we actually need it — the import is
# heavy (~600 ms on M1 Pro) and we want `ping` to come back fast on
# warm-up.
_DSPY: Any = None
_LM: Any = None
_LOADED: dict[tuple[str, str], Any] = {}
_START_MS = time.monotonic()


def _now_ms() -> int:
    return int(time.monotonic() * 1000)


def _log(msg: str) -> None:
    sys.stderr.write(f"[server] {msg}\n")
    sys.stderr.flush()


def _ensure_dspy() -> Any:
    global _DSPY, _LM
    if _DSPY is None:
        import dspy as _dspy_module  # noqa: WPS433 — deferred on purpose
        from caia_dspy_bridge.lm import OllamaLM

        _DSPY = _dspy_module
        _LM = OllamaLM()
        _DSPY.configure(lm=_LM)
        _log(f"dspy configured with OllamaLM(model={_LM.model}, host={_LM.host})")
    return _DSPY


# ─── Method handlers ─────────────────────────────────────────────────────


def handle_ping(params: dict[str, Any]) -> dict[str, Any]:
    py_ver = sys.version.split()[0]
    try:
        import dspy
        dspy_ver = getattr(dspy, "__version__", "unknown")
    except Exception:  # noqa: BLE001
        dspy_ver = "not-loaded"
    return {
        "pong": True,
        "pyVersion": py_ver,
        "dspyVersion": dspy_ver,
        "uptimeMs": _now_ms() - int(_START_MS * 1000),
    }


def handle_load_program(params: dict[str, Any]) -> dict[str, Any]:
    from caia_dspy_bridge import storage
    from caia_dspy_bridge.programs import get_program

    program = params["program"]
    version = params["version"]
    resolved = storage.resolve_version(program, version)
    cache_key = (program, resolved)
    if cache_key not in _LOADED:
        # Make sure the program module is importable (validates registration).
        get_program(program)
        compiled = storage.load_program(program, resolved)
        _LOADED[cache_key] = compiled
    pickle = storage.pickle_path(program, resolved)
    return {"program": program, "version": resolved, "pickle": str(pickle)}


def handle_predict(params: dict[str, Any]) -> dict[str, Any]:
    from caia_dspy_bridge import storage
    from caia_dspy_bridge.programs import get_program

    _ensure_dspy()  # idempotent
    program = params["program"]
    version = params["version"]
    input_dict = params["input"]
    resolved = storage.resolve_version(program, version)

    cache_key = (program, resolved)
    module = _LOADED.get(cache_key)
    prog_module = get_program(program)
    if module is None:
        try:
            module = storage.load_program(program, resolved)
        except FileNotFoundError:
            # Fallback: build the uncompiled module. Useful for first
            # predict before any compile lands. Quality is the same as
            # the hand-written prompt at that point.
            module = prog_module.build_module()
        _LOADED[cache_key] = module

    started = _now_ms()
    kwargs = prog_module.to_input_args(input_dict)
    pred = module(**kwargs)
    duration_ms = _now_ms() - started
    output = prog_module.from_prediction(pred)

    model = _LM.model if _LM is not None else "unknown"
    return {"output": output, "model": model, "durationMs": duration_ms}


def handle_compile(params: dict[str, Any]) -> dict[str, Any]:
    from caia_dspy_bridge import storage
    from caia_dspy_bridge.programs import get_program

    dspy = _ensure_dspy()
    from dspy.teleprompt import MIPROv2

    program = params["program"]
    optimizer = params.get("optimizer", "miprov2")
    if optimizer != "miprov2":
        raise ValueError(f"unsupported optimizer: {optimizer}")
    trainset_path = Path(params["trainsetPath"])
    evalset_path = Path(params["evalsetPath"])
    out_dir = Path(params["outDir"])
    out_dir.mkdir(parents=True, exist_ok=True)
    max_demos = int(params.get("maxBootstrappedDemos", 4))

    prog_module = get_program(program)

    trainset = _load_jsonl_examples(dspy, trainset_path, prog_module)
    evalset = _load_jsonl_examples(dspy, evalset_path, prog_module)

    student = prog_module.build_module()

    metric = prog_module.score  # callable(pred, label) -> float

    teleprompter = MIPROv2(
        metric=lambda gold, pred, trace=None: metric(pred, gold),
        auto="light",
    )
    compiled = teleprompter.compile(
        student=student,
        trainset=trainset,
        valset=evalset,
        max_bootstrapped_demos=max_demos,
        max_labeled_demos=max_demos,
        requires_permission_to_run=False,
    )

    new_score = _score_on(dspy, compiled, evalset, metric)
    prev_version = storage.current_version(program)
    prev_score = None
    if prev_version is not None:
        try:
            prev = storage.load_program(program, prev_version)
            prev_score = _score_on(dspy, prev, evalset, metric)
        except FileNotFoundError:
            prev_score = None

    new_version = storage.next_version(program)
    pickle_p = storage.save_program(program, new_version, compiled)

    delta = None if prev_score is None else (new_score - prev_score)

    return {
        "program": program,
        "pickle": str(pickle_p),
        "version": new_version,
        "newScore": float(new_score),
        "prevScore": None if prev_score is None else float(prev_score),
        "delta": None if delta is None else float(delta),
    }


def handle_list_programs(params: dict[str, Any]) -> dict[str, Any]:
    from caia_dspy_bridge import storage
    from caia_dspy_bridge.programs import known_programs

    out = []
    for p in known_programs():
        out.append({
            "program": p,
            "versions": storage.list_versions(p),
            "current": storage.current_version(p),
        })
    return {"programs": out}


# ─── Helpers ─────────────────────────────────────────────────────────────


def _load_jsonl_examples(dspy: Any, path: Path, prog_module: Any) -> list[Any]:
    examples = []
    with path.open("r", encoding="utf-8") as fh:
        for raw in fh:
            line = raw.strip()
            if not line:
                continue
            obj = json.loads(line)
            inp = obj["input"]
            label = obj.get("label", {})
            kwargs = prog_module.to_input_args(inp)
            ex = dspy.Example(**kwargs, **label).with_inputs(*kwargs.keys())
            examples.append(ex)
    return examples


def _score_on(dspy: Any, module: Any, evalset: list[Any], metric: Any) -> float:
    if not evalset:
        return 0.0
    total = 0.0
    n = 0
    for ex in evalset:
        try:
            inputs = ex.inputs().toDict() if hasattr(ex, "inputs") else dict(ex)
            pred = module(**inputs)
            total += float(metric(pred, ex))
            n += 1
        except Exception as exc:  # noqa: BLE001
            _log(f"score eval skipped a row: {exc}")
    return total / n if n else 0.0


# ─── Dispatch ────────────────────────────────────────────────────────────


_HANDLERS = {
    "ping": handle_ping,
    "load_program": handle_load_program,
    "predict": handle_predict,
    "compile": handle_compile,
    "list_programs": handle_list_programs,
}


def _emit(obj: dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(obj, separators=(",", ":")) + "\n")
    sys.stdout.flush()


def _ok(rid: str, result: Any) -> None:
    _emit({"id": rid, "ok": True, "result": result})


def _err(rid: str, code: str, message: str, detail: Any = None) -> None:
    err: dict[str, Any] = {"code": code, "message": message}
    if detail is not None:
        err["detail"] = detail
    _emit({"id": rid, "ok": False, "error": err})


def main() -> int:
    _log(f"server up (pid={__import__('os').getpid()})")
    for raw in sys.stdin:
        line = raw.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
        except json.JSONDecodeError as exc:
            _err("?", "parse-error", f"invalid JSON line: {exc}")
            continue
        rid = req.get("id", "?")
        method = req.get("method", "")
        params = req.get("params", {}) or {}

        if method == "shutdown":
            _ok(rid, {"bye": True})
            break

        handler = _HANDLERS.get(method)
        if handler is None:
            _err(rid, "unknown-method", f"unknown method: {method!r}")
            continue
        try:
            result = handler(params)
            _ok(rid, result)
        except FileNotFoundError as exc:
            _err(rid, "no-program", str(exc))
        except KeyError as exc:
            _err(rid, "bad-params", str(exc))
        except Exception as exc:  # noqa: BLE001
            tb = traceback.format_exc()
            _err(rid, "handler-failed", str(exc), {"traceback": tb})
    _log("server exiting")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
