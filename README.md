# LLMStatusMonitor

一个小型 LLM 接口状态监控站点。后台用 Python 定时探测多个模型接口，前端展示整体健康、模型成功率、延迟、30 天状态条、最近事件和探测队列。

## 本地启动

```bash
docker compose up --build
```

打开 `http://localhost:3000`。

## 国内镜像

项目尽量使用国内镜像下载依赖：

- 前端 npm：`https://registry.npmmirror.com/`
- 后端 pip：`https://pypi.tuna.tsinghua.edu.cn/simple`

Docker 基础镜像仍由 Docker daemon 拉取。若拉取 `python`、`node`、`nginx` 基础镜像较慢，建议在 Docker Desktop 或 daemon 配置里添加国内 registry mirror。

## 配置模型

默认公开示例配置在 `config/models.example.json`，使用 `mock: true`，方便开箱运行。

真实本地配置可放在 `config/models.local.json`。该文件已被 `.gitignore` 忽略，不会上传到公共仓库。后台本地运行时会优先读取它；Docker 本地部署可通过被忽略的 `docker-compose.override.yml` 挂载它。

后台默认每 60 秒探测一次，可通过 `PROBE_INTERVAL_SECONDS` 调整。
