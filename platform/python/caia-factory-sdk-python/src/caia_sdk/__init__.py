"""caia-factory-sdk — Python SDK for building CAIA microfactories.

Placeholder — real SDK lands in STOL-1036 (Phase 1 Kernel).
"""

from __future__ import annotations

from typing import Any, Awaitable, Callable, TypeVar

from pydantic import BaseModel

__version__ = "0.0.1"


class FactoryTaskEnvelope(BaseModel):
    """Envelope that wraps every task dispatched to a CAIA microfactory."""

    task_id: str
    sf_id: str
    kernel_version: str
    correlation_id: str
    emitted_at: str
    payload: Any


T_In = TypeVar("T_In", bound=BaseModel)
T_Out = TypeVar("T_Out", bound=BaseModel)

FactoryHandler = Callable[[FactoryTaskEnvelope], Awaitable[T_Out]]


def create_factory(sf_id: str, version: str, handler: FactoryHandler[T_Out]) -> None:
    """Register a microfactory handler. Not yet implemented — see STOL-1036."""
    raise NotImplementedError("caia-factory-sdk-python: landing in STOL-1036")
