import {
  Activity,
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
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

const SAMPLE_STATUS = {
  summary: {
    overall_status: "operational",
    model_count: 4,
    operational_count: 3,
    degraded_count: 1,
    down_count: 0,
    success_rate: 99.32,
    p95_latency_ms: 1280,
    last_updated_at: new Date().toISOString(),
    interval_seconds: 60,
  },
  models: [
    sampleModel("openai-gpt-4-1", "OpenAI GPT-4.1", "OpenAI", "ap-southeast-1", "operational", 842, 99.78),
    sampleModel("deepseek-chat", "DeepSeek Chat", "DeepSeek", "ap-northeast-1", "operational", 1120, 99.41),
    sampleModel("claude-sonnet", "Claude Sonnet", "Anthropic", "us-east-1", "degraded", 1890, 97.84),
    sampleModel("qwen-max", "Qwen Max", "Alibaba Cloud", "cn-hangzhou", "operational", 1310, 99.23),
  ],
  events: [
    sampleEvent("Claude Sonnet 响应恢复正常", "响应时间已降至阈值以内", "info", -8),
    sampleEvent("Claude Sonnet 响应变慢", "p95 延迟超过 1.5s", "warning", -16),
    sampleEvent("OpenAI GPT-4.1 运行正常", "成功率已恢复到 99% 以上", "info", -34),
    sampleEvent("DeepSeek Chat 计划维护完成", "所有服务已恢复", "notice", -72),
  ],
  probes: [],
};

SAMPLE_STATUS.probes = SAMPLE_STATUS.models.concat(SAMPLE_STATUS.models).slice(0, 6).map((model, index) => ({
  id: index,
  model_name: model.name,
  provider: model.provider,
  region: index % 2 ? "eu-west-1" : model.region,
  status: index === 2 ? "degraded" : "operational",
  latency_ms: index === 2 ? 3210 : model.latency_ms + index * 24,
  checked_at: new Date(Date.now() - index * 13000).toISOString(),
}));

function sampleModel(id, name, provider, region, status, latency, successRate) {
  return {
    id,
    name,
    provider,
    region,
    status,
    latency_ms: latency,
    p95_latency_ms: latency,
    success_rate: successRate,
    last_checked_at: new Date(Date.now() - Math.floor(Math.random() * 42000)).toISOString(),
    history: Array.from({ length: 30 }, (_, index) => ({
      date: `2025-05-${String(index + 1).padStart(2, "0")}`,
      status: index % 17 === 0 ? "degraded" : "operational",
    })),
    mock: true,
  };
}

function sampleEvent(title, description, severity, minutesOffset) {
  return {
    id: `${title}-${minutesOffset}`,
    title,
    description,
    severity,
    created_at: new Date(Date.now() + minutesOffset * 60000).toISOString(),
  };
}

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
  if (model.provider === "OpenAI") return "◎";
  if (model.provider === "DeepSeek") return "DS";
  if (model.provider === "Anthropic") return "AI";
  if (model.provider === "Alibaba Cloud") return "Q";
  return model.name.slice(0, 2).toUpperCase();
}

