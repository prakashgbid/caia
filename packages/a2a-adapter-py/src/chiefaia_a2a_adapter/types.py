"""
A2A type definitions (Python mirror of packages/a2a-adapter/src/types.ts).
"""
from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field


class A2ATaskRequest(BaseModel):
    task_id: str
    context_id: str
    input: dict[str, Any]


class A2AArtifact(BaseModel):
    artifact_id: str
    kind: Literal["sql", "code", "mockup", "review", "plan", "text"]
    body: dict[str, Any] = Field(default_factory=dict)
    producer_model: str
    producer_version: str = ""
    reviewer_model: str = ""
    evidence_gate_run: str = ""
    caia_chain_run_id: str = ""
    caia_phase_step_id: str = ""
    parent_artifact_id: str = ""
    created_at: datetime


class A2ATaskResponse(BaseModel):
    task_id: str
    context_id: str
    status: Literal["done", "streaming", "error"]
    artifact: A2AArtifact | None = None
    error: dict[str, Any] | None = None
