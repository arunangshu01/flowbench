"""In-process interval scheduler for saved pipelines.

A daemon thread polls every few seconds and re-runs due schedules through
the same planned, bounded engine as manual runs. This is deliberately
simple: it fits the single-instance deployment. Multi-instance hosting would
move this to Cloud Scheduler hitting an authenticated endpoint.
"""

from __future__ import annotations

import json
import logging
import threading
import time

from app.core import PipelineConfig, run_pipeline
from app.core.ratelimit import run_slots
from app.store import due_schedules, mark_scheduled, save_run

log = logging.getLogger("flowbench.scheduler")
POLL_S = 5.0


def run_due_schedules(now_epoch: float) -> list[str]:
    """Execute every due schedule once. Returns the new run ids."""
    run_ids: list[str] = []
    for sched in due_schedules(now_epoch):
        if not run_slots.acquire(blocking=False):
            log.info("execution slots busy; deferring schedule %s", sched["id"])
            break
        try:
            config = PipelineConfig(**json.loads(sched["config_json"]))
            run_ids.append(save_run(run_pipeline(config, trigger="schedule")))
        except Exception:
            log.exception("scheduled run %s failed", sched["id"])
        finally:
            run_slots.release()
            mark_scheduled(sched["id"])
    return run_ids


def scheduler_loop(stop: threading.Event) -> None:
    while not stop.is_set():
        try:
            run_due_schedules(time.time())
        except Exception:
            log.exception("scheduler tick failed")
        stop.wait(POLL_S)
