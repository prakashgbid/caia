"""Relevant ADRs — filtered by workflow tags on evidence-store."""
from __future__ import annotations

from ..config import settings
from ..models import ContextSection, ContextType, CompileRequest
from ._common import http_get, section, timed


async def resolve(req: CompileRequest) -> ContextSection:
    async with timed() as t:
        data = await http_get(
            f"{settings.evidence_store_url}/artifacts",
            params={
                "type": "ADR",
                "workflow_id": req.workflow_id,
                "limit": req.max_items_per_type,
            },
        )
        items = data.get("items", []) if isinstance(data, dict) else data or []
    return section(
        ContextType.ARCHITECTURE_DECISIONS,
        items,
        "evidence-store",
        "ADR",
        t["ms"],
    )
