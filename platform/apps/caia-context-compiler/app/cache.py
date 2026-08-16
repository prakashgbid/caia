"""Redis-backed cache with deterministic keys → idempotency."""
from __future__ import annotations

import hashlib
import json
from typing import Optional

import redis.asyncio as redis

from .config import settings
from .models import CompileRequest, CompileResponse

_pool: Optional[redis.Redis] = None


async def get_redis() -> redis.Redis:
    global _pool
    if _pool is None:
        _pool = redis.from_url(settings.redis_url, decode_responses=True)
    return _pool


def canonical_hash(req: CompileRequest) -> str:
    """Sort keys and lists to guarantee determinism."""
    payload = {
        "factory_id": req.factory_id,
        "workflow_id": req.workflow_id,
        "input_refs": dict(sorted(req.input_refs.items())),
        "requested_context_types": sorted(t.value for t in req.requested_context_types),
        "query_text": req.query_text or "",
        "max_items_per_type": req.max_items_per_type,
    }
    blob = json.dumps(payload, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()


async def get_cached(key: str) -> Optional[CompileResponse]:
    r = await get_redis()
    raw = await r.get(f"ctx:{key}")
    if not raw:
        return None
    return CompileResponse.model_validate_json(raw)


async def put_cached(key: str, resp: CompileResponse) -> None:
    r = await get_redis()
    await r.setex(
        f"ctx:{key}",
        settings.cache_ttl_s,
        resp.model_dump_json(),
    )
