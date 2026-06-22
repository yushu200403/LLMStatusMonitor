import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock3,
  Filter,
  Info,
  RefreshCcw,
  Search,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

const STATUS_LABEL = {
  operational: "运行正常",
  degraded: "响应变慢",
  down: "接口异常",
  unknown: "等待检测",
};

const STATUS_TONE = {
  operational: "good",
  degraded: "slow",
  down: "bad",
  unknown: "muted",
};

const EMPTY_STATUS = {
  summary: {
    overall_status: "unknown",
    model_count: 0,
    operational_count: 0,
    degraded_count: 0,
    down_count: 0,
    success_rate: 0,
    p95_latency_ms: null,
    last_updated_at: null,
    probe_cron: "*/10 * * * *",
    window_days: 7,
    public_base_url: "",
    config_name: "",
    has_mock_models: false,
  },
  models: [],
  events: [],
  errors: [],
  probes: [],
};

function formatDateTime(value) {
  if (!value) return "尚未检测";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

function formatClock(value) {
  if (!value) return "--:--:--";
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

function relativeTime(value) {
  if (!value) return "";
  const seconds = Math.max(1, Math.round((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return `${seconds} 秒前`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  return `${Math.round(hours / 24)} 天前`;
}

function formatLatency(ms) {
  if (ms === null || ms === undefined) return "--";
  if (ms >= 1000) return `${(ms / 1000).toFixed(ms >= 2000 ? 1 : 2)} s`;
  return `${ms} ms`;
}

function statusText(summary) {
  if (summary.overall_status === "down") return "部分模型接口异常";
  if (summary.overall_status === "degraded") return "部分模型响应变慢";
  if (summary.overall_status === "unknown") return "等待首次检测";
  return "全部系统运行正常";
}

function modelMark(model) {
  if (model.provider === "SenseNova") return "SN";
  if (model.provider === "RinkoAI") return "RA";
  if (model.provider === "MuYuan") return "MY";
  if (model.provider === "NVIDIA") return "NV";
  if (model.provider === "SiliconFlow") return "SF";
  if (model.provider === "Local") return "LC";
  if (model.provider === "OpenAI") return "AI";
  if (model.provider === "DeepSeek") return "DS";
  if (model.provider === "Anthropic") return "AN";
  return model.name.slice(0, 2).toUpperCase();
}

export function App() {
  const [status, setStatus] = useState(EMPTY_STATUS);
  const [providerFilter, setProviderFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [grouped, setGrouped] = useState(false);
  const [selectedModel, setSelectedModel] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [apiHealthy, setApiHealthy] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  async function loadStatus() {
    try {
      const response = await fetch("/api/status", { cache: "no-store" });
      if (!response.ok) throw new Error("状态接口不可用");
      const payload = await response.json();
      setStatus({ ...EMPTY_STATUS, ...payload });
      setApiHealthy(true);
      setErrorMessage("");
    } catch (error) {
      setApiHealthy(false);
      setErrorMessage(error instanceof Error ? error.message : "无法连接后端状态接口");
    } finally {
      setLoading(false);
    }
  }

  async function runProbe() {
    setLoading(true);
    try {
      const response = await fetch("/api/probe/run", { method: "POST" });
      if (!response.ok) throw new Error("手动检测失败");
      const payload = await response.json();
      setStatus({ ...EMPTY_STATUS, ...payload.status });
      setApiHealthy(true);
      setErrorMessage("");
    } catch (error) {
      setApiHealthy(false);
      setErrorMessage(error instanceof Error ? error.message : "手动检测失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadStatus();
    const timer = window.setInterval(loadStatus, 20000);
    return () => window.clearInterval(timer);
  }, []);

  const providers = useMemo(
    () => ["all", ...Array.from(new Set(status.models.map((model) => model.provider)))],
    [status.models],
  );

  const models = useMemo(() => {
    return status.models.filter((model) => {
      const matchesProvider = providerFilter === "all" || model.provider === providerFilter;
      const matchesStatus = statusFilter === "all" || model.status === statusFilter;
      const searchText = `${model.name} ${model.provider} ${model.model}`.toLowerCase();
      return matchesProvider && matchesStatus && searchText.includes(query.toLowerCase());
    });
  }, [providerFilter, query, status.models, statusFilter]);

  const groupedModels = useMemo(() => {
    return models.reduce((groups, model) => {
      groups[model.provider] = groups[model.provider] || [];
      groups[model.provider].push(model);
      return groups;
    }, {});
  }, [models]);

  const heroTone = STATUS_TONE[status.summary.overall_status] || "muted";
  const windowDays = status.summary.window_days || 7;

  return (
    <main className="app-shell">
      <header className="topbar">
        <section className="brand-cluster" aria-label="站点状态">
          <div className="brand-icon">
            <Activity aria-hidden="true" />
          </div>
          <div>
            <h1>LLM Status Monitor</h1>
            <div className="inline-status">
              <span className={`status-dot ${heroTone}`} />
              <span>{statusText(status.summary)}</span>
            </div>
          </div>
        </section>

        <section className="summary-strip" aria-label="核心指标">
          <Metric label="模型总数" value={status.summary.model_count} tone="blue" />
          <Metric label="运行正常" value={status.summary.operational_count} tone="good" />
          <Metric label="响应变慢" value={status.summary.degraded_count} tone="slow" />
          <Metric label="接口异常" value={status.summary.down_count} tone="bad" />
          <Metric label={`成功率(${windowDays}天)`} value={`${status.summary.success_rate}%`} tone="good" />
          <Metric label="平均延迟(p95)" value={formatLatency(status.summary.p95_latency_ms)} />
        </section>

        <section className="top-actions" aria-label="页面操作">
          <span className="last-updated">最后更新：{formatDateTime(status.summary.last_updated_at)}</span>
          <button className="icon-button primary" onClick={runProbe} disabled={loading} title="立即检测">
            <RefreshCcw aria-hidden="true" className={loading ? "spinning" : ""} />
          </button>
          <button className="icon-button" onClick={() => setSettingsOpen(true)} title="检测配置">
            <Settings aria-hidden="true" />
          </button>
        </section>
      </header>

      <section className={`health-banner ${heroTone}`}>
        <div className="health-copy">
          <div className="health-icon">
            {status.summary.overall_status === "down" ? <AlertTriangle /> : <ShieldCheck />}
          </div>
          <div>
            <h2>{apiHealthy ? statusText(status.summary) : "等待真实状态数据"}</h2>
            <p>
              {apiHealthy
                ? status.summary.has_mock_models
                  ? `当前配置 ${status.summary.config_name || "未知"} 仍包含 Mock 模型，请确认远端覆盖文件。`
                  : `真实配置已加载，按 ${status.summary.probe_cron} 检测，展示最近 ${windowDays} 天状态。`
                : loading
                  ? "正在从后端读取真实检测结果。"
                  : `后端状态接口不可用：${errorMessage}`}
            </p>
          </div>
        </div>
        <div className="sparkline" aria-hidden="true">
          <span />
          <span />
          <span />
          <span />
          <span />
          <span />
          <span />
        </div>
      </section>

      <section className="section-heading">
        <h2>模型状态</h2>
        <div className="toolbar">
          <label className="searchbox">
            <Search aria-hidden="true" />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索模型或提供商" />
          </label>
          <Select value={providerFilter} onChange={setProviderFilter} label="提供商">
            {providers.map((provider) => (
              <option key={provider} value={provider}>
                {provider === "all" ? "全部提供商" : provider}
              </option>
            ))}
          </Select>
          <Select value={statusFilter} onChange={setStatusFilter} label="状态">
            <option value="all">全部状态</option>
            <option value="operational">运行正常</option>
            <option value="degraded">响应变慢</option>
            <option value="down">接口异常</option>
          </Select>
          <button className={`group-button ${grouped ? "active" : ""}`} onClick={() => setGrouped(!grouped)}>
            <Filter aria-hidden="true" />
            按提供商分组
          </button>
        </div>
      </section>

      <section className="model-surface">
        <div className="model-grid header-row">
          <span>模型</span>
          <span>状态</span>
          <span>{windowDays}天成功率</span>
          <span>平均延迟(p95)</span>
          <span>最后检测</span>
          <span>{windowDays}天状态</span>
          <span />
        </div>
        {grouped
          ? Object.entries(groupedModels).map(([provider, providerModels]) => (
              <div className="provider-block" key={provider}>
                <div className="provider-title">{provider}</div>
                {providerModels.map((model) => (
                  <ModelRow
                    key={model.id}
                    model={model}
                    selected={selectedModel === model.id}
                    windowDays={windowDays}
                    onSelect={() => setSelectedModel(selectedModel === model.id ? null : model.id)}
                  />
                ))}
              </div>
            ))
          : models.map((model) => (
              <ModelRow
                key={model.id}
                model={model}
                selected={selectedModel === model.id}
                windowDays={windowDays}
                onSelect={() => setSelectedModel(selectedModel === model.id ? null : model.id)}
              />
            ))}
        {!models.length && (
          <div className="empty-state">
            <Info aria-hidden="true" />
            {loading ? "正在加载真实模型状态。" : "没有可展示的真实模型数据。"}
          </div>
        )}
      </section>

      <section className="bottom-grid">
        <Panel title="最近事件" action={<span className="panel-caption">状态变化</span>}>
          <div className="event-list">
            {status.events.length ? (
              status.events.map((event) => (
                <article className="event-row" key={event.id}>
                  <SeverityIcon severity={event.severity} />
                  <div>
                    <h3>{event.title}</h3>
                    <p>{event.description}</p>
                  </div>
                  <time>{formatDateTime(event.created_at)}</time>
                </article>
              ))
            ) : (
              <div className="empty-state compact">暂无事件。</div>
            )}
          </div>
        </Panel>

        <Panel title="最近5次错误" action={<span className="panel-caption">含错误码</span>}>
          <div className="queue-table">
            <div className="queue-head error-head">
              <span>模型</span>
              <span>状态</span>
              <span>错误码</span>
              <span>响应时间</span>
              <span>时间</span>
            </div>
            {status.errors.length ? (
              status.errors.slice(0, 5).map((record) => (
                <div className="queue-row error-row" key={`${record.id}-${record.checked_at}`}>
                  <span className="queue-model">{record.model_name}</span>
                  <Badge status={record.status} />
                  <span>{record.http_status ?? "无"}</span>
                  <span>{formatLatency(record.latency_ms)}</span>
                  <span>{formatClock(record.checked_at)}</span>
                  <p className="error-message">{record.error || "无错误详情"}</p>
                </div>
              ))
            ) : (
              <div className="empty-state compact">最近没有错误记录。</div>
            )}
          </div>
        </Panel>
      </section>

      {settingsOpen && (
        <ConfigDrawer
          status={status}
          apiHealthy={apiHealthy}
          onClose={() => setSettingsOpen(false)}
          onProbe={runProbe}
        />
      )}
    </main>
  );
}

function Metric({ label, value, tone = "neutral" }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong className={tone}>{value}</strong>
    </div>
  );
}

function Select({ value, onChange, label, children }) {
  return (
    <label className="select-control">
      <span className="sr-only">{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {children}
      </select>
      <ChevronDown aria-hidden="true" />
    </label>
  );
}

function ModelRow({ model, selected, windowDays, onSelect }) {
  const tone = STATUS_TONE[model.status] || "muted";
  return (
    <>
      <button className={`model-grid model-row ${selected ? "selected" : ""}`} onClick={onSelect}>
        <span className="model-identity">
          <span className={`model-logo ${model.provider.toLowerCase().split(" ")[0]}`}>{modelMark(model)}</span>
          <span>
            <strong>{model.name}</strong>
            <small>{model.provider}</small>
          </span>
        </span>
        <span className={`status-label ${tone}`}>
          <span className={`status-dot ${tone}`} />
          {STATUS_LABEL[model.status] || "等待检测"}
        </span>
        <span className={`rate ${tone}`}>{Number(model.success_rate || 0).toFixed(2)}%</span>
        <span className="latency">{formatLatency(model.p95_latency_ms || model.latency_ms)}</span>
        <span className="last-check">
          <strong>{formatClock(model.last_checked_at)}</strong>
          <small>{relativeTime(model.last_checked_at)}</small>
        </span>
        <span className="history-bars" aria-label={`${model.name} ${windowDays}天状态`}>
          {(model.history || []).slice(-windowDays).map((item) => (
            <i key={item.date} className={STATUS_TONE[item.status] || "muted"} title={`${item.date} ${STATUS_LABEL[item.status]}`} />
          ))}
        </span>
        <ChevronRight aria-hidden="true" className={selected ? "rotated" : ""} />
      </button>
      {selected && (
        <div className="model-detail compact-detail">
          <div>
            <span>模型 ID</span>
            <strong>{model.model}</strong>
          </div>
          <div>
            <span>端点</span>
            <strong>{model.endpoint}</strong>
          </div>
          <div>
            <span>慢响应阈值</span>
            <strong>{formatLatency(model.degraded_threshold_ms)}</strong>
          </div>
          <div>
            <span>最近错误</span>
            <strong>{model.error || "无"}</strong>
          </div>
        </div>
      )}
    </>
  );
}

function Badge({ status }) {
  const tone = STATUS_TONE[status] || "muted";
  return <span className={`badge ${tone}`}>{status === "degraded" ? "变慢" : status === "down" ? "失败" : "正常"}</span>;
}

function SeverityIcon({ severity }) {
  if (severity === "warning") return <AlertTriangle aria-hidden="true" className="event-icon warning" />;
  if (severity === "critical") return <AlertTriangle aria-hidden="true" className="event-icon critical" />;
  if (severity === "notice") return <Info aria-hidden="true" className="event-icon notice" />;
  return <CheckCircle2 aria-hidden="true" className="event-icon info" />;
}

function Panel({ title, action, children }) {
  return (
    <section className="panel">
      <header>
        <h2>{title}</h2>
        {action}
      </header>
      {children}
    </section>
  );
}

function ConfigDrawer({ status, apiHealthy, onClose, onProbe }) {
  return (
    <aside className="drawer-backdrop" role="dialog" aria-modal="true" aria-labelledby="config-title">
      <div className="drawer">
        <header>
          <div>
            <h2 id="config-title">检测配置</h2>
            <p>
              Cron：{status.summary.probe_cron} · 窗口：{status.summary.window_days} 天 · 接口：
              {apiHealthy ? "已连接" : "不可用"}
            </p>
          </div>
          <button className="icon-button" onClick={onClose} title="关闭">
            <X aria-hidden="true" />
          </button>
        </header>
        <div className="drawer-content">
          {status.models.map((model) => (
            <article className="config-card" key={model.id}>
              <div className="config-icon">
                <SlidersHorizontal aria-hidden="true" />
              </div>
              <div>
                <h3>{model.name}</h3>
                <p>
                  慢响应 {formatLatency(model.degraded_threshold_ms)} · 超时 {model.timeout_seconds}s
                </p>
              </div>
              <Badge status={model.status} />
            </article>
          ))}
        </div>
        <footer>
          <button className="secondary-button" onClick={onClose}>
            关闭
          </button>
          <button className="primary-button" onClick={onProbe}>
            <Clock3 aria-hidden="true" />
            立即检测
          </button>
        </footer>
      </div>
    </aside>
  );
}
