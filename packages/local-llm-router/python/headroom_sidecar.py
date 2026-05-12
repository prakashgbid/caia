#!/usr/bin/env python3
"""Headroom compression sidecar.

Invoked by the router's claude-adapter as a one-shot subprocess. Reads a
single JSON request from stdin and writes a single JSON response to
stdout. Errors go to stderr; non-zero exit code on failure.

Wire format:
  Request (stdin):  {"messages": [...], "model": "claude-sonnet-4-..."}
  Response (stdout): {
      "compressed_messages": [...],
      "tokens_saved":        <int>,
      "compression_ratio":   <float>,
      "original_tokens":     <int>,
      "final_tokens":        <int>,
      "transforms_applied":  [<str>, ...]
  }

The sidecar protocol is intentionally minimal: one request, one
response, no streaming, no keepalive. The adapter pays roughly one
Python interpreter startup per request (~250ms cold, less when imports
are cached). If that becomes a bottleneck we can switch to a long-lived
daemon, but it's deliberately not optimized yet — correctness first.
"""

from __future__ import annotations

import json
import sys
from typing import Any


def _err(msg: str, code: int = 1) -> None:
    """Emit a structured error to stderr and exit non-zero."""
    sys.stderr.write(json.dumps({"error": msg}) + "\n")
    sys.exit(code)


def main() -> None:
    raw = sys.stdin.read()
    if not raw.strip():
        _err("empty stdin")

    try:
        req: dict[str, Any] = json.loads(raw)
    except json.JSONDecodeError as e:
        _err(f"invalid JSON on stdin: {e}")

    messages = req.get("messages")
    if not isinstance(messages, list) or not messages:
        _err("request missing non-empty 'messages' array")

    model = req.get("model") or "claude-sonnet-4-5-20250929"

    try:
        from headroom import compress, CompressConfig
    except ImportError as e:
        _err(f"headroom not importable from {sys.executable}: {e}", code=2)

    # CAIA's prompts are orchestration-side, not the human's literal
    # question — so the user-message protection that Headroom enables by
    # default is the wrong call here. Enabling compress_user_messages lets
    # SmartCrusher / CodeCompressor / Kompress touch the prompt body where
    # most of the bytes live. min_tokens_to_compress=250 is the default;
    # under that threshold the prompt is too short to bother with.
    cfg = CompressConfig(
        compress_user_messages=True,
        compress_system_messages=True,
        protect_recent=0,
    )

    try:
        result = compress(messages, model=model, config=cfg)
    except Exception as e:  # noqa: BLE001 — surface any headroom failure
        _err(f"headroom.compress failed: {type(e).__name__}: {e}", code=3)

    payload = {
        "compressed_messages": result.messages,
        "tokens_saved": int(result.tokens_saved),
        "compression_ratio": float(result.compression_ratio),
        "original_tokens": int(result.tokens_before),
        "final_tokens": int(result.tokens_after),
        "transforms_applied": list(result.transforms_applied),
    }
    sys.stdout.write(json.dumps(payload))
    sys.stdout.flush()


if __name__ == "__main__":
    main()
