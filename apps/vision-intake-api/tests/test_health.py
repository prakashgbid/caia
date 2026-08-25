"""Smoke tests for health + ready endpoints + a sampling of the 18 route stubs."""
from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import app


client = TestClient(app)


def test_health():
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}


def test_ready():
    r = client.get("/ready")
    assert r.status_code == 200
    assert r.json() == {"status": "ready"}


def test_create_session():
    r = client.post("/api/v1/vision-intake/sessions")
    assert r.status_code == 201
    body = r.json()
    assert "session_id" in body
    assert body["state"] == "DRAFT"


def test_list_sessions_returns_array():
    r = client.get("/api/v1/vision-intake/sessions")
    assert r.status_code == 200
    assert r.json() == []


def test_trigger_refine_returns_202():
    r = client.post(
        "/api/v1/vision-intake/sessions/00000000-0000-0000-0000-000000000000/refine"
    )
    assert r.status_code == 202


def test_trigger_generate_returns_202():
    r = client.post(
        "/api/v1/vision-intake/sessions/00000000-0000-0000-0000-000000000000/generate"
    )
    assert r.status_code == 202


def test_signoff_returns_200():
    r = client.post(
        "/api/v1/vision-intake/sessions/00000000-0000-0000-0000-000000000000/dossier/market/signoff"
    )
    assert r.status_code == 200
    assert r.json()["signed_off"] is True
