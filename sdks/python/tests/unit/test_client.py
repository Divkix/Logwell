from __future__ import annotations

import asyncio
import threading
from typing import TYPE_CHECKING

from logwell.client import Logwell

if TYPE_CHECKING:
    from logwell.types import LogwellConfig


def test_sync_log_calls_from_any_thread_land_in_shared_queue(
    valid_config: LogwellConfig,
) -> None:
    """Client wiring is pinned by the TS reference SDK. The one Python delta:
    the queue drains on a daemon asyncio loop on its own thread, so the sync
    log API must accept calls from any thread."""
    client = Logwell(valid_config)
    try:
        threads = [threading.Thread(target=client.info, args=(f"msg_{i}",)) for i in range(10)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()

        assert client.queue_size == 10
    finally:
        asyncio.run(client.shutdown())
