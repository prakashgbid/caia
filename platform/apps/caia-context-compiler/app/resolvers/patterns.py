"""Relevant reusable patterns from the pattern library (SF-98)."""
from __future__ import annotations

from ..config import settings
from ..models import ContextSection, ContextType, CompileRequest
from ._common import http_get, section, timed


async def resolve(req: CompileRequest) -> ContextSection:
    async with timed() as t:
        data = await http_get(
            f"{settings.pattern_library_url}/patterns",
            params={
                "factory_id": req.factory_id,
                "q": req.query_text or "",
                "limit": req.max_items_per_type,
            },
        )
        items = data.get("patterns", []) if isinstance(data, dict) else data or []
    return section(
        ContextType.PATTERNS, items, "pattern-library", "Pattern", t["ms"]
    )
