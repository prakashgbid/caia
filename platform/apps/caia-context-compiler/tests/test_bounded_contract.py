"""Core guarantee: only the requested types come back, with provenance."""
from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient
import fakeredis.aioredis

from app import cache as cache_mod
from app.main import app
from app.models import ContextType


def _fake_resolver(ctype: ContextType):
    async def _fn(req):
        from app.models import ArtifactRef, ContextSection
        item = {"id": f"{ctype.value}-1", "sample": "payload"}
        return ContextSection(
            context_type=ctype,
            items=[item],
            provenance=[
                ArtifactRef(
                    artifact_id=item["id"],
                    artifact_type=ctype.value,
                    sha256="deadbeef" * 8,
                    source="test",
                )
            ],
            resolver_ms=1,
        )
    return _fn


def test_only_requested_types_returned(monkeypatch):
    from app import resolvers as R

    stubbed = {t: _fake_resolver(t) for t in ContextType}
    monkeypatch.setattr(R, "RESOLVERS", stubbed)
    from app import main as main_mod
    monkeypatch.setattr(main_mod, "RESOLVERS", stubbed)

    # Redis stub
    fake = fakeredis.aioredis.FakeRedis(decode_responses=True)
    monkeypatch.setattr(cache_mod, "_pool", fake)

    client = TestClient(app)
    r = client.post(
        "/compile",
        json={
            "factory_id": "SF-42",
            "workflow_id": "wf-abc",
            "input_refs": {"vision_spec_id": "vs_1"},
            "requested_context_types": ["vision_spec", "nfrs"],
            "query_text": "hello",
        },
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert set(body["sections"].keys()) == {"vision_spec", "nfrs"}
    for sec in body["sections"].values():
        assert sec["provenance"], "must include provenance"
    assert body["context_hash"], "hash must be deterministic id"


def test_idempotency_same_inputs_same_hash(monkeypatch):
    from app.cache import canonical_hash
    from app.models import CompileRequest

    a = CompileRequest(
        factory_id="SF-42",
        workflow_id="wf",
        input_refs={"b": "2", "a": "1"},
        requested_context_types=[ContextType.NFRS, ContextType.PATTERNS],
    )
    b = CompileRequest(
        factory_id="SF-42",
        workflow_id="wf",
        input_refs={"a": "1", "b": "2"},
        requested_context_types=[ContextType.PATTERNS, ContextType.NFRS],
    )
    assert canonical_hash(a) == canonical_hash(b)
