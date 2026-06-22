from __future__ import annotations

import asyncio
import hashlib
import random
import time
from datetime import UTC, datetime

import httpx

from .config import ModelTarget


def _chat_completions_endpoint(endpoint: str) -> str:
    cleaned = endpoint.rstrip("/")
    if cleaned.endswith("/chat/completions"):
        return cleaned
    return f"{cleaned}/chat/completions"


def _status_from_latency(latency_ms: int, ok: bool, degraded_threshold_ms: int) -> str:
    if not ok:
        return "down"
    if latency_ms >= degraded_threshold_ms:
        return "degraded"
    return "operational"


async def probe_model(target: ModelTarget) -> dict:
    checked_at = datetime.now(UTC).replace(microsecond=0).isoformat()
    if not target.enabled:
        return {
            "model_id": target.id,
            "model_name": target.name,
            "provider": target.provider,
            "status": "down",
            "latency_ms": None,
            "http_status": None,
            "error": "Model target is disabled.",
            "checked_at": checked_at,
        }

    if target.mock or (not target.api_key and not target.no_auth) or not target.endpoint:
        return await _mock_probe(target, checked_at)

    headers = {"Content-Type": "application/json"}
    if target.api_key:
        headers["Authorization"] = f"Bearer {target.api_key}"
    payload = {
        "model": target.model,
        "messages": [{"role": "user", "content": target.test_prompt}],
        "max_tokens": 8,
        "temperature": 0,
    }

    started = time.perf_counter()
    try:
        async with httpx.AsyncClient(timeout=target.timeout_seconds) as client:
            response = await client.post(_chat_completions_endpoint(target.endpoint), headers=headers, json=payload)
        latency_ms = round((time.perf_counter() - started) * 1000)
        ok = response.is_success
        status = _status_from_latency(latency_ms, ok, target.degraded_threshold_ms)
        error = None if ok else response.text[:240]
        if response.status_code in {401, 403, 404, 429}:
            status = "down"
        return {
            "model_id": target.id,
            "model_name": target.name,
            "provider": target.provider,
            "status": status,
            "latency_ms": latency_ms,
            "http_status": response.status_code,
            "error": error,
            "checked_at": checked_at,
        }
    except Exception as exc:
        latency_ms = round((time.perf_counter() - started) * 1000)
        return {
            "model_id": target.id,
            "model_name": target.name,
            "provider": target.provider,
            "status": "down",
            "latency_ms": latency_ms,
            "http_status": None,
            "error": str(exc)[:240],
            "checked_at": checked_at,
        }


async def _mock_probe(target: ModelTarget, checked_at: str) -> dict:
    await asyncio.sleep(0.04)
    seed = int(hashlib.sha256(f"{target.id}:{checked_at[:16]}".encode()).hexdigest()[:8], 16)
    rng = random.Random(seed)
    base = {
        "openai-gpt-4-1": 820,
        "deepseek-chat": 1120,
        "claude-sonnet": 2200,
        "qwen-max": 1290,
    }.get(target.id, 950)
    latency_ms = max(180, round(base + rng.randint(-160, 620)))
    roll = rng.random()
    status = _status_from_latency(latency_ms, True, target.degraded_threshold_ms)
    if roll > 0.96:
        status = "down"
    error = None
    if status == "degraded":
        error = f"响应时间超过 {target.degraded_threshold_ms}ms 阈值。"
    if status == "down":
        error = "模拟探测失败，请配置真实模型接口。"
    return {
        "model_id": target.id,
        "model_name": target.name,
        "provider": target.provider,
        "status": status,
        "latency_ms": latency_ms,
        "http_status": 200 if status != "down" else 503,
        "error": error,
        "checked_at": checked_at,
    }
