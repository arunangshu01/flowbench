"""Abuse controls for run execution: per-client token bucket + global
concurrency cap. Both are in-process, which matches the single-instance
Cloud Run deployment this app targets."""

from __future__ import annotations

import os
import threading
import time

RATE_PER_MIN = 10.0
CAPACITY = 10.0
MAX_BUCKETS = 10_000
IDLE_EVICT_S = 600.0
MAX_CONCURRENT_RUNS = int(os.environ.get("FLOWBENCH_MAX_CONCURRENT_RUNS", "4"))


class RateLimiter:
    def __init__(self, rate_per_min: float = RATE_PER_MIN, capacity: float = CAPACITY):
        self._rate = rate_per_min / 60.0  # tokens per second
        self._capacity = capacity
        self._buckets: dict[str, tuple[float, float]] = {}  # key -> (tokens, ts)
        self._lock = threading.Lock()

    def _prune(self, now: float) -> None:
        stale = [k for k, (_, ts) in self._buckets.items() if now - ts > IDLE_EVICT_S]
        for k in stale:
            del self._buckets[k]

    def allow(self, key: str) -> bool:
        now = time.monotonic()
        with self._lock:
            if len(self._buckets) >= MAX_BUCKETS:
                self._prune(now)
            tokens, ts = self._buckets.get(key, (self._capacity, now))
            tokens = min(self._capacity, tokens + (now - ts) * self._rate)
            allowed = tokens >= 1.0
            self._buckets[key] = (tokens - 1.0 if allowed else tokens, now)
            return allowed

    def reset(self) -> None:
        with self._lock:
            self._buckets.clear()


run_slots = threading.BoundedSemaphore(MAX_CONCURRENT_RUNS)
