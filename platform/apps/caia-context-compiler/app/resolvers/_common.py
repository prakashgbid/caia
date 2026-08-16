"""Shared helpers for resolvers — HTTP client, provenance builder."""
from __future__ import annotations

import hashlib
import json
import time
from contextlib import asynccontextmanager
from typing import Any, Dict, List, Tuple

import httpx

from ..config import settings
from ..models import ArtifactRef, ContextSection, ContextType

_client: httpx.AsyncClient | None = None


async def get_http() -> httpx.AsyncClient:
    global _client
    if _client is None:
        _client = httpx.AsyncClient(timeout=settings.upstream_timeout_s)
    return _client


def sha_of(obj: Any) -> str:
    blob = json.dumps(obj, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()


def make_ref(item: Dict[str, Any], source: str, artifact_type: str) -> ArtifactRef:
    aid = str(item.get("id") or item.get("key") or item.get("uri") or sha_of(item)[:16])
    return ArtifactRef(
        artifact_id=aid,
        artifact_type=artifact_type,
        sha256=sha_of(item),
        source=source,
        uri=item.get("uri"),
    )


def cap_bytes(items: List[Dict[str, Any]]) -> Tuple[List[Dict[str, Any]], bool]:
    """Trim items until section fits under MAX_BYTES_PER_SECTION."""
    limit = settings.max_bytes_per_section
    keep, size = [], 0
    for it in items:
        b = len(json.dumps(it, default=str).encode("utf-8"))
        if size + b > limit:
            return keep, True
        keep.append(it)
        size += b
    return keep, False


@asynccontextmanager
async def timed():
    t0 = time.perf_counter()
    box: Dict[str, int] = {"ms": 0}
    try:
        yield box
    finally:
        box["ms"] = int((time.perf_counter() - t0) * 1000)


async def http_get(url: str, params: Dict[str, Any] | None = None) -> Any:
    client = await get_http()
    r = await client.get(url, params=params or {})
    r.raise_for_status()
    return r.json()


def section(
    ctype: ContextType,
    items: List[Dict[str, Any]],
    source: str,
    artifact_type: str,
    resolver_ms: int,
) -> ContextSection:
    capped, truncated = cap_bytes(items)
    prov = [make_ref(it, source, artifact_type) for it in capped]
    return ContextSection(
        context_type=ctype,
        items=capped,
        provenance=prov,
        resolver_ms=resolver_ms,
        truncated=truncated,
    )
