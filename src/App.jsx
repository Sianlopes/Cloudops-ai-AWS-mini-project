import React, { useEffect, useRef, useState } from "react";
import {
  Activity,
  ArrowDown,
  ArrowRight,
  ArrowUpRight,
  Bell,
  BookOpen,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  Clock,
  Cloud,
  Download,
  ExternalLink,
  FileText,
  Filter,
  LayoutDashboard,
  LoaderCircle,
  Menu,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Search,
  Server,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Terminal,
  TriangleAlert,
  X,
  Zap,
} from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import AuthScreen from "./AuthScreen.jsx";
let csrfToken = "";

const navigation = [
  ["Overview", LayoutDashboard],
  ["Services", Server],
  ["Incidents", TriangleAlert],
  ["Metrics", Activity],
  ["Logs", Terminal],
  ["Monitoring rules", SlidersHorizontal],
];
const date = (value) =>
  new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
const since = (value) => {
  const minutes = Math.max(
    0,
    Math.floor((Date.now() - new Date(value)) / 60000),
  );
  return minutes < 1
    ? "Just now"
    : minutes < 60
      ? `${minutes}m ago`
      : minutes < 1440
        ? `${Math.floor(minutes / 60)}h ago`
        : `${Math.floor(minutes / 1440)}d ago`;
};
const statusText = {
  healthy: "Healthy",
  degraded: "Degraded",
  unhealthy: "Unhealthy",
  pending: "Pending",
  open: "Open",
  acknowledged: "Acknowledged",
  resolved: "Resolved",
  critical: "Critical",
  high: "High",
  warning: "Warning",
};
function Badge({ value }) {
  return (
    <span className={`badge ${value}`}>
      <i />
      {statusText[value] || value}
    </span>
  );
}
function Empty({ title, detail }) {
  return (
    <div className="empty">
      <CheckCheck size={28} />
      <h3>{title}</h3>
      <p>{detail}</p>
    </div>
  );
}
function Modal({ title, description, onClose, children }) {
  const ref = useRef(null);
  useEffect(() => {
    const previous = document.activeElement;
    ref.current?.focus();
    const handler = (e) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Tab") {
        const els = ref.current.querySelectorAll(
          "button,input,select,textarea,a[href]",
        );
        const first = els[0],
          last = els[els.length - 1];
        if (
          e.shiftKey &&
          (document.activeElement === first ||
            document.activeElement === ref.current)
        ) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", handler);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handler);
      document.body.style.overflow = "";
      previous?.focus();
    };
  }, []);
  return (
    <div
      className="modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <section
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        tabIndex={-1}
        ref={ref}
      >
        <div className="modal-heading">
          <div>
            <h2 id="modal-title">{title}</h2>
            {description && <p>{description}</p>}
          </div>
          <button
            className="icon-button"
            aria-label="Close dialog"
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}
async function api(path, options) {
  const res = await fetch(
    `/api/${path}`,
    options
      ? {
          method: options.method || "POST",
          headers: {
            "Content-Type": "application/json",
            "X-CSRF-Token": csrfToken,
          },
          body: JSON.stringify(options.body),
        }
      : undefined,
  );
  const body = await res.json();
  if (!res.ok) {
    const error = Error(body.error || "Request failed");
    error.status = res.status;
    throw error;
  }
  return body;
}
function exportCsv(name, rows) {
  if (!rows.length) return;
  const keys = Object.keys(rows[0]);
  const escape = (v) =>
    `"${(/^[=+@\-\t\r]/.test(String(v ?? "")) ? "'" + String(v ?? "") : String(v ?? "")).replaceAll('"', '""')}"`;
  const csv = [
    keys.map(escape).join(","),
    ...rows.map((r) => keys.map((k) => escape(r[k])).join(",")),
  ].join("\r\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(
    new Blob([csv], { type: "text/csv;charset=utf-8;" }),
  );
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
export default function App() {
  const [data, setData] = useState(null),
    [page, setPage] = useState("Overview"),
    [error, setError] = useState(""),
    [query, setQuery] = useState(""),
    [range, setRange] = useState("24h"),
    [modal, setModal] = useState(null),
    [toast, setToast] = useState(""),
    [busy, setBusy] = useState(false),
    [mobile, setMobile] = useState(false),
    [incidentFilter, setIncidentFilter] = useState("active"),
    [logLevel, setLogLevel] = useState("all");
  const timer = useRef();
  const [auth, setAuth] = useState(undefined),
    [token, setToken] = useState("");
  async function load() {
    try {
      const result = await api("workspace");
      setData(result);
      setError("");
    } catch (e) {
      if (e.status === 401) {
        setAuth({ user: null, setupRequired: false });
        setData(null);
      }
      setError(e.message);
    }
  }
  useEffect(() => {
    api("auth/session")
      .then((session) => {
        csrfToken = session.csrfToken || "";
        setAuth(session);
        if (session.user) load();
      })
      .catch((e) => setError(e.message));
    return () => clearTimeout(timer.current);
  }, []);
  useEffect(() => {
    if (!auth?.user) return;
    const poll = setInterval(load, 10000);
    return () => clearInterval(poll);
  }, [auth?.user?.id]);
  function notify(message) {
    setToast(message);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(""), 4500);
  }
  async function act(path, body, method = "POST", close = true) {
    setBusy(true);
    try {
      const result = await api(path, { method, body });
      await load();
      notify(result.message || "Changes saved successfully.");
      if (close) setModal(null);
      return result;
    } catch (e) {
      notify(e.message);
      return null;
    } finally {
      setBusy(false);
    }
  }
  const changePage = (p) => {
    setPage(p);
    setQuery("");
    setMobile(false);
  };
  if (auth && !auth.user)
    return (
      <AuthScreen
        setupRequired={auth.setupRequired}
        api={api}
        onSuccess={(session) => {
          csrfToken = session.csrfToken;
          setAuth(session);
          load();
        }}
      />
    );
  if (!data)
    return (
      <div className="boot">
        <Cloud size={36} />
        <h2>CloudOps AI</h2>
        {error ? (
          <>
            <p>
              Could not connect to the backend. Start the app with npm run dev.
            </p>
            <button className="button" onClick={() => window.location.reload()}>
              Try again
            </button>
          </>
        ) : (
          <p>
            <LoaderCircle className="spin" size={16} /> Loading your operations
            workspace…
          </p>
        )}
      </div>
    );
  const active = data.incidents.filter((i) => i.status !== "resolved"),
    healthy = data.services.filter(
      (s) => s.enabled && s.status === "healthy",
    ).length;
  const serviceName = (id) =>
    data.services.find((s) => s.id === id)?.name || "Unknown service";
  const matches = (text) => text.toLowerCase().includes(query.toLowerCase());
  const services = data.services.filter((s) =>
    matches(`${s.name} ${s.description} ${s.region}`),
  );
  const incidents = data.incidents.filter(
    (i) =>
      matches(`${i.id} ${i.title} ${serviceName(i.serviceId)}`) &&
      (incidentFilter === "all" ||
        (incidentFilter === "active" && i.status !== "resolved") ||
        i.status === incidentFilter),
  );
  const logs = data.logs.filter(
    (l) =>
      matches(`${l.message} ${serviceName(l.serviceId)} ${l.traceId}`) &&
      (logLevel === "all" || l.level === logLevel),
  );
  const chart = data.metrics.filter(
    (m) =>
      new Date(m.timestamp).getTime() >
      Date.now() - (range === "1h" ? 1 : range === "6h" ? 6 : 24) * 3600000,
  );
  const latencies = chart.filter((m) => m.latency !== null);
  const avg = latencies.length
    ? Math.round(
        latencies.reduce((n, m) => n + m.latency, 0) / latencies.length,
      )
    : "—";
  function incidentTable(items, compact = false) {
    return (
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Incident</th>
              <th>Severity</th>
              <th>Status</th>
              {!compact && <th>Service</th>}
              <th>Detected</th>
              <th>
                <span className="sr-only">Details</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {items.map((i) => (
              <tr
                key={i.id}
                onClick={() => setModal({ type: "incident", id: i.id })}
              >
                <td>
                  <button
                    className="table-title"
                    onClick={(e) => {
                      e.stopPropagation();
                      setModal({ type: "incident", id: i.id });
                    }}
                  >
                    {i.title}
                  </button>
                  <span className="table-sub">
                    {i.id}
                    {compact && ` · ${serviceName(i.serviceId)}`}
                  </span>
                </td>
                <td>
                  <Badge value={i.severity} />
                </td>
                <td>
                  <Badge value={i.status} />
                </td>
                {!compact && <td>{serviceName(i.serviceId)}</td>}
                <td className="muted nowrap">{since(i.detectedAt)}</td>
                <td>
                  <ChevronRight size={16} className="muted" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!items.length && (
          <Empty
            title="No incidents to show"
            detail="Incidents matching your filters will appear here."
          />
        )}
      </div>
    );
  }
  function graph(metric = "latency") {
    if (!chart.some((m) => m[metric] !== null))
      return (
        <Empty
          title="Waiting for telemetry"
          detail={
            metric === "cpu"
              ? "Configure an EC2 instance ID or send CPU events."
              : metric === "requests" || metric === "errorRate"
                ? "Send request events using a service ingestion token."
                : "Add a service and let the worker complete its first checks."
          }
        />
      );
    return (
      <div className="chart">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={chart}
            margin={{ top: 14, right: 12, left: -20, bottom: 0 }}
          >
            <defs>
              <linearGradient id={`fill-${metric}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#728a7b" stopOpacity={0.22} />
                <stop offset="100%" stopColor="#728a7b" stopOpacity={0.01} />
              </linearGradient>
            </defs>
            <CartesianGrid
              strokeDasharray="3 5"
              vertical={false}
              stroke="#e9eae7"
            />
            <XAxis
              dataKey="timestamp"
              tickFormatter={(v) =>
                new Date(v).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })
              }
              tick={{ fontSize: 11, fill: "#92968f" }}
              axisLine={false}
              tickLine={false}
              minTickGap={55}
            />
            <YAxis
              tick={{ fontSize: 11, fill: "#92968f" }}
              axisLine={false}
              tickLine={false}
              unit={
                metric === "latency"
                  ? " ms"
                  : metric === "cpu" || metric === "errorRate"
                    ? "%"
                    : ""
              }
            />
            <Tooltip
              labelFormatter={date}
              formatter={(v) => [
                `${v}${metric === "latency" ? " ms" : metric === "cpu" || metric === "errorRate" ? "%" : ""}`,
                metric === "latency"
                  ? "Response time"
                  : metric === "cpu"
                    ? "CPU utilization"
                    : metric === "errorRate"
                      ? "Error rate"
                      : "Requests",
              ]}
              contentStyle={{
                border: "1px solid #e4e6e1",
                borderRadius: 10,
                fontSize: 12,
              }}
            />
            <Area
              type="monotone"
              dataKey={metric}
              stroke="#667f6e"
              fill={`url(#fill-${metric})`}
              strokeWidth={2}
              activeDot={{ r: 4, strokeWidth: 3, stroke: "#fff" }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    );
  }
  return (
    <div className="app-shell">
      {mobile && (
        <div className="sidebar-scrim" onClick={() => setMobile(false)} />
      )}
      <aside className={`sidebar ${mobile ? "mobile-open" : ""}`}>
        <a
          className="brand"
          href="#overview"
          onClick={(e) => {
            e.preventDefault();
            changePage("Overview");
          }}
        >
          <span className="brand-mark">
            <Cloud size={22} />
          </span>
          <span>
            cloudops<span className="ai-label">AI</span>
          </span>
        </a>
        <div className="workspace-label">
          <span className="workspace-avatar">C</span>
          <div>
            <strong>{data.settings.workspace}</strong>
            <span>Live monitoring workspace</span>
          </div>
          <ChevronDown size={14} />
        </div>
        <span className="nav-caption">WORKSPACE</span>
        <nav>
          {navigation.map(([label, Icon]) => (
            <button
              key={label}
              className={`nav-item ${page === label ? "selected" : ""}`}
              onClick={() => changePage(label)}
            >
              <Icon size={18} />
              <span>{label}</span>
              {label === "Incidents" && (
                <span className="nav-count">{active.length}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="setup-card">
            <span className="setup-icon">
              <ShieldCheck size={18} />
            </span>
            <strong>Your operations, in focus.</strong>
            <p>One workspace for a healthier cloud.</p>
            <button onClick={() => setModal({ type: "guide" })}>
              Monitoring guide <ArrowUpRight size={14} />
            </button>
          </div>
          <button
            className={`nav-item ${page === "Settings" ? "selected" : ""}`}
            onClick={() => changePage("Settings")}
          >
            <Settings size={18} />
            Settings
          </button>
          <button
            className="nav-item"
            onClick={() => setModal({ type: "guide" })}
          >
            <BookOpen size={18} />
            Project guide <ArrowUpRight size={13} />
          </button>
          <div className="profile">
            <span className="avatar">AD</span>
            <div>
              <strong>Administrator</strong>
              <span>{data.user.email}</span>
            </div>
            <span className="online-dot" />
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="icon-button mobile-toggle"
              aria-label="Open navigation"
              onClick={() => setMobile(true)}
            >
              <Menu size={20} />
            </button>
            <span>Workspace</span>
            <ChevronRight size={14} />
            <strong>{page}</strong>
          </div>
          <div className="topbar-actions">
            <span className="demo-pill">
              <span />
              Live monitoring
            </span>
            <button
              className="icon-button notification-button"
              aria-label={`View ${active.length} active incidents`}
              onClick={() => {
                changePage("Incidents");
                setIncidentFilter("active");
              }}
            >
              <Bell size={19} />
              {active.length > 0 && <i />}
            </button>
            <button
              className="button"
              onClick={async () => {
                try {
                  await api("auth/logout", { body: {} });
                  csrfToken = "";
                  setAuth({ user: null, setupRequired: false });
                  setData(null);
                } catch (error) {
                  notify(error.message);
                }
              }}
            >
              Sign out
            </button>
          </div>
        </header>
        <main>
          <div className="page-heading">
            <div>
              <div className="eyebrow">YOUR CLOUD, AT A GLANCE</div>
              <h1>{page === "Overview" ? "Operations overview" : page}</h1>
              <p>
                {
                  {
                    Overview:
                      "A clear picture of your services, signals, and incidents.",
                    Services:
                      "Keep every service in sight. Catch issues before they grow.",
                    Incidents:
                      "Investigate, acknowledge, and resolve operational issues.",
                    Metrics:
                      "Understand performance over time with operational signals.",
                    Logs: "Follow the trail. Explore recent events across your services.",
                    "Monitoring rules":
                      "Define what matters. Turn operational signals into action.",
                    Settings:
                      "Manage your workspace and monitoring preferences.",
                  }[page]
                }
              </p>
            </div>
            <div className="heading-actions">
              <button
                className="button"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  await load();
                  setBusy(false);
                  notify("Workspace refreshed.");
                }}
              >
                <RefreshCw size={15} className={busy ? "spin" : ""} />
                <span>Refresh</span>
              </button>
              <button
                className="button primary"
                onClick={() => setModal({ type: "service" })}
              >
                <Plus size={16} /> Add service
              </button>
            </div>
          </div>
          {error && (
            <div className="error-banner" role="alert">
              {error}
            </div>
          )}
          {!data.worker.healthy && (
            <div className="error-banner" role="status">
              <strong>Monitoring worker heartbeat is missing.</strong> Checks
              may be delayed. Start the worker and inspect its logs.{" "}
              {data.worker.lastHeartbeat &&
                `Last heartbeat: ${date(data.worker.lastHeartbeat)}`}
            </div>
          )}
          {page === "Overview" && (
            <>
              <div className="health-banner">
                <span className="health-symbol">
                  <Activity size={20} />
                </span>
                <div>
                  <strong>
                    {!data.services.length
                      ? "Add your first service to begin monitoring"
                      : data.services.every((s) => s.status === "pending")
                        ? "Waiting for first health checks"
                        : data.services.some((s) =>
                              ["degraded", "unhealthy"].includes(s.status),
                            )
                          ? "Some services need your attention"
                          : "Your services are looking healthy"}
                  </strong>
                  <p>
                    {healthy} of {data.services.length} services healthy ·{" "}
                    {active.length} active incidents to review
                  </p>
                </div>
                <button onClick={() => changePage("Services")}>
                  View services <ArrowRight size={16} />
                </button>
              </div>
              <div className="stats-grid">
                <Stat
                  title="Service availability"
                  value={
                    data.services.some((s) => s.uptime != null)
                      ? `${(data.services.filter((s) => s.uptime != null).reduce((n, s) => n + s.uptime, 0) / data.services.filter((s) => s.uptime != null).length).toFixed(2)}%`
                      : "—"
                  }
                  icon={ShieldCheck}
                  note="Observed health checks"
                  trend="Measured telemetry"
                />
                <Stat
                  title="Active incidents"
                  value={String(active.length).padStart(2, "0")}
                  icon={TriangleAlert}
                  note={`${active.filter((i) => i.severity === "high" || i.severity === "critical").length} high priority · ${active.filter((i) => i.severity === "warning").length} warning`}
                  trend="Needs review"
                  warning
                />
                <Stat
                  title="Avg. response time"
                  value={avg}
                  suffix="ms"
                  icon={Activity}
                  note="Selected monitoring window"
                  trend="Measured telemetry"
                />
                <Stat
                  title="Monitored services"
                  value={String(data.services.length).padStart(2, "0")}
                  icon={Server}
                  note={`${healthy} healthy · ${data.services.filter((s) => s.status === "pending").length} pending`}
                  trend="All services"
                />
              </div>
              <div className="overview-middle">
                <section className="panel performance-panel">
                  <div className="panel-heading">
                    <div>
                      <h2>Response time</h2>
                      <p>Average latency across services</p>
                    </div>
                    <div className="segmented" aria-label="Chart time range">
                      {["1h", "6h", "24h"].map((r) => (
                        <button
                          key={r}
                          className={range === r ? "active" : ""}
                          onClick={() => setRange(r)}
                        >
                          {r}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="chart-summary">
                    <strong>
                      {avg}
                      <span>ms</span>
                    </strong>
                    <span className="chart-key">
                      <i />
                      Average response time
                    </span>
                  </div>
                  {graph()}
                </section>
                <section className="panel health-panel">
                  <div className="panel-heading">
                    <div>
                      <h2>Service health</h2>
                      <p>Current status of your services</p>
                    </div>
                    <Server size={18} className="muted" />
                  </div>
                  <div className="health-list">
                    {data.services.slice(0, 6).map((s, i) => (
                      <button
                        className="health-row"
                        key={s.id}
                        onClick={() =>
                          setModal({ type: "serviceDetail", id: s.id })
                        }
                      >
                        <span className={`service-symbol tone-${i % 3}`}>
                          <Server size={15} />
                        </span>
                        <span className="service-name">{s.name}</span>
                        <Badge value={s.status} />
                      </button>
                    ))}
                  </div>
                  <button
                    className="panel-footer-link"
                    onClick={() => changePage("Services")}
                  >
                    View all services <ArrowRight size={15} />
                  </button>
                </section>
              </div>
              <section className="panel incidents-panel">
                <div className="panel-heading">
                  <div className="heading-inline">
                    <h2>Active incidents</h2>
                    <span className="number-tag">{active.length}</span>
                  </div>
                  <button
                    className="text-button"
                    onClick={() => {
                      changePage("Incidents");
                      setIncidentFilter("all");
                    }}
                  >
                    View all incidents <ArrowUpRight size={15} />
                  </button>
                </div>
                {incidentTable(active.slice(0, 4), true)}
              </section>
              <div className="overview-bottom">
                <span>
                  <span className="online-dot" />
                  Live data · refreshes every 10 seconds
                </span>
                <span>
                  Stored in{" "}
                  {data.storage === "postgresql"
                    ? "PostgreSQL"
                    : "SQLite (local)"}{" "}
                  <ShieldCheck size={14} />
                </span>
              </div>
            </>
          )}
          {page === "Services" && (
            <>
              <Toolbar
                query={query}
                setQuery={setQuery}
                placeholder="Search services…"
              >
                <span className="muted">{services.length} services</span>
              </Toolbar>
              <div className="services-grid">
                {services.map((s, i) => (
                  <section className="panel service-card" key={s.id}>
                    <div className="service-card-top">
                      <span className={`service-symbol large tone-${i % 3}`}>
                        <Server size={21} />
                      </span>
                      <Badge value={s.status} />
                    </div>
                    <h2>{s.name}</h2>
                    <p>{s.description || "Custom monitored service"}</p>
                    <div className="endpoint">
                      <Cloud size={13} />
                      <span>{s.endpoint}</span>
                    </div>
                    <div className="service-numbers">
                      <div>
                        <span>Response time</span>
                        <strong>
                          {s.latency == null ? "—" : `${s.latency} ms`}
                        </strong>
                      </div>
                      <div>
                        <span>Uptime</span>
                        <strong>
                          {s.uptime == null ? "—" : `${s.uptime}%`}
                        </strong>
                      </div>
                    </div>
                    <div className="service-card-footer">
                      <span>{s.region}</span>
                      <button
                        className="text-button"
                        onClick={() =>
                          setModal({ type: "serviceDetail", id: s.id })
                        }
                      >
                        View details <ArrowRight size={14} />
                      </button>
                    </div>
                  </section>
                ))}
              </div>
              {!services.length && (
                <Empty
                  title="No matching services"
                  detail="Try another search or register a new service."
                />
              )}
            </>
          )}
          {page === "Incidents" && (
            <>
              <div className="incident-stats">
                <span>
                  <strong>{active.length}</strong> Active
                </span>
                <span>
                  <strong>
                    {
                      data.incidents.filter((i) => i.status === "acknowledged")
                        .length
                    }
                  </strong>{" "}
                  Acknowledged
                </span>
                <span>
                  <strong>
                    {
                      data.incidents.filter((i) => i.status === "resolved")
                        .length
                    }
                  </strong>{" "}
                  Resolved
                </span>
              </div>
              <Toolbar
                query={query}
                setQuery={setQuery}
                placeholder="Search incidents…"
              >
                <label className="filter-select">
                  <Filter size={14} />
                  <select
                    aria-label="Incident status"
                    value={incidentFilter}
                    onChange={(e) => setIncidentFilter(e.target.value)}
                  >
                    <option value="active">Active incidents</option>
                    <option value="all">All incidents</option>
                    <option value="open">Open</option>
                    <option value="acknowledged">Acknowledged</option>
                    <option value="resolved">Resolved</option>
                  </select>
                </label>
                <button
                  className="button"
                  onClick={() =>
                    exportCsv(
                      "cloudops-incidents.csv",
                      incidents.map(({ timeline, ...i }) => ({
                        ...i,
                        service: serviceName(i.serviceId),
                      })),
                    )
                  }
                >
                  <Download size={15} />
                  Export
                </button>
              </Toolbar>
              <section className="panel">{incidentTable(incidents)}</section>
            </>
          )}
          {page === "Metrics" && (
            <>
              <div className="metrics-toolbar">
                <span className="subtle-label">
                  Live telemetry · one-minute aggregates
                </span>
                <div className="segmented">
                  {["1h", "6h", "24h"].map((r) => (
                    <button
                      key={r}
                      className={range === r ? "active" : ""}
                      onClick={() => setRange(r)}
                    >
                      {r}
                    </button>
                  ))}
                </div>
                <button
                  className="button"
                  onClick={() => exportCsv("cloudops-metrics.csv", chart)}
                >
                  <Download size={15} />
                  Export metrics
                </button>
              </div>
              <div className="metrics-grid">
                {[
                  ["latency", "Response latency", "ms"],
                  ["requests", "Request volume", "requests / minute"],
                  ["errorRate", "Error rate", "%"],
                  ["cpu", "CPU utilization", "%"],
                ].map(([metric, title, unit]) => (
                  <section className="panel" key={metric}>
                    <div className="panel-heading">
                      <div>
                        <h2>{title}</h2>
                        <p>{unit}</p>
                      </div>
                      <Activity size={18} className="muted" />
                    </div>
                    {graph(metric)}
                  </section>
                ))}
              </div>
            </>
          )}
          {page === "Logs" && (
            <>
              <Toolbar
                query={query}
                setQuery={setQuery}
                placeholder="Search messages, services, or trace IDs…"
              >
                <label className="filter-select">
                  <Filter size={14} />
                  <select
                    aria-label="Log level"
                    value={logLevel}
                    onChange={(e) => setLogLevel(e.target.value)}
                  >
                    <option value="all">All levels</option>
                    <option value="info">Info</option>
                    <option value="warn">Warning</option>
                    <option value="error">Error</option>
                  </select>
                </label>
                <button
                  className="button"
                  onClick={() => exportCsv("cloudops-logs.csv", logs)}
                >
                  <Download size={15} />
                  Export
                </button>
              </Toolbar>
              <section className="panel">
                <div className="panel-heading">
                  <h2>
                    Event stream{" "}
                    <span className="number-tag">{logs.length}</span>
                  </h2>
                  <span className="subtle-label">Latest 500 events</span>
                </div>
                <div className="table-scroll">
                  <table className="logs-table">
                    <thead>
                      <tr>
                        <th>Timestamp</th>
                        <th>Level</th>
                        <th>Service</th>
                        <th>Message</th>
                        <th>Trace ID</th>
                      </tr>
                    </thead>
                    <tbody>
                      {logs.map((l) => (
                        <tr key={l.id}>
                          <td className="nowrap muted">{date(l.at)}</td>
                          <td>
                            <span className={`log-level ${l.level}`}>
                              {l.level.toUpperCase()}
                            </span>
                          </td>
                          <td className="nowrap">{serviceName(l.serviceId)}</td>
                          <td>{l.message}</td>
                          <td className="mono muted">{l.traceId}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!logs.length && (
                    <Empty
                      title="No matching events"
                      detail="Change your search or log level."
                    />
                  )}
                </div>
              </section>
            </>
          )}
          {page === "Monitoring rules" && (
            <>
              <div className="info-banner">
                <SlidersHorizontal size={18} />
                <p>
                  Enabled rules evaluate real checks and application events.
                  Availability and latency recover after two healthy checks.
                  Authentication and request errors use five-minute windows; CPU
                  needs five sustained samples.
                </p>
              </div>
              <div className="rules-grid">
                {data.rules.map((r) => (
                  <section className="panel rule-card" key={r.id}>
                    <div className="rule-top">
                      <span className="service-symbol large">
                        <SlidersHorizontal size={20} />
                      </span>
                      <button
                        className={`toggle ${r.enabled ? "on" : ""}`}
                        role="switch"
                        aria-checked={r.enabled}
                        aria-label={`Enable ${r.name}`}
                        disabled={busy}
                        onClick={() =>
                          act(
                            `rules/${r.id}`,
                            { enabled: !r.enabled },
                            "PATCH",
                            false,
                          )
                        }
                      >
                        <span />
                      </button>
                    </div>
                    <h2>{r.name}</h2>
                    <p>{r.description}</p>
                    <div className="rule-threshold">
                      <strong>{r.threshold}</strong>
                      <span>{r.unit}</span>
                    </div>
                    <div className="rule-footer">
                      <Badge value={r.severity} />
                      <button
                        className="button"
                        onClick={() => setModal({ type: "rule", id: r.id })}
                      >
                        Edit threshold
                      </button>
                    </div>
                  </section>
                ))}
              </div>
            </>
          )}
          {page === "Settings" && (
            <SettingsPage
              data={data}
              busy={busy}
              save={(body) => act("settings", body, "PUT", false)}
              retry={(id) => act(`deliveries/${id}/retry`, {}, "POST", false)}
            />
          )}
          <footer className="main-footer">
            <span>CloudOps AI</span>
            <span>Clarity for your cloud operations.</span>
            <span className="version">v1.0 · Live monitoring</span>
          </footer>
        </main>
      </div>
      {toast && (
        <div className="toast" role="status">
          <Check size={17} />
          {toast}
          <button
            aria-label="Dismiss notification"
            onClick={() => setToast("")}
          >
            <X size={15} />
          </button>
        </div>
      )}
      {modal?.type === "service" && (
        <Modal
          title="Add a service"
          description="Register an endpoint in your monitoring workspace."
          onClose={() => setModal(null)}
        >
          <ServiceForm busy={busy} onSave={(body) => act("services", body)} />
        </Modal>
      )}
      {modal?.type === "token" && (
        <Modal
          title="Service ingestion token"
          description="Copy this token now. Creating another token invalidates this one."
          onClose={() => {
            setToken("");
            setModal(null);
          }}
        >
          <div className="evidence">
            <p className="mono break">{token}</p>
          </div>
          <p className="form-hint">
            Keep it in your monitored application's environment. Send it as
            Authorization: Bearer TOKEN to POST /api/events. Never include it in
            browser code.
          </p>
          <div className="form-actions">
            <button
              className="button"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(token);
                  notify("Token copied.");
                } catch {
                  notify("Select and copy the token manually.");
                }
              }}
            >
              Copy token
            </button>
          </div>
        </Modal>
      )}
      {modal?.type === "incident" &&
        (() => {
          const i = data.incidents.find((i) => i.id === modal.id);
          return (
            <Modal
              title={i.id}
              description={i.title}
              onClose={() => setModal(null)}
            >
              <div className="detail-badges">
                <Badge value={i.severity} />
                <Badge value={i.status} />
              </div>
              <dl className="detail-grid">
                <div>
                  <dt>Affected service</dt>
                  <dd>{serviceName(i.serviceId)}</dd>
                </div>
                <div>
                  <dt>Detected</dt>
                  <dd>{date(i.detectedAt)}</dd>
                </div>
                <div>
                  <dt>Last updated</dt>
                  <dd>{date(i.updatedAt)}</dd>
                </div>
                <div>
                  <dt>Detection method</dt>
                  <dd>Configurable threshold</dd>
                </div>
              </dl>
              <div className="evidence">
                <h3>Diagnostic evidence</h3>
                <p>{i.evidence}</p>
              </div>
              <h3 className="section-label">Incident timeline</h3>
              <div className="timeline">
                {i.timeline.map((t, n) => (
                  <div key={n}>
                    <i />
                    <strong>{t.text}</strong>
                    <span>{date(t.at)}</span>
                  </div>
                ))}
              </div>
              <div className="form-actions">
                {i.status === "open" && (
                  <button
                    className="button"
                    disabled={busy}
                    onClick={() =>
                      act(
                        `incidents/${i.id}`,
                        { status: "acknowledged" },
                        "PATCH",
                        false,
                      )
                    }
                  >
                    <Check size={15} />
                    Acknowledge
                  </button>
                )}
                {i.status !== "resolved" && (
                  <button
                    className="button primary"
                    disabled={busy}
                    onClick={() =>
                      act(
                        `incidents/${i.id}`,
                        { status: "resolved" },
                        "PATCH",
                        false,
                      )
                    }
                  >
                    <CheckCheck size={16} />
                    Resolve incident
                  </button>
                )}
                {i.status === "resolved" && (
                  <span className="resolved-note">
                    <CheckCheck size={16} />
                    This incident has been resolved.
                  </span>
                )}
              </div>
            </Modal>
          );
        })()}
      {modal?.type === "serviceDetail" &&
        (() => {
          const s = data.services.find((s) => s.id === modal.id);
          return (
            <Modal
              title={s.name}
              description={s.description}
              onClose={() => setModal(null)}
            >
              <Badge value={s.enabled ? s.status : "paused"} />
              <p className="form-hint" style={{ marginTop: 10 }}>
                Last check:{" "}
                {s.lastChecked ? date(s.lastChecked) : "Awaiting first check"} ·
                Every {s.intervalSeconds} seconds
              </p>
              {s.lastError && (
                <div className="error-banner" style={{ marginTop: 15 }}>
                  {s.lastError}
                </div>
              )}
              <dl className="detail-grid">
                <div>
                  <dt>Region</dt>
                  <dd>{s.region}</dd>
                </div>
                <div>
                  <dt>Response time</dt>
                  <dd>
                    {s.latency == null
                      ? "Awaiting first check"
                      : `${s.latency} ms`}
                  </dd>
                </div>
                <div>
                  <dt>Uptime</dt>
                  <dd>
                    {s.uptime == null ? "Not yet monitored" : `${s.uptime}%`}
                  </dd>
                </div>
                <div>
                  <dt>Active incidents</dt>
                  <dd>{active.filter((i) => i.serviceId === s.id).length}</dd>
                </div>
              </dl>
              <div className="evidence">
                <h3>Health-check endpoint</h3>
                <p className="mono break">{s.endpoint}</p>
              </div>
              <p className="form-hint">
                Health checks send real HTTP requests. Redirects and
                private-network targets are blocked. Uptime is measured across
                checks since registration.
              </p>
              <div className="form-actions">
                <button
                  className="button"
                  disabled={busy}
                  onClick={() =>
                    act(
                      `services/${s.id}`,
                      { enabled: !s.enabled },
                      "PATCH",
                      false,
                    )
                  }
                >
                  {s.enabled ? "Pause monitoring" : "Resume monitoring"}
                </button>
                <button
                  className="button"
                  disabled={busy}
                  onClick={async () => {
                    const result = await act(
                      `services/${s.id}/token`,
                      {},
                      "POST",
                      false,
                    );
                    if (result) {
                      setToken(result.token);
                      setModal({ type: "token" });
                    }
                  }}
                >
                  Create ingestion token
                </button>
                <button
                  className="button primary"
                  disabled={busy || !s.enabled}
                  onClick={() =>
                    act(`services/${s.id}/check`, {}, "POST", false)
                  }
                >
                  <RefreshCw size={15} />
                  Check now
                </button>
              </div>
            </Modal>
          );
        })()}
      {modal?.type === "rule" &&
        (() => {
          const r = data.rules.find((r) => r.id === modal.id);
          return (
            <Modal
              title={`Edit ${r.name.toLowerCase()}`}
              description="Changes apply to future real checks and events."
              onClose={() => setModal(null)}
            >
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  act(
                    `rules/${r.id}`,
                    {
                      threshold: Number(
                        new FormData(e.currentTarget).get("threshold"),
                      ),
                    },
                    "PATCH",
                  );
                }}
              >
                <label className="field">
                  Threshold
                  <input
                    name="threshold"
                    type="number"
                    defaultValue={r.threshold}
                    min="1"
                    max={["cpu", "errorRate"].includes(r.metric) ? 100 : 100000}
                    step={
                      ["failures", "authFailures"].includes(r.metric)
                        ? 1
                        : "any"
                    }
                    required
                  />
                  <span className="form-hint">{r.unit}</span>
                </label>
                <div className="form-actions">
                  <button className="button primary" disabled={busy}>
                    Save threshold
                  </button>
                </div>
              </form>
            </Modal>
          );
        })()}
      {modal?.type === "guide" && (
        <Modal
          title="Monitor a real service"
          description="From health checks to actionable incidents."
          onClose={() => setModal(null)}
        >
          <div className="guide-step">
            <span>01</span>
            <div>
              <h3>Register an endpoint</h3>
              <p>
                Add a reachable public HTTP(S) health-check URL. For local
                testing, run npm run example and use
                http://127.0.0.1:4100/health.
              </p>
            </div>
          </div>
          <div className="guide-step">
            <span>02</span>
            <div>
              <h3>Collect operational signals</h3>
              <p>
                The worker checks availability and latency. Generate a service
                token to ingest request logs, CPU values, and failed
                authentication events.
              </p>
            </div>
          </div>
          <div className="guide-step">
            <span>03</span>
            <div>
              <h3>Investigate and recover</h3>
              <p>
                Enabled rules create incidents with diagnostic evidence.
                Acknowledge an incident and restore the service. Two healthy
                checks resolve availability and latency incidents automatically.
              </p>
            </div>
          </div>
          <div className="info-banner">
            <Cloud size={18} />
            <p>
              Use docs/AWS-DEPLOYMENT.md for AWS Console setup. Integration
              labels indicate configuration, not a verified connection.
            </p>
          </div>
          <div className="form-actions">
            <button
              className="button primary"
              onClick={() => setModal({ type: "service" })}
            >
              Add a service <ArrowRight size={15} />
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
function Stat({ title, value, suffix, icon: Icon, note, trend, warning }) {
  return (
    <section className="panel stat">
      <div className="stat-heading">
        <span>{title}</span>
        <Icon size={17} />
      </div>
      <div className="stat-value">
        {value}
        <span>{suffix}</span>
      </div>
      <div className="stat-note">{note}</div>
      <span className={`stat-trend ${warning ? "attention" : ""}`}>
        {warning ? <Clock size={12} /> : <span className="tiny-dot" />}
        {trend}
      </span>
    </section>
  );
}
function Toolbar({ query, setQuery, placeholder, children }) {
  return (
    <div className="toolbar">
      <label className="search-box">
        <Search size={16} />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={placeholder}
          aria-label={placeholder}
        />
        {query && (
          <button onClick={() => setQuery("")} aria-label="Clear search">
            <X size={13} />
          </button>
        )}
      </label>
      <div className="toolbar-actions">{children}</div>
    </div>
  );
}
function ServiceForm({ busy, onSave }) {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const fields = Object.fromEntries(new FormData(e.currentTarget));
        onSave({
          ...fields,
          intervalSeconds: Number(fields.intervalSeconds),
          timeoutMs: Number(fields.timeoutMs),
          expectedStatus: Number(fields.expectedStatus),
        });
      }}
    >
      <label className="field">
        Service name
        <input
          name="name"
          placeholder="e.g. Customer API"
          maxLength="80"
          required
        />
      </label>
      <label className="field">
        Health-check URL
        <input
          name="endpoint"
          type="url"
          placeholder="https://api.example.com/health"
          required
        />
      </label>
      <label className="field">
        Description
        <input
          name="description"
          placeholder="What does this service do?"
          maxLength="300"
        />
      </label>
      <label className="field">
        AWS region
        <select name="region">
          <option>ap-south-1</option>
          <option>us-east-1</option>
          <option>eu-west-1</option>
        </select>
      </label>
      <div className="detail-grid">
        <label className="field">
          Check interval (seconds)
          <input
            name="intervalSeconds"
            type="number"
            min="15"
            max="3600"
            defaultValue="60"
            required
          />
        </label>
        <label className="field">
          Timeout (milliseconds)
          <input
            name="timeoutMs"
            type="number"
            min="1000"
            max="30000"
            defaultValue="5000"
            required
          />
        </label>
        <label className="field">
          Expected HTTP status
          <input
            name="expectedStatus"
            type="number"
            min="100"
            max="599"
            defaultValue="200"
            required
          />
        </label>
        <label className="field">
          EC2 instance ID (optional)
          <input name="instanceId" placeholder="i-0123456789abcdef0" />
        </label>
      </div>
      <p className="form-hint">
        The worker starts checking this endpoint automatically. Private-network
        addresses are blocked by default.
      </p>
      <div className="form-actions">
        <button className="button primary" disabled={busy}>
          <Plus size={16} />
          Add service
        </button>
      </div>
    </form>
  );
}
function SettingsPage({ data, busy, save, retry }) {
  return (
    <div className="settings-layout">
      <section className="panel settings-panel">
        <div className="panel-heading">
          <div>
            <h2>Workspace preferences</h2>
            <p>Customize your operations workspace</p>
          </div>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const f = Object.fromEntries(new FormData(e.currentTarget));
            save({ ...f, retention: Number(f.retention) });
          }}
        >
          <label className="field">
            Workspace name
            <input
              name="workspace"
              defaultValue={data.settings.workspace}
              maxLength="80"
              required
            />
          </label>
          <label className="field">
            Administrator email
            <input
              name="email"
              type="email"
              defaultValue={data.settings.email}
              placeholder="admin@example.com"
            />
            <span className="form-hint">
              Contact preference. Alert recipients are managed through confirmed
              SNS subscriptions.
            </span>
          </label>
          <label className="field">
            Preferred log retention
            <select name="retention" defaultValue={data.settings.retention}>
              <option value="7">7 days</option>
              <option value="30">30 days</option>
              <option value="90">90 days</option>
            </select>
            <span className="form-hint">
              The worker removes checks, logs, and audit records older than this
              period. Incidents are retained.
            </span>
          </label>
          <div className="form-actions">
            <button className="button primary" disabled={busy}>
              Save preferences
            </button>
          </div>
        </form>
      </section>
      <section className="panel connection-panel">
        <Cloud size={28} />
        <h2>AWS integration</h2>
        <p>
          Real monitoring works locally. Configure the AWS resources using the
          deployment guide to enable cloud processing, alerts, and archives.
        </p>
        {[
          ["Database", data.storage],
          ["Incident processing", data.integrations.queue],
          ["SNS alerts", data.integrations.alerts],
          ["S3 archives", data.integrations.archives],
          ["CloudWatch", data.integrations.cloudwatch],
          [
            "Monitoring worker",
            data.worker.healthy ? "Running" : "Heartbeat missing",
          ],
        ].map(([label, state]) => (
          <div className="connection-row" key={label}>
            <span>{label}</span>
            <span className="pending-label">{state}</span>
          </div>
        ))}
        <h3 className="section-label" style={{ marginTop: 24 }}>
          Recent delivery jobs
        </h3>
        <div className="delivery-list">
          {data.deliveries.length ? (
            data.deliveries.map((d) => (
              <div className="delivery-row" key={d.id}>
                <span>
                  <strong>
                    {d.kind} · {d.status}
                  </strong>
                  <small>
                    {d.lastError || "No delivery error"} · {d.attempts} attempts
                  </small>
                </span>
                {d.status === "failed" && (
                  <button
                    className="button"
                    disabled={busy}
                    onClick={() => retry(d.id)}
                  >
                    Retry
                  </button>
                )}
              </div>
            ))
          ) : (
            <p className="form-hint">
              Delivery jobs appear when telemetry or alerts are queued.
            </p>
          )}
        </div>
        <div className="form-hint">
          Database: {data.storage}. AWS configuration is loaded from the server
          environment.
        </div>
      </section>
    </div>
  );
}
