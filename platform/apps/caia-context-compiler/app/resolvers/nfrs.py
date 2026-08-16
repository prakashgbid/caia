"""NFR subset — the NFR catalog (STOL-1012 → merged into SF-32/SF-42..53)."""
from __future__ import annotations

from ..config import settings
from ..models import ContextSection, ContextType, CompileRequest
from ._common import http_get, section, timed


async def resolve(req: CompileRequest) -> ContextSection:
    async with timed() as t:
        data = await http_get(
            f"{settings.nfr_catalog_url}/nfrs",
            params={"factory_id": req.factory_id, "limit": req.max_items_per_type},
        )
        items = data.get("nfrs", []) if isinstance(data, dict) else data or []
    return section(ContextType.NFRS, items, "nfr-catalog", "NFR", t["ms"])
