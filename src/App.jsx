import React, { useEffect, useState } from "react";
import { Cloud, LoaderCircle, Menu, Plus, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Toaster } from "@/components/ui/sonner";
import { AppSidebar } from "@/components/app-sidebar";
import { ThemeToggle } from "@/components/theme-toggle";
import AuthScreen from "./AuthScreen.jsx";
import { api, setCsrf } from "@/lib/api";
import { date } from "@/lib/format";
import { OverviewPage } from "@/pages/overview";
import { ServicesPage } from "@/pages/services";
import { IncidentsPage } from "@/pages/incidents";
import { MetricsPage } from "@/pages/metrics";
import { LogsPage } from "@/pages/logs";
import { RulesPage } from "@/pages/rules";
import { SettingsPage } from "@/pages/settings";
import { GuideDialog, RuleDialog, ServiceFormDialog } from "@/dialogs";
import { IntegrationDialog } from "@/integration";
import { IncidentDrawer } from "@/drawers";
import { ServiceDetailPage } from "@/pages/service-detail";

// The open service page lives in the address bar: #/services/<id>
const serviceFromHash = () =>
  /^#\/services\/([\w-]+)/.exec(window.location.hash)?.[1] || null;

const titles = {
  Overview: ["Overview", "Health, incidents and response time at a glance."],
  Services: ["Services", "Every endpoint CloudOps is watching."],
  Incidents: ["Incidents", "Investigate, acknowledge and resolve issues."],
  Metrics: ["Metrics", "Performance over time."],
  Logs: ["Logs", "Recent events across your services."],
  "Monitoring rules": [
    "Monitoring rules",
    "Define what counts as an incident.",
  ],
  Settings: ["Settings", "Workspace preferences and AWS integration status."],
};

