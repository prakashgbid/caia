"""FastAPI entrypoint — POST /compile."""
from __future__ import annotations

import asyncio
import json
import logging
import time
from datetime import datetime, timezone

from fastapi import FastAPI, HTTPException, Response
from opentelemetry import trace
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor

from . import __version__
from .cache import canonical_hash, get_cached, put_cached
from .config import settings
from .metrics import (
    CACHE_HITS,
    CACHE_MISSES,
    COMPILE_DURATION,
    COMPILE_SIZE,
    CONTEXT_TYPES_REQUESTED,
    RESOLVER_DURATION,
    metrics_response,
)
from .models import CompileRequest, CompileResponse, ContextSection, ContextType
from .resolvers import RESOLVERS

log = logging.getLogger("caia-context-compiler")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")


# --- OTEL bootstrap (factory-otel STOL-865) ---
resource = Resource.create(
    {"service.name": settings.service_name, "service.version": settings.service_version}
)
provider = TracerProvider(resource=resource)
provider.add_span_processor(
    BatchSpanProcessor(OTLPSpanExporter(endpoint=f"{settings.otel_endpoint}/v1/traces"))
)
trace.set_tracer_provider(provider)
tracer = trace.get_tracer(settings.service_name)


app = FastAPI(title="caia-context-compiler", version=__version__)
FastAPIInstrumentor.instrument_app(app)


@app.get("/healthz")
async def healthz():
    return {"ok": True, "service": settings.service_name, "version": __version__}


@app.get("/metrics")
async def metrics():
    body, ctype = metrics_response()
    return Response(content=body, media_type=ctype)


async def _run_resolver(ctype: ContextType, req: CompileRequest) -> ContextSection:
    resolver = RESOLVERS[ctype]
    t0 = time.perf_counter()
    outcome = "ok"
    try:
        return await resolver(req)
    except Exception as exc:  # noqa: BLE001 — bounded, logged
        outcome = "error"
        log.warning("resolver_error type=%s err=%s", ctype.value, exc)
        return ContextSection(
            context_type=ctype,
            items=[],
            provenance=[],
            resolver_ms=int((time.perf_counter() - t0) * 1000),
            truncated=False,
        )
    finally:
        RESOLVER_DURATION.labels(type=ctype.value, outcome=outcome).observe(
            time.perf_counter() - t0
        )


@app.post("/compile", response_model=CompileResponse)
async def compile_context(req: CompileRequest) -> CompileResponse:
    if not req.requested_context_types:
        raise HTTPException(400, "requested_context_types must not be empty")

    for t in req.requested_context_types:
        CONTEXT_TYPES_REQUESTED.labels(type=t.value).inc()

    key = canonical_hash(req)

    # Cache check — idempotent within TTL
    cached = await get_cached(key)
    if cached is not None:
        CACHE_HITS.labels(factory_id=req.factory_id).inc()
        cached.cache_hit = True
        COMPILE_DURATION.labels(factory_id=req.factory_id, cache_hit="true").observe(
            0.001
        )
        return cached
    CACHE_MISSES.labels(factory_id=req.factory_id).inc()

    t0 = time.perf_counter()
    with tracer.start_as_current_span("compile") as span:
        span.set_attribute("factory_id", req.factory_id)
        span.set_attribute("workflow_id", req.workflow_id)
        span.set_attribute(
            "requested_types", ",".join(t.value for t in req.requested_context_types)
        )

        # Parallel fan-out to only the requested resolvers
        results = await asyncio.gather(
            *[_run_resolver(t, req) for t in req.requested_context_types]
        )
        sections = {sec.context_type: sec for sec in results}

    total_bytes = sum(
        len(json.dumps(s.items, default=str).encode("utf-8")) for s in sections.values()
    )
    duration_ms = int((time.perf_counter() - t0) * 1000)

    resp = CompileResponse(
        factory_id=req.factory_id,
        workflow_id=req.workflow_id,
        compiled_at=datetime.now(timezone.utc).isoformat(),
        context_hash=key,
        sections=sections,
        total_size_bytes=total_bytes,
        total_duration_ms=duration_ms,
        cache_hit=False,
    )

    await put_cached(key, resp)

    COMPILE_DURATION.labels(factory_id=req.factory_id, cache_hit="false").observe(
        duration_ms / 1000.0
    )
    COMPILE_SIZE.labels(factory_id=req.factory_id).observe(total_bytes)

    return resp
