"""Recent domain events on this workflow (event-store consumer)."""
from __future__ import annotations

from ..config import settings
from ..models import ContextSection, ContextType, CompileRequest
from ._common import http_get, section, timed


async def resolve(req: CompileRequest) -> ContextSection:
    async with timed() as t:
        data = await http_get(
            f"{settings.domain_events_url}/events",
            params={
                "workflow_id": req.workflow_id,
                "limit": req.max_items_per_type,
                "order": "desc",
            },
        )
        items = data.get("events", []) if isinstance(data, dict) else data or []
    return section(
        ContextType.DOMAIN_EVENTS, items, "event-store", "DomainEvent", t["ms"]
    )