export function App() {
  const [status, setStatus] = useState(SAMPLE_STATUS);
  const [providerFilter, setProviderFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [grouped, setGrouped] = useState(false);
  const [selectedModel, setSelectedModel] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [apiHealthy, setApiHealthy] = useState(false);

  async function loadStatus() {
    try {
      const response = await fetch("/api/status");
      if (!response.ok) throw new Error("Status API unavailable");
      const payload = await response.json();
      setStatus(payload);
      setApiHealthy(true);
    } catch {
      setApiHealthy(false);
    }
  }

  async function runProbe() {
    setLoading(true);
    try {
      const response = await fetch("/api/probe/run", { method: "POST" });
      if (!response.ok) throw new Error("Probe failed");
      const payload = await response.json();
      setStatus(payload.status);
      setApiHealthy(true);
    } catch {
      setApiHealthy(false);
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
      const searchText = `${model.name} ${model.provider} ${model.region}`.toLowerCase();
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

  const heroTone = STATUS_TONE[status.summary.overall_status] || "good";

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
          <Metric label="成功率（平均）" value={`${status.summary.success_rate}%`} tone="good" />
          <Metric label="平均延迟（p95）" value={formatLatency(status.summary.p95_latency_ms)} />
        </section>

        <section className="top-actions" aria-label="页面操作">
          <span className="last-updated">最后更新：{formatDateTime(status.summary.last_updated_at)}</span>
          <button className="icon-button primary" onClick={runProbe} disabled={loading} title="手动刷新">
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
            <h2>{statusText(status.summary)}</h2>
            <p>
              {apiHealthy
                ? "所有监控的模型与服务均按当前探测配置运行。"
                : "当前展示本地示例数据，后台启动后会自动切换为实时探测结果。"}
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
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索模型或区域"
            />
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
            按分组
          </button>
        </div>
      </section>

      <section className="model-surface">
        <div className="model-grid header-row">
          <span>模型</span>
          <span>状态</span>
          <span>成功率（30天）</span>
          <span>平均延迟（p95）</span>
          <span>最后检测</span>
          <span>30天状态</span>
          <span />
        </div>
        {grouped ? (
          Object.entries(groupedModels).map(([provider, providerModels]) => (
            <div className="provider-block" key={provider}>
              <div className="provider-title">{provider}</div>
              {providerModels.map((model) => (
                <ModelRow
                  key={model.id}
                  model={model}
                  selected={selectedModel === model.id}
                  onSelect={() => setSelectedModel(selectedModel === model.id ? null : model.id)}
                />
              ))}
            </div>
          ))
        ) : (
          models.map((model) => (
            <ModelRow
              key={model.id}
              model={model}
              selected={selectedModel === model.id}
              onSelect={() => setSelectedModel(selectedModel === model.id ? null : model.id)}
            />
          ))
        )}
        {!models.length && (
          <div className="empty-state">
            <Info aria-hidden="true" />
            没有符合当前筛选条件的模型。
          </div>
        )}
      </section>

      <section className="bottom-grid">
        <Panel
          title="最近事件"
          action={<button className="text-action">查看全部</button>}
        >
          <div className="event-list">
            {status.events.map((event) => (
              <article className="event-row" key={event.id}>
                <SeverityIcon severity={event.severity} />
                <div>
                  <h3>{event.title}</h3>
                  <p>{event.description}</p>
                </div>
                <time>{formatDateTime(event.created_at)}</time>
              </article>
            ))}
          </div>
        </Panel>

        <Panel title="探测队列" action={<ChevronDown aria-hidden="true" />}>
          <div className="queue-table">
            <div className="queue-head">
              <span>模型</span>
              <span>探测点</span>
              <span>状态</span>
              <span>响应时间</span>
              <span>时间</span>
              <span />
            </div>
            {status.probes.slice(0, 6).map((probe) => (
              <div className="queue-row" key={`${probe.id}-${probe.checked_at}`}>
                <span className="queue-model">{probe.model_name}</span>
                <span>{probe.region}</span>
                <Badge status={probe.status} />
                <span>{formatLatency(probe.latency_ms)}</span>
                <span>{formatClock(probe.checked_at)}</span>
                <ResultIcon status={probe.status} />
              </div>
            ))}
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

function ModelRow({ model, selected, onSelect }) {
  const tone = STATUS_TONE[model.status] || "muted";
  return (
    <>
      <button className={`model-grid model-row ${selected ? "selected" : ""}`} onClick={onSelect}>
        <span className="model-identity">
          <span className={`model-logo ${model.provider.toLowerCase().split(" ")[0]}`}>
            {modelMark(model)}
          </span>
          <span>
            <strong>{model.name}</strong>
            <small>{model.provider}</small>
          </span>
        </span>
        <span className={`status-label ${tone}`}>
          <span className={`status-dot ${tone}`} />
          {STATUS_LABEL[model.status] || "等待检测"}
        </span>
        <span className={`rate ${tone}`}>{model.success_rate.toFixed(2)}%</span>
        <span className="latency">{formatLatency(model.p95_latency_ms || model.latency_ms)}</span>
        <span className="last-check">
          <strong>{formatClock(model.last_checked_at)}</strong>
          <small>{relativeTime(model.last_checked_at)}</small>
        </span>
        <span className="history-bars" aria-label={`${model.name} 30天状态`}>
          {model.history.slice(-30).map((item) => (
            <i key={item.date} className={STATUS_TONE[item.status] || "muted"} title={`${item.date} ${STATUS_LABEL[item.status]}`} />
          ))}
        </span>
        <ChevronRight aria-hidden="true" className={selected ? "rotated" : ""} />
      </button>
      {selected && (
        <div className="model-detail">
          <div>
            <span>模型 ID</span>
            <strong>{model.model}</strong>
          </div>
          <div>
            <span>探测区域</span>
            <strong>{model.region}</strong>
          </div>
          <div>
            <span>当前模式</span>
            <strong>{model.mock ? "模拟探测" : "真实接口"}</strong>
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
  return <span className={`badge ${tone}`}>{status === "degraded" ? "超时" : status === "down" ? "失败" : "成功"}</span>;
}

function ResultIcon({ status }) {
  if (status === "down") return <X aria-hidden="true" className="result-icon bad" />;
  if (status === "degraded") return <AlertTriangle aria-hidden="true" className="result-icon slow" />;
  return <Check aria-hidden="true" className="result-icon good" />;
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
            <p>当前周期：{status.summary.interval_seconds} 秒，接口状态：{apiHealthy ? "已连接" : "示例数据"}</p>
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
                <p>{model.region} · {model.mock ? "模拟探测" : "真实接口"}</p>
              </div>
              <Badge status={model.status} />
            </article>
          ))}
        </div>
        <footer>
          <button className="secondary-button" onClick={onClose}>关闭</button>
          <button className="primary-button" onClick={onProbe}>
            <Clock3 aria-hidden="true" />
            立即探测
          </button>
        </footer>
      </div>
    </aside>
  );
}
