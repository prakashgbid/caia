"""SF-104 Defect Triage Factory.

LLM-classifies any Failure artifact from earlier factories into:
- severity: blocker | critical | major | minor | trivial
- owning_factory: SF-id most likely to fix it (or human_review)
- required_remediation: retry_same | retry_with_context | fix_code | fix_infra | escalate
- rationale: short LLM explanation

Emits `caia.factory.requires_rework` with routing metadata so the executor
daemon (STOL-906) can dispatch the rework to the owning factory.

Reuse doctrine (STOL-1034): calls LiteLLM proxy (Kernel-5, already deployed)
using a cheap OSS model (deepseek-r1-free) — [[ci-cost-elimination-direction]]:
$0 recurring for triage.
"""
from __future__ import annotations

import json
import os
import time
import uuid
from dataclasses import asdict, dataclass, field
from typing import Any, Literal

import httpx

FACTORY_ID = "sf-104-defect-triage"
FACTORY_VERSION = "0.1.0"

LITELLM_URL = os.environ.get("LITELLM_URL", "http://litellm:4000")
LITELLM_KEY = os.environ.get("LITELLM_KEY", "sk-caia-internal")
TRIAGE_MODEL = os.environ.get("CAIA_TRIAGE_MODEL", "deepseek-r1-free")
EVENT_TOPIC = os.environ.get("CAIA_REWORK_TOPIC", "caia.factory.requires_rework")

Severity = Literal["blocker", "critical", "major", "minor", "trivial"]
Remediation = Literal[
    "retry_same", "retry_with_context", "fix_code", "fix_infra", "escalate"
]

SYSTEM_PROMPT = """You are the CAIA Defect Triage classifier.

Given a failure artifact from an upstream microfactory, output STRICT JSON with:
  severity          — blocker|critical|major|minor|trivial
  owning_factory    — SF-id of the factory most likely to fix it, or "human_review"
  required_remediation — retry_same|retry_with_context|fix_code|fix_infra|escalate
  rationale         — one-sentence explanation (<=200 chars)
  confidence        — 0.0 to 1.0

Known factories (partial): SF-91 (commit), SF-93 (ci), SF-95 (unit-test),
SF-96 (integration), SF-97 (contract), SF-98 (functional-browser), SF-99
(visual-regression), SF-100 (perf), SF-101 (security-scan), SF-102 (a11y),
SF-103 (deploy).

Respond with JSON only. No preamble."""


@dataclass
class FailureArtifact:
    source_factory: str
    failure_type: str  # e.g. "test_failed", "http_5xx", "assertion_error"
    payload: dict[str, Any]
    upstream_run_id: str = ""


@dataclass
class DefectClassification:
    triage_id: str
    source_factory: str
    severity: Severity
    owning_factory: str
    required_remediation: Remediation
    rationale: str
    confidence: float
    model: str
    triaged_at: float
    raw_llm_response: str = field(default="", repr=False)


class DefectTriageFactory:
    factory_id = FACTORY_ID
    version = FACTORY_VERSION

    def __init__(self, client: httpx.AsyncClient | None = None,
                 event_publisher=None):
        self._client = client or httpx.AsyncClient(timeout=30)
        self._publish = event_publisher  # async callable(topic, payload)

    async def _classify(self, failure: FailureArtifact) -> dict[str, Any]:
        user_content = json.dumps({
            "source_factory": failure.source_factory,
            "failure_type": failure.failure_type,
            "payload": failure.payload,
            "upstream_run_id": failure.upstream_run_id,
        })
        r = await self._client.post(
            f"{LITELLM_URL}/v1/chat/completions",
            headers={"Authorization": f"Bearer {LITELLM_KEY}"},
            json={
                "model": TRIAGE_MODEL,
                "temperature": 0.1,
                "response_format": {"type": "json_object"},
                "messages": [
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": user_content},
                ],
            },
        )
        r.raise_for_status()
        body = r.json()
        content = body["choices"][0]["message"]["content"]
        return {"content": content, "parsed": self._safe_parse(content)}

    @staticmethod
    def _safe_parse(content: str) -> dict[str, Any]:
        try:
            return json.loads(content)
        except json.JSONDecodeError:
            # crude fallback — fenced code
            s = content.strip().strip("`")
            if s.startswith("json"):
                s = s[4:]
            try:
                return json.loads(s)
            except json.JSONDecodeError:
                return {}

    async def run(self, failure: FailureArtifact) -> DefectClassification:
        result = await self._classify(failure)
        parsed = result["parsed"] or {}
        classification = DefectClassification(
            triage_id=str(uuid.uuid4()),
            source_factory=failure.source_factory,
            severity=parsed.get("severity", "major"),  # safe default
            owning_factory=parsed.get("owning_factory", "human_review"),
            required_remediation=parsed.get("required_remediation", "escalate"),
            rationale=parsed.get("rationale", "LLM unparseable — default to human review"),
            confidence=float(parsed.get("confidence", 0.0)),
            model=TRIAGE_MODEL,
            triaged_at=time.time(),
            raw_llm_response=result["content"],
        )
        if self._publish is not None:
            await self._publish(EVENT_TOPIC, {
                "triage": asdict(classification),
                "original_failure": asdict(failure),
            })
        return classification
