from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
from datetime import UTC, datetime, timedelta

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import Settings, load_settings
from .prober import probe_model
from .store import StatusStore


settings: Settings = load_settings()
store = StatusStore(settings.database_path)
scheduler_task: asyncio.Task | None = None
probe_lock = asyncio.Lock()


def _iso_now() -> str:
    return datetime.now(UTC).replace(microsecond=0).isoformat()


def _parse_cron_field(field: str, minimum: int, maximum: int) -> set[int]:
    values: set[int] = set()
    for part in field.split(","):
        part = part.strip()
        if not part:
            continue
        step = 1
        if "/" in part:
            part, raw_step = part.split("/", 1)
            step = int(raw_step)
        if part == "*":
            start, end = minimum, maximum
        elif "-" in part:
            raw_start, raw_end = part.split("-", 1)
            start, end = int(raw_start), int(raw_end)
        else:
            start = end = int(part)
        values.update(range(max(minimum, start), min(maximum, end) + 1, step))
    if not values:
        raise ValueError(f"Invalid cron field: {field}")
    return values


def _cron_matches(moment: datetime, expression: str) -> bool:
    minute, hour, day, month, weekday = expression.split()
    cron_weekday = (moment.weekday() + 1) % 7
    return (
        moment.minute in _parse_cron_field(minute, 0, 59)
        and moment.hour in _parse_cron_field(hour, 0, 23)
        and moment.day in _parse_cron_field(day, 1, 31)
        and moment.month in _parse_cron_field(month, 1, 12)
        and cron_weekday in _parse_cron_field(weekday, 0, 6)
    )


def _next_cron_delay_seconds(expression: str) -> float:
    now = datetime.now(UTC).replace(second=0, microsecond=0)
    candidate = now + timedelta(minutes=1)
    for _ in range(366 * 24 * 60):
        if _cron_matches(candidate, expression):
            return max(1.0, (candidate - datetime.now(UTC)).total_seconds())
        candidate += timedelta(minutes=1)
    raise ValueError(f"Could not find next run for cron expression: {expression}")


async def run_probe_cycle() -> list[dict]:
    async with probe_lock:
        results = await asyncio.gather(*(probe_model(target) for target in settings.targets))
        for result in results:
            store.save_probe(result)
        return results


async def scheduler_loop() -> None:
    await run_probe_cycle()
    while True:
        await asyncio.sleep(_next_cron_delay_seconds(settings.probe_cron))
        await run_probe_cycle()


@asynccontextmanager
async def lifespan(_: FastAPI):
    global scheduler_task
    scheduler_task = asyncio.create_task(scheduler_loop())
    try:
        yield
    finally:
        if scheduler_task:
            scheduler_task.cancel()


app = FastAPI(title="LLM Status Monitor", version="0.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def build_status_payload() -> dict:
    latest = store.latest_by_model()
    models = []
    for target in settings.targets:
        latest_row = latest.get(target.id)
        stats = store.stats_for_model(target.id, settings.window_days)
        status = latest_row["status"] if latest_row else "unknown"
        models.append(
            {
                "id": target.id,
                "name": target.name,
                "provider": target.provider,
                "model": target.model,
                "endpoint": target.endpoint,
                "status": status,
                "latency_ms": latest_row["latency_ms"] if latest_row else None,
                "http_status": latest_row["http_status"] if latest_row else None,
                "error": latest_row["error"] if latest_row else None,
                "last_checked_at": latest_row["checked_at"] if latest_row else None,
                "success_rate": stats["success_rate"],
                "avg_latency_ms": stats["avg_latency_ms"],
                "p95_latency_ms": stats["p95_latency_ms"],
                "history": stats["history"],
                "mock": target.mock or (not target.api_key and not target.no_auth),
                "enabled": target.enabled,
                "timeout_seconds": target.timeout_seconds,
                "degraded_threshold_ms": target.degraded_threshold_ms,
            }
        )

    operational = sum(1 for model in models if model["status"] == "operational")
    degraded = sum(1 for model in models if model["status"] == "degraded")
    down = sum(1 for model in models if model["status"] == "down")
    known = [model for model in models if model["status"] != "unknown"]
    success_rate = round(sum(model["success_rate"] for model in known) / len(known), 2) if known else 0
    avg_p95 = round(sum(model["p95_latency_ms"] or 0 for model in known) / len(known)) if known else None
    overall_status = "operational"
    if down:
        overall_status = "down"
    elif degraded:
        overall_status = "degraded"
    elif len(known) != len(models):
        overall_status = "unknown"

    return {
        "summary": {
            "overall_status": overall_status,
            "model_count": len(models),
            "operational_count": operational,
            "degraded_count": degraded,
            "down_count": down,
            "success_rate": success_rate,
            "p95_latency_ms": avg_p95,
            "last_updated_at": max(
                (model["last_checked_at"] for model in models if model["last_checked_at"]),
                default=_iso_now(),
            ),
            "probe_cron": settings.probe_cron,
            "window_days": settings.window_days,
            "public_base_url": settings.public_base_url,
            "config_name": settings.config_path.name,
            "has_mock_models": any(model["mock"] for model in models),
        },
        "models": models,
        "events": [dict(row) for row in store.recent_events()],
        "errors": [dict(row) for row in store.recent_errors(5)],
        "probes": [dict(row) for row in store.recent_probes()],
    }


@app.get("/health")
async def health() -> dict:
    return {"status": "ok", "time": _iso_now()}


@app.get("/api/status")
async def status() -> dict:
    return build_status_payload()


@app.post("/api/probe/run")
async def run_probe() -> dict:
    results = await run_probe_cycle()
    return {"ok": True, "results": results, "status": build_status_payload()}


@app.get("/api/config")
async def config() -> dict:
    return {
        "probe_cron": settings.probe_cron,
        "window_days": settings.window_days,
        "public_base_url": settings.public_base_url,
        "config_name": settings.config_path.name,
        "models": [
            {
                "id": target.id,
                "name": target.name,
                "provider": target.provider,
                "endpoint": target.endpoint,
                "api_key_env": target.api_key_env,
                "has_api_key": bool(target.api_key),
                "no_auth": target.no_auth,
                "mock": target.mock,
                "enabled": target.enabled,
                "timeout_seconds": target.timeout_seconds,
                "degraded_threshold_ms": target.degraded_threshold_ms,
            }
            for target in settings.targets
        ],
    }
