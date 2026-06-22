# AGENTS.md

## 项目概况

LLMStatusMonitor — 全栈 LLM API 状态监控面板。后端（Python FastAPI）定时探测 LLM 接口，结果存入 SQLite。前端（React 19 + Vite 6，纯 JSX）按模型卡片展示可用性、延迟和近期错误。

## 构建 / 运行 / 测试命令

### Docker 本地启动
```
docker compose up --build
```
打开 http://localhost:3000。

### 后端（Python）
```bash
cd backend
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

### 前端（JSX）
```bash
cd frontend
npm install   # 使用 npmmirror 镜像
npm run dev   # vite 开发服务器 127.0.0.1:5173，代理 /api -> :8000
npm run build # 生产构建到 dist/
```

### 测试
**尚无测试基础设施。** 代码库中没有任何测试文件。编写测试前请询问用户偏好的框架（Python 用 pytest，前端用 vitest）。

### Docker 服务
- `backend`：Python 3.12-slim，FastAPI + uvicorn，端口 :8000
- `frontend`：node:22-alpine 构建 → nginx:1.27-alpine 提供静态文件，端口 :80

## 代码风格指南

### 前端（JSX）

**导入顺序**：第三方库优先（lucide-react、react），然后是本地相对路径导入。使用显式 `.jsx` 扩展名。
```jsx
import { Activity, CheckCircle2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { App } from "./App.jsx";
```

**格式化**：无 ESLint/Prettier 配置。遵循现有风格：2 空格缩进，简单元素 JSX 写在一行。

**组件**：用普通函数（非箭头函数），PascalCase 命名，解构 props，具名导出（`export function Foo()`）。组件体积增大前可放在同一文件。
```jsx
function Metric({ label, value, tone = "neutral" }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong className={tone}>{value}</strong>
    </div>
  );
}
```

**命名**：变量/函数/hooks 用 `camelCase`，组件用 `PascalCase`，常量/映射用 `UPPER_SNAKE_CASE`，CSS 类用 `kebab-case`。

**状态与副作用**：使用 React 的 `useState`、`useEffect`、`useMemo`。避免外部状态库。在 `useEffect` 中 fetch 并清理。通过 `setInterval` + `clearInterval` 轮询。

**错误处理**：所有 fetch 调用使用 try/catch/finally。使用 `error instanceof Error` 判断。错误状态存入 React state。用户提示用中文。

**样式**：单文件 `styles.css`，基于 class 选择器，响应式（3 个断点）。不使用 CSS modules、Tailwind 或 CSS-in-JS。图标用 `lucide-react`。

**无障碍**：交互元素加 `aria-label`、`aria-hidden`、`aria-modal`。使用语义化 HTML（`<main>`、`<section>`、`<header>`、`<article>`、`<aside>`、`<time>`）。

### 后端（Python）

**导入顺序**：标准库 → 第三方 → 本地（`.module`）。每组之间空一行。文件顶部始终加 `from __future__ import annotations`。
```python
from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
from datetime import UTC, datetime

from fastapi import FastAPI

from .config import Settings, load_settings
```

**类型注解**：全程使用标准库类型提示。不使用第三方类型库。使用 `| None` 语法（Python 3.10+，由 `from __future__ import annotations` 启用）。

**命名**：文件/函数/变量用 `snake_case`，类用 `PascalCase`，常量/模块级默认值用 `UPPER_SNAKE_CASE`，私有函数加 `_` 前缀。

**错误处理**：探测函数不传播异常——捕获后以 dict 形式返回错误详情。配置校验抛 `ValueError`。使用 `asyncio.Lock` 防止并发探测。资源清理用 `try/finally` 的上下文管理器。

**异步**：FastAPI 使用 async 路由。`asyncio.gather` 并发探测。`asyncio.create_task` 启动后台调度器。`@asynccontextmanager` 管理生命周期。

**SQLite**：使用 `sqlite3.Row` 作为行工厂。连接生命周期使用上下文管理器模式。SQL 查询使用参数化（绝对不用 f-string 拼接 SQL）。时间戳存为 ISO 8601 字符串。

**配置**：Settings 用 `frozen=True` 的 dataclass。模型配置用 JSON 文件。API 密钥从环境变量读取。`mock: true` 用于演示模型。

### 通用

**依赖**：最小化外部依赖。前端：react、react-dom、vite、@vitejs/plugin-react、lucide-react。后端：fastapi、httpx、uvicorn。

**禁止使用 TypeScript。** 项目中任何地方都未使用 TypeScript，不要引入。

**环境**：Python 3.12、Node 22、Docker Compose。npm 使用 `npmmirror.com`，pip 使用 `pypi.tuna.tsinghua.edu.cn`。

**既有原型指令**（来自 `frontend/AGENTS.md`）：自行启动本地服务器并预览。在重大视觉改动前，若视觉来源不清晰，使用 Product Design 插件的 `get-context` skill。当选中某个生成的 mock 时，将该图片视为布局/结构/间距/颜色的唯一真实来源。