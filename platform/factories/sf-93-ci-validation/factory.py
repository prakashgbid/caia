"""SF-93 CI Validation Factory.

Thin-slice factory. Wraps the existing self-hosted GitHub Actions CI pipeline
(STOL-874) as a CAIA microfactory. Input: `CommitResult` artifact from SF-91.
Output: `CIResult` artifact with per-check breakdown.

Reuse doctrine (STOL-1034 / stolution-reuse-doctrine): we DO NOT invent a new
CI runner. We trigger the existing self-hosted workflow via `workflow_dispatch`
and poll for completion.

References:
- STOL-874  self-hosted CI baseline
- STOL-1034 CAIA master blueprint (SF-93 slot)
- caia-factory-sdk contract
"""
from __future__ import annotations

import asyncio
import os
import time
from dataclasses import dataclass
from typing import Any

import httpx

FACTORY_ID = "sf-93-ci-validation"
FACTORY_VERSION = "0.1.0"

GH_API = os.environ.get("GITHUB_API", "https://api.github.com")
GH_REPO = os.environ.get("GITHUB_REPO", "thivaan/stolution")
GH_TOKEN_ENV = "GITHUB_TOKEN"
WORKFLOW_FILE = os.environ.get("CAIA_CI_WORKFLOW", "ci.yml")
POLL_INTERVAL_S = int(os.environ.get("CAIA_CI_POLL_S", "10"))
POLL_TIMEOUT_S = int(os.environ.get("CAIA_CI_TIMEOUT_S", "1800"))  # 30 min


@dataclass
class CommitResult:
    commit_sha: str
    branch: str
    repo: str = GH_REPO


@dataclass
class CIResult:
    commit_sha: str
    conclusion: str  # success | failure | cancelled | timed_out
    run_id: int
    run_url: str
    checks: list[dict[str, Any]]
    duration_s: float


class CIValidationFactory:
    factory_id = FACTORY_ID
    version = FACTORY_VERSION

    def __init__(self, token: str | None = None, client: httpx.AsyncClient | None = None):
        self._token = token or os.environ.get(GH_TOKEN_ENV, "")
        self._client = client or httpx.AsyncClient(timeout=30)

    def _headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self._token}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
        }

    async def _dispatch(self, commit: CommitResult) -> None:
        url = f"{GH_API}/repos/{commit.repo}/actions/workflows/{WORKFLOW_FILE}/dispatches"
        r = await self._client.post(
            url, headers=self._headers(),
            json={"ref": commit.branch, "inputs": {"sha": commit.commit_sha}},
        )
        r.raise_for_status()

    async def _find_run(self, commit: CommitResult) -> dict[str, Any] | None:
        url = f"{GH_API}/repos/{commit.repo}/actions/runs"
        r = await self._client.get(url, headers=self._headers(),
                                    params={"head_sha": commit.commit_sha, "per_page": 5})
        r.raise_for_status()
        runs = r.json().get("workflow_runs", [])
        return runs[0] if runs else None

    async def _checks(self, commit: CommitResult) -> list[dict[str, Any]]:
        url = f"{GH_API}/repos/{commit.repo}/commits/{commit.commit_sha}/check-runs"
        r = await self._client.get(url, headers=self._headers())
        r.raise_for_status()
        return [
            {"name": c["name"], "conclusion": c["conclusion"], "status": c["status"]}
            for c in r.json().get("check_runs", [])
        ]

    async def run(self, commit: CommitResult) -> CIResult:
        started = time.monotonic()
        await self._dispatch(commit)
        # Wait for run to appear + finish
        deadline = started + POLL_TIMEOUT_S
        run: dict[str, Any] | None = None
        while time.monotonic() < deadline:
            await asyncio.sleep(POLL_INTERVAL_S)
            run = await self._find_run(commit)
            if run and run.get("status") == "completed":
                break
        if not run or run.get("status") != "completed":
            return CIResult(
                commit_sha=commit.commit_sha, conclusion="timed_out",
                run_id=(run or {}).get("id", 0), run_url=(run or {}).get("html_url", ""),
                checks=[], duration_s=time.monotonic() - started,
            )
        checks = await self._checks(commit)
        return CIResult(
            commit_sha=commit.commit_sha,
            conclusion=run["conclusion"],
            run_id=run["id"],
            run_url=run["html_url"],
            checks=checks,
            duration_s=time.monotonic() - started,
        )
