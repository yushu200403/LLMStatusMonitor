# LLMStatusMonitor

一个小型 LLM 接口状态监控站点。后台用 Python 定时探测多个模型接口，前端用状态卡片和表格展示整体健康、模型成功率、延迟、30 天状态条、最近事件和探测队列。

## 本地启动

```bash
docker compose up --build
```

打开 `http://localhost:3000`。

## 配置模型

默认配置在 `config/models.example.json`。为了开箱可运行，示例模型使用 `mock: true`。接入真实接口时：

1. 复制或编辑 `config/models.example.json`。
2. 将对应模型的 `mock` 改为 `false`。
3. 设置对应环境变量，例如 `OPENAI_API_KEY`、`DEEPSEEK_API_KEY`。
4. 重启服务。

后台默认每 60 秒探测一次，可通过 `PROBE_INTERVAL_SECONDS` 调整。
