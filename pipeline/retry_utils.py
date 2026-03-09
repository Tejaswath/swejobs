from __future__ import annotations

import logging
import random
import time
from collections.abc import Callable
from typing import TypeVar


T = TypeVar("T")
logger = logging.getLogger(__name__)


def run_with_backoff(
    operation: Callable[[], T],
    *,
    retries: int = 5,
    base_sleep_seconds: float = 1.0,
    max_sleep_seconds: float = 30.0,
    jitter_seconds: float = 0.4,
    retriable_exceptions: tuple[type[BaseException], ...] = (Exception,),
    context: str = "operation",
) -> T:
    """Run an operation with exponential backoff and jitter."""
    attempt = 0
    while True:
        try:
            return operation()
        except retriable_exceptions as exc:
            attempt += 1
            if attempt > retries:
                logger.error("Retry budget exhausted for %s: %s", context, exc)
                raise

            sleep = min(max_sleep_seconds, base_sleep_seconds * (2 ** (attempt - 1)))
            sleep += random.uniform(0, jitter_seconds)
            logger.warning(
                "Retrying %s after error (attempt %s/%s, sleep=%.2fs): %s",
                context,
                attempt,
                retries,
                sleep,
                exc,
            )
            time.sleep(sleep)
