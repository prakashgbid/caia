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
    response string, or None on failure (caller falls back to claude binary)."""
    # Map tier to model
    model = {
        "local-7b": "qwen2.5-coder:7b",
        "local-14b": "qwen2.5-coder:14b",
        "local-32b": "qwen2.5-coder:32b",
    }.get(recommended_tier, "qwen2.5-coder:7b")
    body = json.dumps({
        "model": model,
        "messages": [{"role": "user", "content": task_spec}],
        "caia_task_type": "spawner-routed",
    }).encode("utf-8")
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
