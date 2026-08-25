"""Temporal worker entrypoint for Vision Intake.

Registers workflow + activity implementations, connects to the Temporal server,
and runs the worker loop. Config loaded from Vault via AppRole at boot.
"""
from __future__ import annotations

import asyncio
import logging
import os
import signal

logger = logging.getLogger("vision_intake_orchestrator")
logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))


async def _run_worker() -> None:
    """Boot Temporal worker.

    TODO(E1-6): connect to Temporal server + register workflows/activities from
    E3 (refinement loop) and E4 (dossier generation). For now this is a
    long-running heartbeat so the container stays alive under docker compose.
    """
    stop = asyncio.Event()

    def _shutdown(*_):
        logger.info("orchestrator received shutdown signal")
        stop.set()

    loop = asyncio.get_running_loop()
    for sig in (signal.SIGTERM, signal.SIGINT):
        loop.add_signal_handler(sig, _shutdown)

    logger.info("vision-intake-orchestrator worker starting (heartbeat mode)")
    while not stop.is_set():
        try:
            await asyncio.wait_for(stop.wait(), timeout=30.0)
        except asyncio.TimeoutError:
            logger.debug("orchestrator heartbeat")
    logger.info("vision-intake-orchestrator worker stopped")


if __name__ == "__main__":
    asyncio.run(_run_worker())
