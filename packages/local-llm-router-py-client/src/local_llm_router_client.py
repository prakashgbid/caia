"""
Python client for the local-llm-router HTTP daemon.

Vendored copy lives next to claude_spawner_agent.py on each spawner host:
  - M3 spawner:        ~/Documents/projects/reports/claude-spawner-agent/
  - stolution spawner: /home/s903/apps/claude-spawner/

Pure stdlib (urllib.request) — no pip deps to add to the spawner venv.
"""

from __future__ import annotations

import json
import os
import re
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Optional

DEFAULT_BASE_URL = os.environ.get("LOCAL_LLM_ROUTER_URL", "http://100.68.247.58:7411")
DEFAULT_TIMEOUT = float(os.environ.get("LOCAL_LLM_ROUTER_TIMEOUT", "10.0"))


@dataclass
class IntentResult:
    intent: str
    confidence: float
    needs_escalation: bool
    recommended_tier: str  # 'local-7b' | 'local-14b' | 'local-32b' | 'claude' | 'stolution-batch'
    reasoning: str
    latency_ms: int
    classifier_model: str

    @property
    def use_local(self) -> bool:
        return self.recommended_tier.startswith("local-")

    @property
    def passthrough_to_claude(self) -> bool:
        return self.recommended_tier == "claude"


def classify(task_spec: str, base_url: str = DEFAULT_BASE_URL,
             timeout: float = DEFAULT_TIMEOUT) -> Optional[IntentResult]:
    """Classify a task spec via the router daemon. Returns None on any failure
    (caller should default to claude path on None)."""
    body = json.dumps({"task_spec": task_spec}).encode("utf-8")
    req = urllib.request.Request(
        f"{base_url}/v1/intent",
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            payload = json.loads(r.read().decode("utf-8"))
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, json.JSONDecodeError):
        return None
    return IntentResult(
        intent=payload.get("intent", "unknown"),
        confidence=float(payload.get("confidence", 0.0)),
        needs_escalation=bool(payload.get("needs_escalation", True)),
        recommended_tier=payload.get("recommended_tier", "claude"),
        reasoning=payload.get("reasoning", ""),
        latency_ms=int(payload.get("latency_ms", 0)),
        classifier_model=payload.get("classifier_model", "unknown"),
    )


def execute_local(task_spec: str, recommended_tier: str,
                  base_url: str = DEFAULT_BASE_URL,
                  timeout: float = 60.0) -> Optional[str]:
    """Execute a task on the local model via /v1/chat/completions. Returns the
    response string, or None on failure (caller falls back to claude binary).

    SPS T2.5 Phase 4 (2026-05-13/16): post-2026-05-15 the router's R-2
    model-pinning guard rejects any caller-supplied `model` that is not an
    advisory hint (`auto`, `prefer-*`). The previous tier→tag dict here
    therefore caused every spawner-routed request to 400 on a fresh
    daemon. We drop the `model` field entirely and let the router pick
    based on `caia_task_type=spawner-routed` plus the daemon's
    routing-rules. `recommended_tier` is still threaded through so callers
    have visibility into what the classifier said, but it no longer pins
    the dispatch.
    """
    body = json.dumps({
        # No `model` field — the router resolves tier→tag server-side under
        # the R-2 guard (server.ts ADVISORY_MODEL_HINTS). `recommended_tier`
        # is intentionally NOT forwarded as a hint — the server's classifier
        # has its own view and a stale or out-of-band tier from the client
        # could fight with the cascade.
        "messages": [{"role": "user", "content": task_spec}],
        "caia_task_type": "spawner-routed",
    }).encode("utf-8")
    _ = recommended_tier  # kept in the public signature for caller observability
    req = urllib.request.Request(
        f"{base_url}/v1/chat/completions",
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            payload = json.loads(r.read().decode("utf-8"))
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, json.JSONDecodeError):
        return None
    choices = payload.get("choices", [])
    if not choices:
        return None
    return choices[0].get("message", {}).get("content")


