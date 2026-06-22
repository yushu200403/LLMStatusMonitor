from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any


@dataclass(frozen=True)
class ModelTarget:
    id: str
    name: str
    provider: str
    model: str
    endpoint: str
    api_key_env: str
    api_key: str | None
    no_auth: bool
    test_prompt: str
    timeout_seconds: float
    degraded_threshold_ms: int
    enabled: bool
    mock: bool


@dataclass(frozen=True)
class Settings:
    database_path: Path
    config_path: Path
    probe_cron: str
    window_days: int
    public_base_url: str
    targets: list[ModelTarget]


DEFAULT_TARGETS: list[dict[str, Any]] = [
    {
        "id": "openai-gpt-4-1",
        "name": "OpenAI GPT-4.1",
        "provider": "OpenAI",
        "model": "gpt-4.1",
        "endpoint": "https://api.openai.com/v1",
        "api_key_env": "OPENAI_API_KEY",
        "mock": True,
    },
    {
        "id": "deepseek-chat",
        "name": "DeepSeek Chat",
        "provider": "DeepSeek",
        "model": "deepseek-chat",
        "endpoint": "https://api.deepseek.com",
        "api_key_env": "DEEPSEEK_API_KEY",
        "mock": True,
    },
    {
        "id": "claude-sonnet",
        "name": "Claude Sonnet",
        "provider": "Anthropic",
        "model": "claude-3-5-sonnet-latest",
        "endpoint": "https://api.anthropic.com/v1",
        "api_key_env": "ANTHROPIC_API_KEY",
        "mock": True,
    },
    {
        "id": "qwen-max",
        "name": "Qwen Max",
        "provider": "Alibaba Cloud",
        "model": "qwen-max",
        "endpoint": "https://dashscope.aliyuncs.com/compatible-mode/v1",
        "api_key_env": "DASHSCOPE_API_KEY",
        "mock": True,
    },
]


def _read_config(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {"models": DEFAULT_TARGETS}
    with path.open("r", encoding="utf-8-sig") as handle:
        payload = json.load(handle)
    if isinstance(payload, list):
        return {"models": payload}
    if isinstance(payload, dict):
        return payload
    raise ValueError("Model config must be a list or an object with a 'models' array.")


def _config_path() -> Path:
    local_private_config = Path.cwd() / "config" / "models.local.json"
    local_example_config = Path.cwd() / "config" / "models.example.json"
    local_config = local_private_config if local_private_config.exists() else local_example_config
    default_path = local_config if local_config.exists() else Path("/app/config/models.json")
    return Path(os.getenv("MODEL_CONFIG_PATH", str(default_path)))


def _model_degraded_threshold_ms(raw: dict[str, Any]) -> int:
    if "degraded_threshold_ms" in raw:
        return max(1, int(raw["degraded_threshold_ms"]))
    if "degraded_threshold_seconds" in raw:
        return max(1, int(float(raw["degraded_threshold_seconds"]) * 1000))
    return 5000


def load_settings() -> Settings:
    config_path = _config_path()
    raw_config = _read_config(config_path)
    local_data = Path.cwd() / "status.db"
    database_path = Path(os.getenv("DATABASE_PATH", str(local_data if (Path.cwd() / "config").exists() else "/app/data/status.db")))
    probe_cron = os.getenv("PROBE_CRON", str(raw_config.get("probe_cron", "*/10 * * * *"))).strip()
    window_days = int(os.getenv("STATUS_WINDOW_DAYS", str(raw_config.get("window_days", 7))))
    public_base_url = os.getenv("PUBLIC_BASE_URL", str(raw_config.get("public_base_url", ""))).strip()

    targets: list[ModelTarget] = []
    for raw in raw_config.get("models", DEFAULT_TARGETS):
        api_key_env = str(raw.get("api_key_env", ""))
        raw_api_key = raw.get("api_key")
        api_key = str(raw_api_key) if raw_api_key else (os.getenv(api_key_env) if api_key_env else None)
        no_auth = str(raw_api_key or "").strip().upper() == "NA" or bool(raw.get("no_auth", False))
        if no_auth:
            api_key = None
        targets.append(
            ModelTarget(
                id=str(raw["id"]),
                name=str(raw["name"]),
                provider=str(raw.get("provider", raw["name"])),
                model=str(raw.get("model", raw["id"])),
                endpoint=str(raw.get("endpoint", "")),
                api_key_env=api_key_env,
                api_key=api_key,
                no_auth=no_auth,
                test_prompt=str(raw.get("test_prompt", "Reply with OK only.")),
                timeout_seconds=float(raw.get("timeout_seconds", 30)),
                degraded_threshold_ms=_model_degraded_threshold_ms(raw),
                enabled=bool(raw.get("enabled", True)),
                mock=bool(raw.get("mock", False)),
            )
        )

    return Settings(
        database_path=database_path,
        config_path=config_path,
        probe_cron=probe_cron,
        window_days=max(1, window_days),
        public_base_url=public_base_url,
        targets=targets,
    )
