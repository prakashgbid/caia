"""STOL-1035 · CAIA Kernel · Temporal example — workflow + activity."""

from datetime import timedelta

from temporalio import activity, workflow


@activity.defn
async def compose_greeting(name: str) -> str:
    """Trivial activity — returns a formatted greeting."""
    activity.logger.info("compose_greeting invoked for %s", name)
    return f"Hello, {name} from CAIA Temporal!"


@workflow.defn
class GreetingWorkflow:
    """Kernel smoke workflow: schedules one activity and returns the result."""

    @workflow.run
    async def run(self, name: str) -> str:
        return await workflow.execute_activity(
            compose_greeting,
            name,
            start_to_close_timeout=timedelta(seconds=30),
        )