export default function App() {
  const [data, setData] = useState(null),
    [auth, setAuth] = useState(undefined),
    [page, setPage] = useState("Overview"),
    [error, setError] = useState(""),
    [query, setQuery] = useState(""),
    [range, setRange] = useState("24h"),
    [modal, setModal] = useState(null),
    [busy, setBusy] = useState(false),
    [mobile, setMobile] = useState(false),
    [incidentFilter, setIncidentFilter] = useState("active"),
    [logLevel, setLogLevel] = useState("all"),
    [serviceId, setServiceId] = useState(serviceFromHash);

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
        setCsrf(session.csrfToken);
        setAuth(session);
        if (session.user) load();
      })
      .catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    const sync = () => setServiceId(serviceFromHash());
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);
  useEffect(() => {
    if (!auth?.user) return;
    const poll = setInterval(load, 10000);
    return () => clearInterval(poll);
  }, [auth?.user?.id]);

  async function act(path, body, method = "POST", close = true) {
    setBusy(true);
    try {
      const result = await api(path, { method, body });
      await load();
      toast.success(result.message || "Changes saved.");
      if (close) setModal(null);
      return result;
    } catch (e) {
      toast.error(e.message);
      return null;
    } finally {
      setBusy(false);
    }
  }
  const navigate = (p, filter) => {
    if (window.location.hash) window.location.hash = "";
    setPage(p);
    setQuery("");
    setMobile(false);
    if (filter) setIncidentFilter(filter);
  };
  async function signOut() {
    try {
      await api("auth/logout", { body: {} });
      setCsrf("");
      setAuth({ user: null, setupRequired: false });
      setData(null);
    } catch (e) {
      toast.error(e.message);
    }
  }
  async function refresh() {
    setBusy(true);
    await load();
    setBusy(false);
    toast.success("Refreshed.");
  }

  if (auth && !auth.user)
    return (
      <>
        <AuthScreen
          setupRequired={auth.setupRequired}
          api={api}
          onSuccess={(session) => {
            setCsrf(session.csrfToken);
            setAuth(session);
            load();
          }}
        />
        <Toaster />
      </>
    );
  if (!data)
    return (
      <div className="flex min-h-svh flex-col items-center justify-center gap-3 text-center">
        <span className="flex size-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <Cloud className="size-5" />
        </span>
        {error ? (
          <>
            <p className="text-sm text-muted-foreground">
              Could not connect to the backend.
            </p>
            <Button variant="outline" onClick={() => window.location.reload()}>
              Try again
            </Button>
          </>
        ) : (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <LoaderCircle className="size-4 animate-spin" /> Loading your
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
    matches(`${s.name} ${s.description} ${s.region} ${s.endpoint}`),
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
  // Average time real requests took (weighted by how many requests each minute had).
  const traffic = chart.filter((m) => m.appLatency !== null && m.requests);
  const appAvg = traffic.length
    ? Math.round(
        traffic.reduce((n, m) => n + m.appLatency * m.requests, 0) /
          traffic.reduce((n, m) => n + m.requests, 0),
      )
    : null;
  const avg = latencies.length
    ? Math.round(
        latencies.reduce((n, m) => n + m.latency, 0) / latencies.length,
      )
    : "—";
  const openIncident = (id) => setModal({ type: "incident", id });
  const openService = (id) => {
    window.location.hash = `/services/${id}`;
    window.scrollTo(0, 0);
  };
  const openAddService = () => setModal({ type: "service" });
  const close = () => setModal(null);
  const [title, subtitle] = titles[page];
  const sidebar = (
    <AppSidebar
      page={serviceId ? "Services" : page}
      onNavigate={navigate}
      activeCount={active.length}
      workspace={data.settings.workspace}
      email={data.user.email}
      workerHealthy={data.worker.healthy}
      onGuide={() => setModal({ type: "guide" })}
      onSignOut={signOut}
    />
  );
  const servicePage = serviceId && data.services.find((s) => s.id === serviceId);
  const modalIntegration =
    modal?.type === "integration" &&
    data.services.find((s) => s.id === modal.id);
  const modalIncident =
    modal?.type === "incident" && data.incidents.find((i) => i.id === modal.id);
  const modalRule =
    modal?.type === "rule" && data.rules.find((r) => r.id === modal.id);

  return (
    <div className="min-h-svh">
      <aside className="fixed inset-y-0 left-0 hidden w-60 border-r lg:block">
        {sidebar}
      </aside>
      <Sheet open={mobile} onOpenChange={setMobile}>
        <SheetContent side="left" className="w-60 p-0">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          {sidebar}
        </SheetContent>
      </Sheet>
      <div className="lg:pl-60">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b bg-background px-4 sm:px-6">
          <Button
            variant="ghost"
            size="icon-sm"
            className="lg:hidden"
            aria-label="Open navigation"
            onClick={() => setMobile(true)}
          >
            <Menu />
          </Button>
          <span className="flex min-w-0 items-center gap-1 text-sm text-muted-foreground">
            CloudOps <span>/</span>
            {serviceId ? (
              <>
                <button
                  className="hover:text-foreground"
                  onClick={() => navigate("Services")}
                >
                  Services
                </button>
                <span>/</span>
                <span className="truncate text-foreground">
                  {servicePage?.name || "Service"}
                </span>
              </>
            ) : (
              <span className="text-foreground">{title}</span>
            )}
          </span>
          <div className="ml-auto flex items-center gap-1.5">
            <ThemeToggle />
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Refresh"
              disabled={busy}
              onClick={refresh}
            >
              <RefreshCw className={busy ? "animate-spin" : ""} />
            </Button>
            <Button size="sm" onClick={openAddService}>
              <Plus /> Add service
            </Button>
          </div>
        </header>
        <main className="mx-auto flex max-w-6xl flex-col gap-6 p-4 sm:p-8">
          {!serviceId && (
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
              <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
            </div>
          )}
          {error && (
            <Alert variant="destructive" role="alert">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          {!data.worker.healthy && (
            <Alert variant="destructive" role="status">
              <AlertDescription>
                <strong>Monitoring worker heartbeat is missing.</strong> Checks
                may be delayed.{" "}
                {data.worker.lastHeartbeat &&
                  `Last heartbeat: ${date(data.worker.lastHeartbeat)}`}
              </AlertDescription>
            </Alert>
          )}
          {serviceId && !servicePage && (
            <div className="rounded-lg border p-8 text-center text-sm text-muted-foreground">
              This service no longer exists.{" "}
              <button className="underline" onClick={() => navigate("Services")}>
                Back to services
              </button>
            </div>
          )}
          {servicePage && (
            <ServiceDetailPage
              key={servicePage.id}
              service={servicePage}
              incidents={data.incidents}
              serviceName={serviceName}
              busy={busy}
              act={act}
              openIncident={openIncident}
              onGuide={(t) => setModal({ type: "integration", id: servicePage.id, token: t })}
              onDeleted={() => navigate("Services")}
            />
          )}
          <div key={page} className={serviceId ? "hidden" : undefined}>
            {page === "Overview" && (
              <OverviewPage
                data={data}
                active={active}
                healthy={healthy}
                chart={chart}
                avg={avg}
                appAvg={appAvg}
                range={range}
                setRange={setRange}
                serviceName={serviceName}
                navigate={navigate}
                openIncident={openIncident}
                openService={openService}
                openAddService={openAddService}
              />
            )}
            {page === "Services" && (
              <ServicesPage
                services={services}
                total={data.services.length}
                query={query}
                setQuery={setQuery}
                openService={openService}
                openAddService={openAddService}
              />
            )}
            {page === "Incidents" && (
              <IncidentsPage
                all={data.incidents}
                items={incidents}
                active={active}
                query={query}
                setQuery={setQuery}
                filter={incidentFilter}
                setFilter={setIncidentFilter}
                serviceName={serviceName}
                openIncident={openIncident}
              />
            )}
            {page === "Metrics" && (
              <MetricsPage
                chart={chart}
                range={range}
                setRange={setRange}
                services={data.services}
              />
            )}
            {page === "Logs" && (
              <LogsPage
                logs={logs}
                query={query}
                setQuery={setQuery}
                level={logLevel}
                setLevel={setLogLevel}
                serviceName={serviceName}
              />
            )}
            {page === "Monitoring rules" && (
              <RulesPage
                rules={data.rules}
                busy={busy}
                toggle={(id, enabled) =>
                  act(`rules/${id}`, { enabled }, "PATCH", false)
                }
                edit={(id) => setModal({ type: "rule", id })}
              />
            )}
            {page === "Settings" && (
              <SettingsPage
                data={data}
                busy={busy}
                save={(body) => act("settings", body, "PUT", false)}
                archive={() => act("archive", {}, "POST", false)}
                retry={(id) =>
                  act(`deliveries/${id}/retry`, {}, "POST", false)
                }
              />
            )}
          </div>
          <footer className="flex flex-wrap justify-between gap-2 border-t pt-4 text-xs text-muted-foreground">
            <span>CloudOps</span>
            <span>
              Stored in{" "}
              {data.storage === "postgresql" ? "PostgreSQL" : "SQLite (local)"}
            </span>
          </footer>
        </main>
      </div>
      <Toaster />
      {modal?.type === "service" && (
        <ServiceFormDialog
          busy={busy}
          onClose={close}
          onSave={async (body, connect) => {
            const created = await act("services", body);
            if (!(connect && created?.id)) return;
            const made = await act(`services/${created.id}/token`, {}, "POST", false);
            if (made)
              setModal({ type: "integration", id: created.id, token: made.token });
          }}
        />
      )}
      {modal?.type === "integration" && modalIntegration && (
        <IntegrationDialog
          service={modalIntegration}
          token={modal.token}
          busy={busy}
          onRefresh={load}
          onClose={close}
          onNewToken={async () => {
            const result = await act(
              `services/${modalIntegration.id}/token`,
              {},
              "POST",
              false,
            );
            if (result)
              setModal({ type: "integration", id: modalIntegration.id, token: result.token });
          }}
        />
      )}
      {modalIncident && (
        <IncidentDrawer
          incident={modalIncident}
          serviceName={serviceName}
          busy={busy}
          act={act}
          onClose={close}
        />
      )}
      {modalRule && (
        <RuleDialog rule={modalRule} busy={busy} act={act} onClose={close} />
      )}
      {modal?.type === "guide" && (
        <GuideDialog onClose={close} onAdd={openAddService} />
      )}
    </div>
  );
}
