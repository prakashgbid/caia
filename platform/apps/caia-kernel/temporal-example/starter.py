"""STOL-1035 · CAIA Kernel · Temporal example — starter (client)."""

import asyncio
import os
import sys
import uuid

from temporalio.client import Client

from workflows import GreetingWorkflow

TEMPORAL_HOST = os.environ.get("TEMPORAL_HOST", "127.0.0.1:7233")
NAMESPACE = os.environ.get("TEMPORAL_NAMESPACE", "caia")
TASK_QUEUE = os.environ.get("TEMPORAL_TASK_QUEUE", "caia.factories.default")


async def main() -> None:
    name = sys.argv[1] if len(sys.argv) > 1 else "CAIA Kernel"
    client = await Client.connect(TEMPORAL_HOST, namespace=NAMESPACE)
    wf_id = f"caia-kernel-smoke-{uuid.uuid4().hex[:8]}"
    handle = await client.start_workflow(
        GreetingWorkflow.run,
        name,
        id=wf_id,
        task_queue=TASK_QUEUE,
    )
    print(f"Started workflow id={wf_id} · run_id={handle.result_run_id}")
    result = await handle.result()
    print(f"Result: {result}")


if __name__ == "__main__":
    asyncio.run(main())
