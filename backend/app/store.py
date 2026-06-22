from __future__ import annotations

import sqlite3
from contextlib import contextmanager
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Iterator


def utc_now() -> datetime:
    return datetime.now(UTC).replace(microsecond=0)


class StatusStore:
    def __init__(self, database_path: Path) -> None:
        self.database_path = database_path
        self.database_path.parent.mkdir(parents=True, exist_ok=True)
        self.init()

    @contextmanager
    def connect(self) -> Iterator[sqlite3.Connection]:
        conn = sqlite3.connect(self.database_path)
        conn.row_factory = sqlite3.Row
        try:
            yield conn
            conn.commit()
        finally:
            conn.close()

    def init(self) -> None:
        with self.connect() as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS probe_results (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    model_id TEXT NOT NULL,
                    model_name TEXT NOT NULL,
                    provider TEXT NOT NULL,
                    region TEXT DEFAULT '',
                    status TEXT NOT NULL,
                    latency_ms INTEGER,
                    http_status INTEGER,
                    error TEXT,
                    checked_at TEXT NOT NULL
                )
                """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS events (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    model_id TEXT NOT NULL,
                    model_name TEXT NOT NULL,
                    severity TEXT NOT NULL,
                    title TEXT NOT NULL,
                    description TEXT NOT NULL,
                    created_at TEXT NOT NULL
                )
                """
            )
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_probe_model_time ON probe_results(model_id, checked_at DESC)"
            )

    def save_probe(self, result: dict) -> None:
        with self.connect() as conn:
            previous = conn.execute(
                """
                SELECT status FROM probe_results
                WHERE model_id = ?
                ORDER BY checked_at DESC
                LIMIT 1
                """,
                (result["model_id"],),
            ).fetchone()
            conn.execute(
                """
                INSERT INTO probe_results (
                    model_id, model_name, provider, region, status, latency_ms,
                    http_status, error, checked_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    result["model_id"],
                    result["model_name"],
                    result["provider"],
                    result.get("region", ""),
                    result["status"],
                    result.get("latency_ms"),
                    result.get("http_status"),
                    result.get("error"),
                    result["checked_at"],
                ),
            )
            if previous is None or previous["status"] != result["status"]:
                severity = "info"
                title = f"{result['model_name']} 运行正常"
                description = "探测恢复成功。"
                if result["status"] == "degraded":
                    severity = "warning"
                    title = f"{result['model_name']} 响应变慢"
                    description = result.get("error") or "响应时间超过阈值。"
                if result["status"] == "down":
                    severity = "critical"
                    title = f"{result['model_name']} 接口异常"
                    description = result.get("error") or "接口探测失败。"
                conn.execute(
                    """
                    INSERT INTO events (
                        model_id, model_name, severity, title, description, created_at
                    )
                    VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    (
                        result["model_id"],
                        result["model_name"],
                        severity,
                        title,
                        description,
                        result["checked_at"],
                    ),
                )

    def latest_by_model(self) -> dict[str, sqlite3.Row]:
        with self.connect() as conn:
            rows = conn.execute(
                """
                SELECT pr.*
                FROM probe_results pr
                INNER JOIN (
                    SELECT model_id, MAX(checked_at) AS checked_at
                    FROM probe_results
                    GROUP BY model_id
                ) latest
                ON pr.model_id = latest.model_id AND pr.checked_at = latest.checked_at
                """
            ).fetchall()
        return {row["model_id"]: row for row in rows}

    def recent_probes(self, limit: int = 12) -> list[sqlite3.Row]:
        with self.connect() as conn:
            return conn.execute(
                """
                SELECT * FROM probe_results
                ORDER BY checked_at DESC
                LIMIT ?
                """,
                (limit,),
            ).fetchall()

    def recent_errors(self, limit: int = 5) -> list[sqlite3.Row]:
        with self.connect() as conn:
            return conn.execute(
                """
                SELECT * FROM probe_results
                WHERE status IN ('degraded', 'down') OR error IS NOT NULL OR http_status >= 400
                ORDER BY checked_at DESC
                LIMIT ?
                """,
                (limit,),
            ).fetchall()

    def recent_events(self, limit: int = 8) -> list[sqlite3.Row]:
        with self.connect() as conn:
            return conn.execute(
                """
                SELECT * FROM events
                ORDER BY created_at DESC
                LIMIT ?
                """,
                (limit,),
            ).fetchall()

    def stats_for_model(self, model_id: str, days: int) -> dict:
        since = utc_now() - timedelta(days=days)
        with self.connect() as conn:
            rows = conn.execute(
                """
                SELECT status, latency_ms, checked_at FROM probe_results
                WHERE model_id = ? AND checked_at >= ?
                ORDER BY checked_at ASC
                """,
                (model_id, since.isoformat()),
            ).fetchall()

        if not rows:
            return {"success_rate": 0, "avg_latency_ms": None, "p95_latency_ms": None, "history": []}

        ok_count = sum(1 for row in rows if row["status"] in {"operational", "degraded"})
        latencies = sorted(row["latency_ms"] for row in rows if row["latency_ms"] is not None)
        p95_index = max(0, min(len(latencies) - 1, int(len(latencies) * 0.95) - 1)) if latencies else 0

        by_day: dict[str, list[str]] = {}
        for row in rows:
            key = row["checked_at"][:10]
            by_day.setdefault(key, []).append(row["status"])

        history = []
        for index in range(days):
            day = (utc_now() - timedelta(days=days - index - 1)).date().isoformat()
            statuses = by_day.get(day, [])
            status = "unknown"
            if statuses:
                if "down" in statuses:
                    status = "down"
                elif "degraded" in statuses:
                    status = "degraded"
                else:
                    status = "operational"
            history.append({"date": day, "status": status})

        return {
            "success_rate": round(ok_count / len(rows) * 100, 2),
            "avg_latency_ms": round(sum(latencies) / len(latencies)) if latencies else None,
            "p95_latency_ms": latencies[p95_index] if latencies else None,
            "history": history,
        }
