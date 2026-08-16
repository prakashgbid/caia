"""ProductScope resolver."""
from __future__ import annotations

from ..config import settings
from ..models import ContextSection, ContextType, CompileRequest
from ._common import http_get, section, timed


async def resolve(req: CompileRequest) -> ContextSection:
    async with timed() as t:
        ps_id = req.input_refs.get("product_scope_id")
        items = []
        if ps_id:
            data = await http_get(
                f"{settings.evidence_store_url}/artifacts/{ps_id}"
            )
            items = [data] if data else []
    return section(
        ContextType.PRODUCT_SCOPE, items, "evidence-store", "ProductScope", t["ms"]
    )
