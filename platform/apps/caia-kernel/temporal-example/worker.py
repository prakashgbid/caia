"""STOL-1035 · CAIA Kernel · Temporal example — worker."""

import asyncio
import logging
import os

from temporalio.client import Client
from temporalio.worker import Worker

from workflows import GreetingWorkflow, compose_greeting

TEMPORAL_HOST = os.environ.get("TEMPORAL_HOST", "127.0.0.1:7233")
NAMESPACE = os.environ.get("TEMPORAL_NAMESPACE", "caia")
TASK_QUEUE = os.environ.get("TEMPORAL_TASK_QUEUE", "caia.factories.default")


async def main() -> None:
    logging.basicConfig(level=logging.INFO)
    client = await Client.connect(TEMPORAL_HOST, namespace=NAMESPACE)
    worker = Worker(
        client,
        task_queue=TASK_QUEUE,
        workflows=[GreetingWorkflow],
        activities=[compose_greeting],
    )
    logging.info("Worker started · ns=%s · tq=%s · host=%s", NAMESPACE, TASK_QUEUE, TEMPORAL_HOST)
    await worker.run()


if __name__ == "__main__":
    asyncio.run(main())
