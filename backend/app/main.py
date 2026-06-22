from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
from datetime import UTC, datetime

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


async def run_probe_cycle() -> list[dict]:
    async with probe_lock:
        results = await asyncio.gather(*(probe_model(target) for target in settings.targets))
        for result in results:
            store.save_probe(result)
        return results


async def scheduler_loop() -> None:
    await run_probe_cycle()
    while True:
        await asyncio.sleep(settings.interval_seconds)
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
                "region": target.region,
                "model": target.model,
                "status": status,
                "latency_ms": latest_row["latency_ms"] if latest_row else None,
                "http_status": latest_row["http_status"] if latest_row else None,
                "error": latest_row["error"] if latest_row else None,
                "last_checked_at": latest_row["checked_at"] if latest_row else None,
                "success_rate": stats["success_rate"],
                "avg_latency_ms": stats["avg_latency_ms"],
                "p95_latency_ms": stats["p95_latency_ms"],
                "history": stats["history"],
                "mock": target.mock or not target.api_key,
                "enabled": target.enabled,
            }
        )

    operational = sum(1 for model in models if model["status"] == "operational")
    degraded = sum(1 for model in models if model["status"] == "degraded")
    down = sum(1 for model in models if model["status"] == "down")
    known = [model for model in models if model["status"] != "unknown"]
    success_rate = round(
        sum(model["success_rate"] for model in known) / len(known), 2
    ) if known else 0
    avg_p95 = round(
        sum(model["p95_latency_ms"] or 0 for model in known) / len(known)
    ) if known else None
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
            "interval_seconds": settings.interval_seconds,
        },
        "models": models,
        "events": [dict(row) for row in store.recent_events()],
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
        "interval_seconds": settings.interval_seconds,
        "window_days": settings.window_days,
        "models": [
            {
                "id": target.id,
                "name": target.name,
                "provider": target.provider,
                "region": target.region,
                "endpoint": target.endpoint,
                "api_key_env": target.api_key_env,
                "has_api_key": bool(target.api_key),
                "mock": target.mock,
                "enabled": target.enabled,
            }
            for target in settings.targets
        ],
    }
