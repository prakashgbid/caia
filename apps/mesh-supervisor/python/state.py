"""
CaiaMeshState — the shared Pydantic state schema for the LangGraph supervisor.

Per p4_agent_mesh_implementation_plan_2026_05_16.md §4.3:

> State schema: a Pydantic model `CaiaMeshState` with fields `context_id: str`,
> `task_history: list[A2ATask]`, `artifacts_by_agent: dict[str, list[Artifact]]`,
> `evidence: EvidenceGateState`, `lesson_injection: str` (the Letta-fed Mentor block),
> `caia_provenance: ProvenanceRecord`. Reducers are user-defined merge functions
> per field — `task_history` reduces by append, `artifacts_by_agent` reduces by
> `{**a, **b}` (last-wins per agent), `evidence` reduces by union over the six
> required CI contexts.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Annotated, Any
from operator import add

from pydantic import BaseModel, Field
from typing_extensions import TypedDict


# ---------------------------------------------------------------------------
# Per-field type definitions
# ---------------------------------------------------------------------------

class A2ATask(BaseModel):
    """A minimal record of a dispatched A2A task. We persist the full task
    body in `artifacts_by_agent` (the produced Artifact carries the response)
    so this only records the dispatch envelope."""
    task_id: str
    context_id: str
    agent_id: str
    method: str = "tasks/send"
    input_summary: str
    dispatched_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    status: str = "dispatched"  # dispatched | streaming | done | error


class Artifact(BaseModel):
    """An A2A Artifact extended with CAIA provenance fields (per §4.3)."""
    artifact_id: str
    artifact_kind: str  # 'sql' | 'code' | 'mockup' | 'review' | 'plan' | ...
    body: dict[str, Any] = Field(default_factory=dict)
    producer_model: str
    producer_version: str = ""
    reviewer_model: str = ""
    evidence_gate_run: str = ""
    caia_chain_run_id: str = ""
    caia_phase_step_id: str = ""
    parent_artifact_id: str = ""
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class EvidenceGateState(BaseModel):
    """The six required CI contexts (per CAIA evidence gate). Reduces by union."""
    contexts_passed: set[str] = Field(default_factory=set)
    contexts_required: set[str] = Field(
        default_factory=lambda: {
            "evidence-shape",
            "license-allowlist",
            "no-fabrication",
            "behavior-suite",
            "unit-tests",
            "lint",
        }
    )

    def is_green(self) -> bool:
        return self.contexts_required.issubset(self.contexts_passed)


class ProvenanceRecord(BaseModel):
    """CAIA provenance — written to mesh_supervisor.artifact_provenance on terminal."""
    caia_chain_run_id: str = ""
    caia_phase_step_id: str = ""
    started_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    completed_at: datetime | None = None


# ---------------------------------------------------------------------------
# Reducer functions for the LangGraph state
# ---------------------------------------------------------------------------

def _merge_artifacts_by_agent(
    a: dict[str, list[Artifact]],
    b: dict[str, list[Artifact]],
) -> dict[str, list[Artifact]]:
    """Last-wins per agent per §4.3 — but appending within a single agent.

    The plan reads literally as `{**a, **b}` (replace per agent). We append
    within an agent so multiple invocations of the same agent under one
    context_id all show up in history. If you want pure replace, drop the
    concat below.
    """
    out: dict[str, list[Artifact]] = {**a}
    for agent_id, artifacts in b.items():
        out[agent_id] = (out.get(agent_id, [])) + list(artifacts)
    return out


def _union_evidence(a: EvidenceGateState, b: EvidenceGateState) -> EvidenceGateState:
    """Union of the contexts_passed sets; required set is shared."""
    return EvidenceGateState(
        contexts_passed=a.contexts_passed | b.contexts_passed,
        contexts_required=a.contexts_required | b.contexts_required,
    )


def _last_wins_str(a: str, b: str) -> str:
    return b if b else a


def _last_wins_provenance(
    a: ProvenanceRecord, b: ProvenanceRecord
) -> ProvenanceRecord:
    return b


# ---------------------------------------------------------------------------
# CaiaMeshState — the LangGraph state TypedDict
# ---------------------------------------------------------------------------
# LangGraph supports both Pydantic models and TypedDicts; TypedDicts are more
# robust for `Annotated[T, reducer]` because LangGraph reads the annotation
# metadata directly. We use a TypedDict here and keep the nested types as
# Pydantic models for validation.

class CaiaMeshState(TypedDict, total=False):
    # Core fields per §4.3
    context_id: str
    task_history: Annotated[list[A2ATask], add]
    artifacts_by_agent: Annotated[dict[str, list[Artifact]], _merge_artifacts_by_agent]
    evidence: Annotated[EvidenceGateState, _union_evidence]
    lesson_injection: Annotated[str, _last_wins_str]
    caia_provenance: Annotated[ProvenanceRecord, _last_wins_provenance]

    # Task-input scratch fields. The plan's §4.3 schema doesn't enumerate
    # these because each specialist gets its own input shape; we declare
    # them here as `total=False` keys so LangGraph passes them through
    # initial state into the nodes.
    sql_task: str
    sql_schema: str
    sql_dialect: str


__all__ = [
    "A2ATask",
    "Artifact",
    "EvidenceGateState",
    "ProvenanceRecord",
    "CaiaMeshState",
]
