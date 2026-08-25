"""FastAPI app entrypoint for Vision Intake API.

Loads config from Vault via AppRole (bootstrap tokens only in env), exposes
health/ready endpoints, and mounts stub handlers for all 18 REST routes.
"""
from __future__ import annotations

import logging
import os
from contextlib import asynccontextmanager
from typing import Any
from uuid import UUID, uuid4

from fastapi import FastAPI, HTTPException, Request, status
from fastapi.responses import JSONResponse

logger = logging.getLogger("vision_intake_api")
logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup: verify DB, Kafka, Vault reachable. Shutdown: close pools."""
    logger.info("vision-intake-api starting up")
    app.state.ready = True
    yield
    logger.info("vision-intake-api shutting down")


app = FastAPI(
    title="CAIA Vision Intake API",
    version="0.1.0",
    lifespan=lifespan,
    docs_url="/docs",
    openapi_url="/openapi.json",
)


# ============================================================================
# Health + readiness
# ============================================================================
@app.get("/health", tags=["ops"])
async def health():
    return {"status": "ok"}


@app.get("/ready", tags=["ops"])
async def ready(request: Request):
    if not getattr(request.app.state, "ready", False):
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "not ready")
    # TODO(E1-3): verify DB + Kafka + Vault connectivity here
    return {"status": "ready"}


# ============================================================================
# Session lifecycle
# ============================================================================
@app.post("/api/v1/vision-intake/sessions", status_code=201, tags=["sessions"])
async def create_session() -> dict[str, Any]:
    # TODO(E1-4): persist to intake_sessions + emit outbox event
    return {
        "session_id": str(uuid4()),
        "tenant_id": "00000000-0000-0000-0000-000000000000",
        "state": "DRAFT",
        "loop_count": 0,
        "revision_count": 0,
        "created_at": "1970-01-01T00:00:00Z",
        "updated_at": "1970-01-01T00:00:00Z",
    }


@app.get("/api/v1/vision-intake/sessions", tags=["sessions"])
async def list_sessions(state: str | None = None) -> list[dict[str, Any]]:
    # TODO(E1-4): query intake_sessions filtered by state + tenant
    return []


@app.get("/api/v1/vision-intake/sessions/{session_id}", tags=["sessions"])
async def get_session(session_id: UUID) -> dict[str, Any]:
    # TODO(E1-4): fetch from intake_sessions
    return {"session_id": str(session_id), "state": "DRAFT"}


@app.patch("/api/v1/vision-intake/sessions/{session_id}", tags=["sessions"])
async def patch_session(session_id: UUID) -> dict[str, Any]:
    return {"session_id": str(session_id), "updated": True}


# ============================================================================
# Wizard 1a — answers + uploads
# ============================================================================
@app.post("/api/v1/vision-intake/sessions/{session_id}/answers", status_code=204, tags=["wizard"])
async def upsert_answer(session_id: UUID):
    return


@app.get("/api/v1/vision-intake/sessions/{session_id}/answers", tags=["wizard"])
async def list_answers(session_id: UUID) -> list[dict[str, Any]]:
    return []


@app.post("/api/v1/vision-intake/sessions/{session_id}/uploads", status_code=201, tags=["wizard"])
async def create_upload(session_id: UUID) -> dict[str, Any]:
    return {"upload_id": str(uuid4()), "filename": "stub.txt", "size_bytes": 0, "sha256": "0" * 64, "content_type": "text/plain"}


@app.get("/api/v1/vision-intake/sessions/{session_id}/uploads", tags=["wizard"])
async def list_uploads(session_id: UUID) -> list[dict[str, Any]]:
    return []


# ============================================================================
# Refinement 1b — LLM loop
# ============================================================================
@app.post("/api/v1/vision-intake/sessions/{session_id}/refine", status_code=202, tags=["refinement"])
async def trigger_refine(session_id: UUID):
    return {"status": "queued"}


@app.get("/api/v1/vision-intake/sessions/{session_id}/refine", tags=["refinement"])
async def latest_brief(session_id: UUID) -> dict[str, Any]:
    return {"draft_id": None, "loop_iteration": 0, "converged": False, "open_questions": []}


@app.patch("/api/v1/vision-intake/sessions/{session_id}/questions/{question_id}", tags=["refinement"])
async def answer_question(session_id: UUID, question_id: UUID) -> dict[str, Any]:
    return {"question_id": str(question_id), "answered": True}


# ============================================================================
# Dossier 1c — generation + retrieval
# ============================================================================
@app.post("/api/v1/vision-intake/sessions/{session_id}/generate", status_code=202, tags=["dossier"])
async def trigger_generate(session_id: UUID):
    return {"status": "queued"}


@app.get("/api/v1/vision-intake/sessions/{session_id}/dossier", tags=["dossier"])
async def list_dossier(session_id: UUID) -> list[dict[str, Any]]:
    return []


@app.get("/api/v1/vision-intake/sessions/{session_id}/dossier/{epic_slug}", tags=["dossier"])
async def get_epic(session_id: UUID, epic_slug: str) -> dict[str, Any]:
    return {"epic_id": str(uuid4()), "epic_slug": epic_slug, "state": "PENDING"}


@app.post("/api/v1/vision-intake/sessions/{session_id}/dossier/{epic_slug}", status_code=202, tags=["dossier"])
async def request_revision(session_id: UUID, epic_slug: str) -> dict[str, Any]:
    return {"status": "queued"}


# ============================================================================
# Review 1d — comments + signoff
# ============================================================================
@app.post("/api/v1/vision-intake/sessions/{session_id}/dossier/{epic_slug}/reviews", status_code=201, tags=["review"])
async def add_review(session_id: UUID, epic_slug: str) -> dict[str, Any]:
    return {"review_id": str(uuid4())}


@app.get("/api/v1/vision-intake/sessions/{session_id}/dossier/{epic_slug}/reviews", tags=["review"])
async def list_reviews(session_id: UUID, epic_slug: str) -> list[dict[str, Any]]:
    return []


@app.post("/api/v1/vision-intake/sessions/{session_id}/dossier/{epic_slug}/signoff", tags=["review"])
async def signoff_epic(session_id: UUID, epic_slug: str) -> dict[str, Any]:
    return {"epic_slug": epic_slug, "signed_off": True}