def health(base_url: str = DEFAULT_BASE_URL, timeout: float = 3.0) -> bool:
    """Quick health probe — returns True if daemon is reachable + healthy."""
    try:
        with urllib.request.urlopen(f"{base_url}/healthz", timeout=timeout) as r:
            payload = json.loads(r.read().decode("utf-8"))
            return bool(payload.get("ok") and payload.get("ollama", {}).get("ok"))
    except Exception:
        return False


# ───────────────────────── prompt optimizer ───────────────────────────────
# LAI phase 7: spawner escalation path must run the prompt through the
# 3-stage optimizer (rule-prepass → tool-output-summarize → token-prune)
# before invoking the claude binary. We try the router daemon's
# /v1/optimize endpoint first (it dispatches the TS @chiefaia/prompt-optimizer
# pipeline). If the endpoint isn't deployed yet — older router versions —
# we fall back to a pure-Python rule-based prepass that mirrors stage 1.
# The fallback never reaches stage 2/3, so compression is modest (~10-25%)
# but the path stays unblocked and the spawn record honestly tags the
# `backend` so dashboards can distinguish full-pipeline vs prepass-only.

_WHITESPACE_RUN_RE = re.compile(r"[ \t]{2,}")
_BLANK_LINES_RE = re.compile(r"\n{3,}")
_TRAILING_WS_RE = re.compile(r"[ \t]+\n")


