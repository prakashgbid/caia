"""Related Jira stories — via jira-proxy (STOL-998)."""
from __future__ import annotations

from ..config import settings
from ..models import ContextSection, ContextType, CompileRequest
from ._common import http_get, section, timed


async def resolve(req: CompileRequest) -> ContextSection:
    async with timed() as t:
        jql = (
            f'labels = "workflow:{req.workflow_id}" '
            f'OR labels = "factory:{req.factory_id}" ORDER BY updated DESC'
        )
        data = await http_get(
            f"{settings.jira_proxy_url}/search",
            params={"jql": jql, "maxResults": req.max_items_per_type},
        )
        items = data.get("issues", []) if isinstance(data, dict) else data or []
    return section(
        ContextType.RELATED_STORIES, items, "jira-proxy", "Story", t["ms"]
    )
