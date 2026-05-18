"""
A2AClient — Python client mirror of the TS A2AClient.
"""
from __future__ import annotations

import datetime as dt
from typing import Any

import httpx

from .types import A2AArtifact, A2ATaskRequest, A2ATaskResponse


class A2AClient:
    def __init__(self, url: str, path: str = "/a2a", timeout: float = 60.0) -> None:
        self.url = url.rstrip("/")
        self.path = path
        self.timeout = timeout

    async def send(self, req: A2ATaskRequest) -> A2ATaskResponse:
        body = {
            "jsonrpc": "2.0",
            "id": req.task_id,
            "method": "tasks/send",
            "params": {
                "taskId": req.task_id,
                "contextId": req.context_id,
                "input": req.input,
            },
        }
        async with httpx.AsyncClient(timeout=self.timeout) as cli:
            res = await cli.post(f"{self.url}{self.path}", json=body)
            if res.status_code != 200:
                return A2ATaskResponse(
                    task_id=req.task_id,
                    context_id=req.context_id,
                    status="error",
                    error={"code": res.status_code, "message": f"HTTP {res.status_code}"},
                )
            data = res.json()
            if "error" in data and data["error"]:
                return A2ATaskResponse(
                    task_id=req.task_id,
                    context_id=req.context_id,
                    status="error",
                    error=data["error"],
                )
            result = data.get("result") or {}
            artifact_raw = result.get("artifact")
            artifact = None
            if artifact_raw:
                # Map the wire shape (camelCase) into our pydantic snake_case.
                artifact = A2AArtifact(
                    artifact_id=artifact_raw["artifactId"],
                    kind=artifact_raw["kind"],
                    body=artifact_raw.get("body") or {},
                    producer_model=artifact_raw["producerModel"],
                    producer_version=artifact_raw.get("producerVersion", ""),
                    reviewer_model=artifact_raw.get("reviewerModel", ""),
                    evidence_gate_run=artifact_raw.get("evidenceGateRun", ""),
                    caia_chain_run_id=artifact_raw.get("caiaChainRunId", ""),
                    caia_phase_step_id=artifact_raw.get("caiaPhaseStepId", ""),
                    parent_artifact_id=artifact_raw.get("parentArtifactId", ""),
                    created_at=dt.datetime.fromisoformat(
                        artifact_raw["createdAt"].replace("Z", "+00:00")
                    ),
                )
            return A2ATaskResponse(
                task_id=req.task_id,
                context_id=req.context_id,
                status=result.get("status", "done"),
                artifact=artifact,
            )

    async def agent_card(self) -> dict[str, Any]:
        async with httpx.AsyncClient(timeout=self.timeout) as cli:
            res = await cli.get(f"{self.url}/a2a/agent-card.json")
            res.raise_for_status()
            return res.json()
