# LLMStatusMonitor

一个用于定时探测多个 LLM 接口状态的小型网站。后端使用 Python 定时请求各模型接口，前端按模型卡片展示 7 天内可用性、延迟、最近事件和最近 5 次错误记录。

## 本地启动

```bash
docker compose up --build
```

打开 `http://localhost:3000`。服务器部署时可通过 `PUBLIC_BASE_URL` 指定公开访问地址，当前默认值为 `http://111.228.11.160/`。

## 国内镜像

项目尽量使用国内镜像下载依赖：

- 前端 npm：`https://registry.npmmirror.com/`
- 后端 pip：`https://pypi.tuna.tsinghua.edu.cn/simple`

Docker 基础镜像仍由 Docker daemon 拉取。若拉取 `python`、`node`、`nginx` 基础镜像较慢，建议在 Docker Desktop 或 daemon 配置中添加国内 registry mirror。

## 模型配置

公共示例配置位于 `config/models.example.json`，默认使用 `mock: true`，仅用于开箱演示。

真实配置请放在 `config/models.local.json`，该文件已被 `.gitignore` 忽略，不会上传到公共仓库。使用 Docker 部署时，可以通过同样被忽略的 `docker-compose.override.yml` 将它挂载到 `/app/config/models.json`。

配置项要点：

- `probe_cron`：全局探测频率，使用 5 段 cron 表达式，默认 `*/10 * * * *`。
- `window_days`：前端和统计接口展示窗口，默认 `7`。
- `public_base_url`：公开访问地址，默认 `http://111.228.11.160/`。
- `timeout_seconds`：单个模型的超时阈值。
- `degraded_threshold_ms`：单个模型的变慢阈值，默认 `5000`，超过后标记为响应变慢。

示例：

```json
{
  "probe_cron": "*/10 * * * *",
  "window_days": 7,
  "public_base_url": "http://111.228.11.160/",
  "models": [
    {
      "id": "provider-model-id",
      "name": "Provider Model",
      "provider": "Provider",
      "model": "model-id",
      "endpoint": "https://example.com/v1",
      "api_key_env": "PROVIDER_API_KEY",
      "timeout_seconds": 30,
      "degraded_threshold_ms": 5000,
      "mock": false,
      "enabled": true
    }
  ]
}
```

如果接口不需要鉴权，可设置 `no_auth: true` 或将 `api_key` 写为 `NA`。
