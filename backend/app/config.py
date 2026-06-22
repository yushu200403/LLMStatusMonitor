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
    region: str
    api_key_env: str
    api_key: str | None
    no_auth: bool
    test_prompt: str
    timeout_seconds: float
    enabled: bool
    mock: bool


@dataclass(frozen=True)
class Settings:
    database_path: Path
    interval_seconds: int
    window_days: int
    targets: list[ModelTarget]


DEFAULT_TARGETS: list[dict[str, Any]] = [
    {
        "id": "openai-gpt-4-1",
        "name": "OpenAI GPT-4.1",
        "provider": "OpenAI",
        "model": "gpt-4.1",
        "endpoint": "https://api.openai.com/v1/chat/completions",
        "region": "ap-southeast-1",
        "api_key_env": "OPENAI_API_KEY",
        "mock": True,
    },
    {
        "id": "deepseek-chat",
        "name": "DeepSeek Chat",
        "provider": "DeepSeek",
        "model": "deepseek-chat",
        "endpoint": "https://api.deepseek.com/chat/completions",
        "region": "ap-northeast-1",
        "api_key_env": "DEEPSEEK_API_KEY",
        "mock": True,
    },
    {
        "id": "claude-sonnet",
        "name": "Claude Sonnet",
        "provider": "Anthropic",
        "model": "claude-3-5-sonnet-latest",
        "endpoint": "https://api.anthropic.com/v1/messages",
        "region": "us-east-1",
        "api_key_env": "ANTHROPIC_API_KEY",
        "mock": True,
    },
    {
        "id": "qwen-max",
        "name": "Qwen Max",
        "provider": "Alibaba Cloud",
        "model": "qwen-max",
        "endpoint": "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
        "region": "cn-hangzhou",
        "api_key_env": "DASHSCOPE_API_KEY",
        "mock": True,
    },
]


def _read_targets(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return DEFAULT_TARGETS
    with path.open("r", encoding="utf-8") as handle:
        payload = json.load(handle)
    if isinstance(payload, dict):
        return payload.get("models", DEFAULT_TARGETS)
    if isinstance(payload, list):
        return payload
    raise ValueError("Model config must be a list or an object with a 'models' array.")


def load_settings() -> Settings:
    local_private_config = Path.cwd() / "config" / "models.local.json"
    local_example_config = Path.cwd() / "config" / "models.example.json"
    local_config = local_private_config if local_private_config.exists() else local_example_config
    config_path = Path(os.getenv("MODEL_CONFIG_PATH", str(local_config if local_config.exists() else "/app/config/models.json")))
    local_data = Path.cwd() / "status.db"
    database_path = Path(os.getenv("DATABASE_PATH", str(local_data if local_config.exists() else "/app/data/status.db")))
    interval_seconds = int(os.getenv("PROBE_INTERVAL_SECONDS", "60"))
    window_days = int(os.getenv("STATUS_WINDOW_DAYS", "30"))

    targets: list[ModelTarget] = []
    for raw in _read_targets(config_path):
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
                region=str(raw.get("region", "global")),
                api_key_env=api_key_env,
                api_key=api_key,
                no_auth=no_auth,
                test_prompt=str(raw.get("test_prompt", "Reply with OK only.")),
                timeout_seconds=float(raw.get("timeout_seconds", 20)),
                enabled=bool(raw.get("enabled", True)),
                mock=bool(raw.get("mock", False)),
            )
        )

    return Settings(
        database_path=database_path,
        interval_seconds=max(15, interval_seconds),
        window_days=max(7, window_days),
        targets=targets,
    )