def _estimate_tokens(text: str) -> int:
    """Cheap ~4-chars-per-token estimate. Matches the TS optimizer's
    `estimateTokens()` so spawn-record numbers line up with router metrics."""
    if not text:
        return 0
    return max(1, (len(text) + 3) // 4)


def _stage1_prepass_inline(text: str) -> str:
    """Pure-Python mirror of @chiefaia/prompt-optimizer stage1Prepass for the
    fallback path. Collapses runs of whitespace and blank lines; strips
    trailing space. Intentionally does NOT touch fenced code blocks or
    backticked spans heuristically — we accept slightly lower compression
    for safety in the fallback (the real optimizer has protected-span logic
    we don't try to reproduce here)."""
    if not text:
        return text
    out = _TRAILING_WS_RE.sub("\n", text)
    out = _WHITESPACE_RUN_RE.sub(" ", out)
    out = _BLANK_LINES_RE.sub("\n\n", out)
    return out.strip()


def optimize_prompt(prompt: str,
                    system_prompt: Optional[str] = None,
                    base_url: str = DEFAULT_BASE_URL,
                    timeout: float = 30.0) -> tuple[str, dict]:
    """Run a prompt through the optimizer before claude escalation.

    Returns (optimized_prompt, metrics) where `metrics` always contains:
      - backend:        'router-v1-optimize' | 'inline-stage1' | 'noop'
      - pre_token_count, post_token_count, compression_ratio
      - stages_run:     list[str] (e.g. ['stage1','stage2','stage3'] or ['stage1'])
      - wall_ms:        wall-clock duration
      - error:          str | None  (set on partial failure; result still safe to use)

    The function never raises — on any failure, returns the original prompt
    with backend='noop'. This is critical: the spawner must always have a
    runnable prompt to hand to the claude binary."""
    t0 = time.time()
    pre_tokens = _estimate_tokens(prompt) + _estimate_tokens(system_prompt or "")

    # Path 1 — router daemon's /v1/optimize endpoint (preferred).
    body = json.dumps({
        "prompt": prompt,
        "system_prompt": system_prompt or "",
        "caller": "claude-spawner",
    }).encode("utf-8")
    req = urllib.request.Request(
        f"{base_url}/v1/optimize",
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            payload = json.loads(r.read().decode("utf-8"))
        optimized = payload.get("optimized_prompt") or payload.get("prompt") or prompt
        m = payload.get("metrics", {})
        post_tokens = int(m.get("post_token_count") or _estimate_tokens(optimized))
        return optimized, {
            "backend": "router-v1-optimize",
            "pre_token_count": int(m.get("pre_token_count") or pre_tokens),
            "post_token_count": post_tokens,
            "compression_ratio": (post_tokens / pre_tokens) if pre_tokens else 1.0,
            "stages_run": m.get("stages_run") or ["stage1", "stage2", "stage3"],
            "wall_ms": int((time.time() - t0) * 1000),
            "error": None,
        }
    except (urllib.error.HTTPError, urllib.error.URLError,
            TimeoutError, json.JSONDecodeError):
        # 404 = endpoint not deployed yet (older router); URLError = router
        # offline; JSON errors = malformed response. All fall through to
        # the pure-Python stage-1 path below.
        pass
    except Exception:
        pass

    # Path 2 — inline pure-Python stage 1 prepass (fallback).
    try:
        opt_system = _stage1_prepass_inline(system_prompt or "")
        opt_user = _stage1_prepass_inline(prompt)
        optimized = (opt_system + "\n\n" + opt_user).strip() if opt_system else opt_user
        post_tokens = _estimate_tokens(optimized)
        return optimized, {
            "backend": "inline-stage1",
            "pre_token_count": pre_tokens,
            "post_token_count": post_tokens,
            "compression_ratio": (post_tokens / pre_tokens) if pre_tokens else 1.0,
            "stages_run": ["stage1"],
            "wall_ms": int((time.time() - t0) * 1000),
            "error": None,
        }
    except Exception as e:
        # Path 3 — true no-op. Hand the original prompt back unchanged.
        return prompt, {
            "backend": "noop",
            "pre_token_count": pre_tokens,
            "post_token_count": pre_tokens,
            "compression_ratio": 1.0,
            "stages_run": [],
            "wall_ms": int((time.time() - t0) * 1000),
            "error": f"{type(e).__name__}: {e}",
        }


def classify_and_maybe_route(task_spec: str,
                              base_url: str = DEFAULT_BASE_URL,
                              max_local_latency_s: float = 90.0) -> tuple[Optional[str], dict]:
    """High-level helper for spawners.

    Returns (local_response, metadata):
      - If local can handle: (response_text, {model: ..., tier: ..., classifier_latency_ms: ..., exec_latency_ms: ...})
      - If must escalate to claude: (None, {tier: 'claude', reason: ...})

    Metadata is always populated for spawn-record write-through.
    """
    t0 = time.time()
    intent = classify(task_spec, base_url=base_url)
    if intent is None:
        return None, {"tier": "claude", "reason": "router-unreachable"}
    if intent.passthrough_to_claude or intent.needs_escalation:
        return None, {
            "tier": "claude",
            "reason": f"router-recommends-claude (intent={intent.intent}, conf={intent.confidence:.2f})",
            "classifier_latency_ms": intent.latency_ms,
            "classifier_model": intent.classifier_model,
        }
    if not intent.use_local:
        return None, {"tier": intent.recommended_tier, "reason": "non-local-non-claude-tier"}
    # Try local execution
    response = execute_local(task_spec, intent.recommended_tier,
                              base_url=base_url, timeout=max_local_latency_s)
    if response is None:
        return None, {
            "tier": "claude",
            "reason": "local-execute-failed",
            "intended_tier": intent.recommended_tier,
            "classifier_latency_ms": intent.latency_ms,
        }
    return response, {
        "tier": intent.recommended_tier,
        "model": {
            "local-7b": "qwen2.5-coder:7b",
            "local-14b": "qwen2.5-coder:14b",
            "local-32b": "qwen2.5-coder:32b",
        }.get(intent.recommended_tier, "qwen2.5-coder:7b"),
        "classifier_latency_ms": intent.latency_ms,
        "exec_latency_ms": int((time.time() - t0) * 1000) - intent.latency_ms,
        "intent": intent.intent,
        "confidence": intent.confidence,
        "claude_invoked": False,
    }


if __name__ == "__main__":
    # CLI smoke test
    import sys
    spec = sys.argv[1] if len(sys.argv) > 1 else "Rename foo to bar in helpers.ts"
    print(f"healthz: {health()}")
    intent = classify(spec)
    print(f"intent: {intent}")
    response, meta = classify_and_maybe_route(spec)
    print(f"response: {response}")
    print(f"meta: {meta}")
    # LAI phase 7: exercise the optimizer path even when classify routes
    # to claude — this is the spawner escalation flow.
    opt_text, opt_meta = optimize_prompt(spec)
    print(f"optimize backend: {opt_meta['backend']} "
          f"pre={opt_meta['pre_token_count']} post={opt_meta['post_token_count']} "
          f"ratio={opt_meta['compression_ratio']:.3f}")
