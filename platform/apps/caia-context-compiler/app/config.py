"""Runtime configuration — pulled from env, no secrets in code."""
from __future__ import annotations

import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    # Upstream services (reuse doctrine — never call third-party direct)
    evidence_store_url: str = os.getenv(
        "EVIDENCE_STORE_URL", "http://evidence-store:8080"
    )
    jira_proxy_url: str = os.getenv(
        "JIRA_PROXY_URL", "http://jira-proxy:8080"
    )
    pgvector_url: str = os.getenv(
        "PGVECTOR_URL", "http://pgvector-code-search:8080"
    )
    pattern_library_url: str = os.getenv(
        "PATTERN_LIBRARY_URL", "http://pattern-library:8080"
    )
    nfr_catalog_url: str = os.getenv(
        "NFR_CATALOG_URL", "http://nfr-catalog:8080"
    )
    domain_events_url: str = os.getenv(
        "DOMAIN_EVENTS_URL", "http://event-store:8080"
    )

    # Cache
    redis_url: str = os.getenv("REDIS_URL", "redis://redis:6379/7")
    cache_ttl_s: int = int(os.getenv("CACHE_TTL_S", "60"))

    # Observability (factory-otel — STOL-865)
    otel_endpoint: str = os.getenv(
        "OTEL_EXPORTER_OTLP_ENDPOINT", "http://factory-otel:4318"
    )
    service_name: str = "caia-context-compiler"
    service_version: str = "0.1.0"

    # Behaviour caps
    upstream_timeout_s: float = float(os.getenv("UPSTREAM_TIMEOUT_S", "5.0"))
    max_bytes_per_section: int = int(os.getenv("MAX_BYTES_PER_SECTION", "65536"))


settings = Settings()
