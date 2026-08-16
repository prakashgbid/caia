"""SF-98 Functional Browser Factory.

REBADGE of live-verify-runner (STOL-863). Reuses that runner's Playwright +
axe-core (a11y) + Lighthouse (CWV) infrastructure — nothing new is built.

Contract:
- Input:  TestEnvironment { base_url, auth?, viewport?, headers? } + ExecutionPolicy
- Output: FunctionalResults { pass, tests[], a11y[], cwv{}, artifacts_url }
- Emits:  caia.factory.functional.result (routed to SF-104 on failure)

Reuse doctrine (STOL-1034): SF-98 wraps the existing runner via its `/run`
HTTP interface — implementation stays where it is (single-source).
"""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from typing import Any

import httpx

FACTORY_ID = "sf-98-functional-browser"
FACTORY_VERSION = "0.1.0"

LVR_URL = os.environ.get("LIVE_VERIFY_RUNNER_URL", "http://live-verify-runner:8080")
LVR_TIMEOUT_S = int(os.environ.get("LVR_TIMEOUT_S", "600"))


@dataclass
class TestEnvironment:
    base_url: str
    auth: dict[str, str] | None = None
    viewport: dict[str, int] = field(default_factory=lambda: {"width": 1440, "height": 900})
    headers: dict[str, str] = field(default_factory=dict)


@dataclass
class ExecutionPolicy:
    suites: list[str] = field(default_factory=lambda: ["smoke", "a11y", "cwv"])
    max_retries: int = 1
    fail_fast: bool = False


@dataclass
class FunctionalResults:
    pass_: bool
    tests: list[dict[str, Any]]
    a11y: list[dict[str, Any]]
    cwv: dict[str, float]
    artifacts_url: str
    duration_s: float


class FunctionalBrowserFactory:
    factory_id = FACTORY_ID
    version = FACTORY_VERSION

    def __init__(self, client: httpx.AsyncClient | None = None):
        self._client = client or httpx.AsyncClient(timeout=LVR_TIMEOUT_S)

    async def run(self, env: TestEnvironment, policy: ExecutionPolicy) -> FunctionalResults:
        payload = {
            "target": {
                "base_url": env.base_url,
                "viewport": env.viewport,
                "headers": env.headers,
                "auth": env.auth,
            },
            "policy": {
                "suites": policy.suites,
                "max_retries": policy.max_retries,
                "fail_fast": policy.fail_fast,
            },
        }
        r = await self._client.post(f"{LVR_URL}/run", json=payload)
        r.raise_for_status()
        data = r.json()
        return FunctionalResults(
            pass_=bool(data.get("pass", False)),
            tests=data.get("tests", []),
            a11y=data.get("a11y", []),
            cwv=data.get("cwv", {}),
            artifacts_url=data.get("artifacts_url", ""),
            duration_s=float(data.get("duration_s", 0.0)),
        )
