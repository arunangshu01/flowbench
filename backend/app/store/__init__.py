"""Run history and schedule persistence in SQLite. Zero-infra, WAL mode."""

from __future__ import annotations

import json
import os
import sqlite3
import threading
import uuid
from datetime import datetime, timezone
from typing import Any

DB_PATH = os.environ.get("FLOWBENCH_DB", os.path.join(os.path.dirname(__file__), "..", "..", "flowbench.db"))
MAX_STORED_RUNS = 500     # prune oldest beyond this to keep the file bounded
MAX_SCHEDULES = 5
MIN_INTERVAL_S = 60
MAX_INTERVAL_S = 86400

_lock = threading.Lock()
_conn: sqlite3.Connection | None = None


def _connect() -> sqlite3.Connection:
    global _conn
    if _conn is None:
        _conn = sqlite3.connect(DB_PATH, check_same_thread=False)
        _conn.row_factory = sqlite3.Row
        _conn.execute("PRAGMA journal_mode=WAL")
        _conn.execute(
            """CREATE TABLE IF NOT EXISTS runs (
                 id TEXT PRIMARY KEY,
                 dataset_id TEXT NOT NULL,
                 status TEXT NOT NULL,
                 config_json TEXT NOT NULL,
                 report_json TEXT NOT NULL,
                 rows_in INTEGER, rows_out INTEGER,
                 rejected_total INTEGER, duration_ms REAL,
                 created_at TEXT NOT NULL)"""
        )
        _conn.execute(
            """CREATE TABLE IF NOT EXISTS schedules (
                 id TEXT PRIMARY KEY,
                 config_json TEXT NOT NULL,
                 interval_s INTEGER NOT NULL,
                 active INTEGER NOT NULL DEFAULT 1,
                 last_run_at TEXT,
                 created_at TEXT NOT NULL)"""
        )
    return _conn


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def save_run(report: dict) -> str:
    run_id = uuid.uuid4().hex[:12]
    with _lock:
        conn = _connect()
        conn.execute(
            "INSERT INTO runs VALUES (?,?,?,?,?,?,?,?,?,?)",
            (run_id, report["dataset_id"], report["status"],
             json.dumps(report["config"]), json.dumps(report),
             report["rows_in"], report["rows_out"],
             report["rejected_total"], report["duration_ms"], _now()),
        )
        conn.execute(
            "DELETE FROM runs WHERE id NOT IN "
            "(SELECT id FROM runs ORDER BY created_at DESC LIMIT ?)",
            (MAX_STORED_RUNS,),
        )
        conn.commit()
    return run_id


def get_run(run_id: str) -> dict | None:
    with _lock:
        row = _connect().execute(
            "SELECT report_json FROM runs WHERE id = ?", (run_id,)).fetchone()
    if row is None:
        return None
    report = json.loads(row["report_json"])
    report["run_id"] = run_id
    return report


def list_runs(limit: int = 50) -> list[dict]:
    limit = min(max(1, limit), 200)
    with _lock:
        rows = _connect().execute(
            "SELECT id, dataset_id, status, rows_in, rows_out, rejected_total,"
            " duration_ms, created_at, json_extract(report_json,'$.trigger') AS trigger,"
            " json_extract(report_json,'$.replayed_from') AS replayed_from,"
            " json_array_length(report_json,'$.config.stages') AS stage_count"
            " FROM runs ORDER BY created_at DESC LIMIT ?",
            (limit,)).fetchall()
    return [dict(r) for r in rows]


# ---------------------------------------------------------------------------
# Schedules
# ---------------------------------------------------------------------------


def create_schedule(config: dict, interval_s: int) -> str:
    interval_s = max(MIN_INTERVAL_S, min(MAX_INTERVAL_S, int(interval_s)))
    with _lock:
        conn = _connect()
        n = conn.execute("SELECT COUNT(*) c FROM schedules WHERE active=1").fetchone()["c"]
        if n >= MAX_SCHEDULES:
            raise ValueError(f"schedule limit reached ({MAX_SCHEDULES})")
        sid = uuid.uuid4().hex[:12]
        conn.execute(
            "INSERT INTO schedules VALUES (?,?,?,1,NULL,?)",
            (sid, json.dumps(config), interval_s, _now()))
        conn.commit()
    return sid


def delete_schedule(sid: str) -> bool:
    with _lock:
        cur = _connect().execute("DELETE FROM schedules WHERE id=?", (sid,))
        _connect().commit()
    return cur.rowcount > 0


def list_schedules() -> list[dict]:
    with _lock:
        rows = _connect().execute(
            "SELECT id, config_json, interval_s, active, last_run_at, created_at"
            " FROM schedules ORDER BY created_at DESC").fetchall()
    return [
        {**{k: r[k] for k in ("id", "interval_s", "active", "last_run_at", "created_at")},
         "config": json.loads(r["config_json"])}
        for r in rows
    ]


def due_schedules(now_epoch: float) -> list[dict]:
    """Active schedules whose interval has elapsed since last run (or never ran)."""
    with _lock:
        rows = _connect().execute(
            "SELECT id, config_json, interval_s, last_run_at FROM schedules"
            " WHERE active=1").fetchall()
    due = []
    for r in rows:
        if r["last_run_at"] is None:
            due.append(r)
            continue
        last = datetime.fromisoformat(r["last_run_at"]).timestamp()
        if now_epoch - last >= r["interval_s"]:
            due.append(r)
    return due


def mark_scheduled(sid: str) -> None:
    with _lock:
        _connect().execute(
            "UPDATE schedules SET last_run_at=? WHERE id=?", (_now(), sid))
        _connect().commit()
