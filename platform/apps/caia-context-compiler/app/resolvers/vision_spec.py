"""VisionSpec resolver — fetches from evidence-store (STOL-860)."""
from __future__ import annotations

from ..config import settings
from ..models import ContextSection, ContextType, CompileRequest
from ._common import http_get, section, timed


async def resolve(req: CompileRequest) -> ContextSection:
    async with timed() as t:
        vs_id = req.input_refs.get("vision_spec_id")
        items = []
        if vs_id:
            data = await http_get(
                f"{settings.evidence_store_url}/artifacts/{vs_id}"
            )
            items = [data] if data else []
    return section(
        ContextType.VISION_SPEC, items, "evidence-store", "VisionSpec", t["ms"]
    )
