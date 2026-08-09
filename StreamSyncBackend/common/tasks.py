"""
Queueing background work safely.

Everything that dispatches a Celery task goes through `enqueue`, so a broker
problem degrades one feature instead of breaking the request that triggered it.
"""

import logging
from typing import Any

logger = logging.getLogger("streamsync.tasks")


def enqueue(task, **kwargs: Any) -> bool:
    """
    Queue a task, or give up and log.

    Returns True when the task was handed to the broker.

    WHY THIS SWALLOWS
    -----------------
    Dispatch happens in `transaction.on_commit`, which runs *after* the data is
    safely written. An exception there still propagates into the response, so a
    Redis outage would turn "assign a task" — already committed — into a 500,
    and the user would retry an action that in fact succeeded.

    A notification is worth strictly less than the write that caused it. Losing
    one is the correct trade; failing the write is not. Same reasoning as the
    savepoint in `apps/activity/services.record`.

    The failure is logged at error level, because a broker that is down is an
    operational problem even though no user sees it.
    """
    try:
        task.delay(**kwargs)
    except Exception:
        logger.exception(
            "Failed to queue background task",
            extra={
                "task": getattr(task, "name", str(task)),
                "event": "task.enqueue_failed",
            },
        )
        return False

    return True
