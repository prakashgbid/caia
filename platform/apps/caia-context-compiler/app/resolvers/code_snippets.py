"""Code similarity via pgvector (STOL-1001)."""
from __future__ import annotations

from ..config import settings
from ..models import ContextSection, ContextType, CompileRequest
from ._common import http_get, section, timed


async def resolve(req: CompileRequest) -> ContextSection:
    async with timed() as t:
        if not req.query_text:
            items = []
        else:
            data = await http_get(
                f"{settings.pgvector_url}/similarity",
                params={
                    "q": req.query_text,
                    "k": req.max_items_per_type,
                    "kind": "code",
                },
            )
            items = data.get("matches", []) if isinstance(data, dict) else data or []
    return section(
        ContextType.CODE_SNIPPETS, items, "pgvector", "CodeSnippet", t["ms"]
    )
