"""
DSPy LM adapter that talks directly to Ollama (HTTP /api/generate).

Why a custom adapter — DSPy ships a `dspy.LM` that routes through
litellm, which in turn looks for `OPENAI_API_KEY` / `ANTHROPIC_API_KEY`
env vars and prefers HTTP services with chat-completions semantics.
We need a hard guarantee that:

  1. NO API key is ever read (caia constraint, Prakash 2026-04-30).
  2. The default path is local Ollama, full stop.
  3. The Python sub-process honours the same routing rule the
     TypeScript `@chiefaia/local-llm-router` enforces.

So we ship a thin adapter that:

  - speaks Ollama's /api/generate
  - reports last-call usage so the bridge can write trace/spend records
  - quacks like a `dspy.LM` (DSPy 2.5+ accepts any callable that returns
    a list of completion strings or a dict-like response)

If a future proposal needs the Claude-binary path on the Python side,
the right thing to do is shell out to `claude` via subprocess — same
adapter pattern, same no-API-key rule.
"""

from __future__ import annotations

import json
import os
import time
from dataclasses import dataclass, field
from typing import Any

import httpx


@dataclass
class LastCall:
    model: str = ""
    duration_ms: int = 0
    prompt_chars: int = 0
    response_chars: int = 0


@dataclass
class OllamaLM:
    """A minimal DSPy-compatible LM that calls Ollama directly."""

    model: str = "qwen2.5-coder:7b"
    host: str = field(default_factory=lambda: os.environ.get("OLLAMA_HOST", "http://127.0.0.1:11434"))
    temperature: float = 0.2
    max_tokens: int = 1024
    timeout_s: float = 120.0
    last_call: LastCall = field(default_factory=LastCall)

    # DSPy 2.5 attributes — exposed so DSPy's bookkeeping (history,
    # provider name) doesn't crash.
    kwargs: dict[str, Any] = field(default_factory=dict)
    history: list[dict[str, Any]] = field(default_factory=list)
    provider: str = "ollama"

    def __post_init__(self) -> None:
        self.kwargs = {
            "temperature": self.temperature,
            "max_tokens": self.max_tokens,
        }

    # ── DSPy LM contract ─────────────────────────────────────────────────
    # DSPy 2.5 accepts an LM that responds to `__call__(prompt, **kwargs)`
    # and returns a list[str] (the completions).

    def __call__(self, prompt: str | None = None, messages: list[dict[str, Any]] | None = None,
                 **kwargs: Any) -> list[str]:
        text = self._render_prompt(prompt, messages)
        started = time.monotonic()
        try:
            with httpx.Client(timeout=self.timeout_s) as client:
                resp = client.post(
                    f"{self.host}/api/generate",
                    json={
                        "model": self.model,
                        "prompt": text,
                        "stream": False,
                        "options": {
                            "temperature": kwargs.get("temperature", self.temperature),
                            "num_predict": kwargs.get("max_tokens", self.max_tokens),
                        },
                    },
                )
        except httpx.RequestError as exc:
            raise OllamaUnreachable(
                f"could not reach Ollama at {self.host}: {exc}"
            ) from exc
        if resp.status_code != 200:
            raise OllamaError(
                f"ollama /api/generate returned {resp.status_code}: {resp.text[:500]}"
            )
        body = resp.json()
        completion: str = body.get("response", "")

        elapsed_ms = int((time.monotonic() - started) * 1000)
        self.last_call = LastCall(
            model=self.model,
            duration_ms=elapsed_ms,
            prompt_chars=len(text),
            response_chars=len(completion),
        )
        self.history.append({
            "prompt": text,
            "completion": completion,
            "model": self.model,
            "duration_ms": elapsed_ms,
        })
        return [completion]

    # Used by some DSPy callers (older API).
    def basic_request(self, prompt: str, **kwargs: Any) -> dict[str, Any]:
        completions = self.__call__(prompt, **kwargs)
        return {
            "choices": [{"text": completions[0]}],
            "model": self.model,
        }

    def inspect_history(self, n: int = 1) -> list[dict[str, Any]]:
        return self.history[-n:]

    # ── helpers ─────────────────────────────────────────────────────────

    @staticmethod
    def _render_prompt(prompt: str | None, messages: list[dict[str, Any]] | None) -> str:
        if prompt is not None:
            return prompt
        if messages:
            # Minimal chat-to-text rendering. DSPy modules generally
            # produce plain prompts already; chat shape is a fallback.
            parts = []
            for m in messages:
                role = m.get("role", "user")
                content = m.get("content", "")
                parts.append(f"[{role.upper()}]\n{content}")
            return "\n\n".join(parts)
        return ""


class OllamaUnreachable(RuntimeError):
    pass


class OllamaError(RuntimeError):
    pass
