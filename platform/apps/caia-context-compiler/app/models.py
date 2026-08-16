"""Pydantic models for compile request / response."""
from __future__ import annotations

from enum import Enum
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


class ContextType(str, Enum):
    VISION_SPEC = "vision_spec"
    PRODUCT_SCOPE = "product_scope"
    ARCHITECTURE_DECISIONS = "architecture_decisions"
    RELATED_STORIES = "related_stories"
    CODE_SNIPPETS = "code_snippets"
    TEST_SPECS = "test_specs"
    NFRS = "nfrs"
    PATTERNS = "patterns"
    DOMAIN_EVENTS = "domain_events"


class CompileRequest(BaseModel):
    factory_id: str = Field(..., description="e.g. SF-42 (vision-generator)")
    workflow_id: str = Field(..., description="Workflow correlation id")
    input_refs: Dict[str, str] = Field(
        default_factory=dict,
        description="Input artifact refs (e.g. {'vision_spec_id':'vs_abc'})",
    )
    requested_context_types: List[ContextType] = Field(
        ..., description="ONLY these types will be resolved. Bounded."
    )
    # Optional narrowing hints
    query_text: Optional[str] = Field(
        None, description="Free-text used for pgvector similarity"
    )
    max_items_per_type: int = Field(10, ge=1, le=100)


class ArtifactRef(BaseModel):
    """Provenance record — one per artifact included in the compiled context."""

    artifact_id: str
    artifact_type: str
    sha256: str
    source: str  # e.g. "evidence-store", "jira", "pgvector"
    uri: Optional[str] = None


class ContextSection(BaseModel):
    context_type: ContextType
    items: List[Dict[str, Any]]
    provenance: List[ArtifactRef]
    resolver_ms: int
    truncated: bool = False


class CompileResponse(BaseModel):
    factory_id: str
    workflow_id: str
    compiled_at: str  # ISO-8601 UTC
    context_hash: str  # sha256 of canonicalized request → idempotency key
    sections: Dict[ContextType, ContextSection]
    total_size_bytes: int
    total_duration_ms: int
    cache_hit: bool = False
