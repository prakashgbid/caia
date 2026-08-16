"""Prometheus metrics — scraped by factory-otel (STOL-865)."""
from __future__ import annotations

from prometheus_client import Counter, Histogram, generate_latest, CONTENT_TYPE_LATEST

COMPILE_DURATION = Histogram(
    "context_compile_duration_seconds",
    "End-to-end /compile latency",
    labelnames=("factory_id", "cache_hit"),
    buckets=(0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10),
)

COMPILE_SIZE = Histogram(
    "context_size_bytes",
    "Compiled context total size in bytes",
    labelnames=("factory_id",),
    buckets=(1024, 4096, 16384, 65536, 262144, 1048576),
)

CONTEXT_TYPES_REQUESTED = Counter(
    "context_types_requested_total",
    "Count of context types requested",
    labelnames=("type",),
)

RESOLVER_DURATION = Histogram(
    "context_resolver_duration_seconds",
    "Per-resolver latency",
    labelnames=("type", "outcome"),
    buckets=(0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5),
)

CACHE_HITS = Counter(
    "context_cache_hits_total", "Redis cache hits", labelnames=("factory_id",)
)
CACHE_MISSES = Counter(
    "context_cache_misses_total", "Redis cache misses", labelnames=("factory_id",)
)


def metrics_response():
    return generate_latest(), CONTENT_TYPE_LATEST
