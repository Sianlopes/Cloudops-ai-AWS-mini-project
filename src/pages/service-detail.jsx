import { useEffect, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  KeyRound,
  Pause,
  Play,
  Plug,
  RefreshCw,
  Trash2,
  X,
} from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Section } from "@/components/section";
import { StatusBadge } from "@/components/status-badge";
import { Heartbeat } from "@/components/heartbeat";
import { MetricChart } from "@/components/metric-chart";
import { IncidentTable } from "@/components/incident-table";
import { EmptyState } from "@/components/empty-state";
import { api } from "@/lib/api";
import { date, since } from "@/lib/format";
import { cn } from "@/lib/utils";

const rangeLabel = { "1h": "last hour", "6h": "last 6 hours", "24h": "last 24 hours" };

function Fact({ label, children, className }) {
  return (
    <div className={className}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-lg font-semibold tabular">{children}</dd>
    </div>
  );
}
const ms = (v) => (v == null ? "—" : `${v} ms`);
const pct = (v) => (v == null ? "—" : `${v}%`);

function Method({ value }) {
  if (!value) return null;
  return (
    <span className="mr-2 inline-block w-14 rounded border bg-muted/50 px-1.5 py-0.5 text-center font-mono text-[10px] font-semibold text-muted-foreground">
      {value}
    </span>
  );
}

function ConfirmDelete({ service, busy, onConfirm, onClose }) {
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Delete {service.name}?</DialogTitle>
          <DialogDescription>
            Its health checks, request data, logs and incidents are removed
            permanently. Applications still sending events with its token will
            be rejected.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="destructive" disabled={busy} onClick={onConfirm}>
            <Trash2 /> Delete service
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ServiceDetailPage({
  service: s,
  incidents,
  serviceName,
  busy,
  act,
  openIncident,
  onGuide,
  onDeleted,
}) {
  const [tab, setTab] = useState("overview");
  const [range, setRange] = useState("24h");
  const [endpoint, setEndpoint] = useState("");
  const [insights, setInsights] = useState(null);
  const [sort, setSort] = useState({ by: "requests", dir: "desc" });
  const [confirming, setConfirming] = useState(false);

  // Insights are computed on demand for this service, range and endpoint filter.
  useEffect(() => {
    let live = true;
    const load = () =>
      api(
        `services/${s.id}/insights?range=${range}&endpoint=${encodeURIComponent(endpoint)}`,
      )
        .then((r) => live && setInsights(r))
        .catch(() => {});
    load();
    const t = setInterval(load, 10000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [s.id, range, endpoint]);

  const connected =
    s.lastEventAt && Date.now() - new Date(s.lastEventAt) < 5 * 60000;
  const traffic = insights?.traffic;
  const serviceIncidents = incidents
    .filter((i) => i.serviceId === s.id)
    .sort((a, b) => b.detectedAt.localeCompare(a.detectedAt));
  const active = serviceIncidents.filter((i) => i.status !== "resolved");

  const endpoints = [...(insights?.endpoints || [])].sort((a, b) => {
    if (a.other !== b.other) return a.other ? 1 : -1; // "Other" always last
    const get = (e) =>
      sort.by === "key" ? e.key : (e[sort.by] ?? -1);
    const cmp =
      typeof get(a) === "string"
        ? get(a).localeCompare(get(b))
        : get(a) - get(b);
    return sort.dir === "asc" ? cmp : -cmp;
  });
  const sortBy = (by) =>
    setSort((cur) =>
      cur.by === by
        ? { by, dir: cur.dir === "asc" ? "desc" : "asc" }
        : { by, dir: by === "key" ? "asc" : "desc" },
    );
  const SortHead = ({ by, children, className }) => (
    <TableHead className={className}>
      <button
        onClick={() => sortBy(by)}
        className={cn(
          "inline-flex items-center gap-1 hover:text-foreground",
          className?.includes("text-right") && "flex-row-reverse",
        )}
      >
        {children}
        {sort.by === by &&
          (sort.dir === "asc" ? (
            <ArrowUp className="size-3" />
          ) : (
            <ArrowDown className="size-3" />
          ))}
      </button>
    </TableHead>
  );
  const pick = (e) => {
    if (e.other) return;
    setEndpoint(e.key);
    setTab("overview");
  };
  const connectPrompt = (
    <EmptyState
      icon={Plug}
      title="This service isn't connected yet"
      detail="Health checks only see /health. Connect the application and CloudOps discovers its endpoints and shows real traffic, errors and response times."
    >
      <Button size="sm" className="mt-3" onClick={() => onGuide("")}>
        <KeyRound /> Connect your app
      </Button>
    </EmptyState>
  );

  return (
    <div className="flex flex-col gap-6">
      {/* header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="truncate text-2xl font-semibold tracking-tight">
              {s.name}
            </h1>
            <StatusBadge value={s.enabled ? s.status : "paused"} />
            {connected && (
              <Badge variant="outline" className="gap-1.5 font-normal">
                <span className="size-1.5 rounded-full bg-success" /> App connected
              </Badge>
            )}
          </div>
          <p className="mt-1 font-mono text-xs break-all text-muted-foreground">
            {s.endpoint}
          </p>
          {s.description && (
            <p className="mt-1 text-sm text-muted-foreground">{s.description}</p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            disabled={busy || !s.enabled}
            onClick={() => act(`services/${s.id}/check`, {}, "POST", false)}
          >
            <RefreshCw /> Check now
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() =>
              act(`services/${s.id}`, { enabled: !s.enabled }, "PATCH", false)
            }
          >
            {s.enabled ? <Pause /> : <Play />}
            {s.enabled ? "Pause" : "Resume"}
          </Button>
          <Button variant="outline" size="sm" onClick={() => onGuide("")}>
            <KeyRound /> Connect your app
          </Button>
        </div>
      </div>
      {s.lastError && s.enabled && s.status !== "healthy" && (
        <Alert variant="destructive">
          <AlertDescription>{s.lastError}</AlertDescription>
        </Alert>
      )}

      {/* the two views of this service */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Health check" description="CloudOps asks the service if it is up">
          <div className="flex flex-col gap-4 p-4">
            <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Fact label="Response">{ms(s.latency)}</Fact>
              <Fact label="Uptime (24h)">{pct(s.uptime)}</Fact>
              <Fact label="Interval">{s.intervalSeconds}s</Fact>
              <Fact label="Last check">
                <span className="text-sm">{s.lastChecked ? since(s.lastChecked) : "—"}</span>
              </Fact>
            </dl>
            <Heartbeat history={s.history} count={40} height={22} />
          </div>
        </Section>
        <Section
          title="Real traffic"
          description={`What the application reports, ${rangeLabel[range]}`}
        >
          {traffic?.requests ? (
            <dl className="grid grid-cols-2 gap-4 p-4 sm:grid-cols-5">
              <Fact label="Requests">{traffic.requests.toLocaleString()}</Fact>
              <Fact label="Error rate">
                <span className={cn(traffic.errorRate >= 5 && "text-danger")}>
                  {pct(traffic.errorRate)}
                </span>
              </Fact>
              <Fact label="Avg response">{ms(traffic.avgMs)}</Fact>
              <Fact label="p95 response">{ms(traffic.p95Ms)}</Fact>
              <Fact label="Endpoints">{traffic.endpoints}</Fact>
            </dl>
          ) : connected || s.lastEventAt ? (
            <p className="p-4 text-sm text-muted-foreground">
              No requests reported in the {rangeLabel[range]}.
            </p>
          ) : (
            <div className="flex items-center justify-between gap-4 p-4">
              <p className="text-sm text-muted-foreground">
                Not connected. Add the ingestion code to see requests, errors and
                every endpoint.
              </p>
              <Button variant="outline" size="sm" onClick={() => onGuide("")}>
                Connect
              </Button>
            </div>
          )}
        </Section>
      </div>

      {/* tabs */}
      <Tabs value={tab} onValueChange={setTab} className="gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="endpoints">
              Endpoints{traffic?.endpoints ? ` (${traffic.endpoints})` : ""}
            </TabsTrigger>
            <TabsTrigger value="incidents">
              Incidents{active.length ? ` (${active.length})` : ""}
            </TabsTrigger>
            <TabsTrigger value="logs">Logs</TabsTrigger>
            <TabsTrigger value="settings">Settings</TabsTrigger>
          </TabsList>
          {["overview", "endpoints", "logs"].includes(tab) && (
            <ToggleGroup
              type="single"
              variant="outline"
              size="sm"
              value={range}
              onValueChange={(v) => v && setRange(v)}
            >
              {["1h", "6h", "24h"].map((r) => (
                <ToggleGroupItem key={r} value={r}>
                  {r}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          )}
        </div>

        {endpoint && (
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Showing only</span>
            <Badge variant="outline" className="gap-1.5 pr-1 font-mono">
              {endpoint}
              <button
                onClick={() => setEndpoint("")}
                aria-label="Clear endpoint filter"
                className="rounded p-0.5 hover:bg-muted"
              >
                <X className="size-3" />
              </button>
            </Badge>
          </div>
        )}

        <TabsContent value="overview">
          <div className="grid gap-4 lg:grid-cols-2">
            {!endpoint && (
              <Section title="Health check response time" description="Milliseconds per check">
                <div className="p-4">
                  <MetricChart data={insights?.series || []} metric="latency" height={190} />
                </div>
              </Section>
            )}
            <Section title="Response time (real traffic)" description="Average per request">
              <div className="p-4">
                <MetricChart data={insights?.series || []} metric="appLatency" height={190} />
              </div>
            </Section>
            <Section title="Request volume" description="Requests per minute">
              <div className="p-4">
                <MetricChart data={insights?.series || []} metric="requests" height={190} />
              </div>
            </Section>
            <Section title="Error rate" description="Share of requests returning 5xx">
              <div className="p-4">
                <MetricChart data={insights?.series || []} metric="errorRate" height={190} />
              </div>
            </Section>
            {s.instanceId && !endpoint && (
              <Section title="CPU utilization" description={`${s.instanceId} · ${s.region}`}>
                <div className="p-4">
                  <MetricChart data={insights?.series || []} metric="cpu" height={190} />
                </div>
              </Section>
            )}
          </div>
        </TabsContent>

        <TabsContent value="endpoints">
          <Section
            title="Endpoints"
            description="Found automatically from the requests your application reports. Click one to focus on it."
          >
            {endpoints.length ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <SortHead by="key" className="pl-4">Endpoint</SortHead>
                    <SortHead by="requests" className="text-right">Requests</SortHead>
                    <SortHead by="errorRate" className="text-right">Errors</SortHead>
                    <SortHead by="avgMs" className="text-right">Avg</SortHead>
                    <SortHead by="p95Ms" className="text-right">p95</SortHead>
                    <TableHead className="pr-4 text-right">Last seen</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {endpoints.map((e) => (
                    <TableRow
                      key={e.key}
                      className={cn(!e.other && "cursor-pointer", endpoint === e.key && "bg-muted/60")}
                      onClick={() => pick(e)}
                    >
                      <TableCell className="pl-4">
                        <Method value={e.method} />
                        <span className="font-mono text-xs">
                          {e.other ? e.key : e.route || e.key}
                        </span>
                      </TableCell>
                      <TableCell className="text-right tabular">
                        {e.requests.toLocaleString()}
                      </TableCell>
                      <TableCell
                        className={cn(
                          "text-right tabular",
                          e.errorRate >= 5 && "font-medium text-danger",
                        )}
                      >
                        {e.errors ? `${e.errorRate}% (${e.errors})` : "0%"}
                      </TableCell>
                      <TableCell className="text-right tabular">{ms(e.avgMs)}</TableCell>
                      <TableCell className="text-right tabular">{ms(e.p95Ms)}</TableCell>
                      <TableCell className="pr-4 text-right whitespace-nowrap text-muted-foreground">
                        {e.lastAt ? since(e.lastAt) : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : s.lastEventAt ? (
              <EmptyState
                icon={Plug}
                title="No requests in this period"
                detail={`Nothing was reported in the ${rangeLabel[range]}. Try a longer range.`}
              />
            ) : (
              connectPrompt
            )}
          </Section>
        </TabsContent>

        <TabsContent value="incidents">
          <Section title="Incidents" description="Everything raised for this service">
            <IncidentTable
              items={serviceIncidents}
              serviceName={serviceName}
              onOpen={openIncident}
            />
          </Section>
        </TabsContent>

        <TabsContent value="logs">
          <Section title="Recent events" description="Latest 200 in this range">
            {insights?.logs?.length ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-36 pl-4">Time</TableHead>
                    <TableHead className="w-20">Level</TableHead>
                    <TableHead>Message</TableHead>
                    <TableHead className="w-20 text-right">Status</TableHead>
                    <TableHead className="w-24 pr-4 text-right">Duration</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {insights.logs.map((l) => (
                    <TableRow key={l.id}>
                      <TableCell className="pl-4 whitespace-nowrap text-muted-foreground tabular">
                        {date(l.at)}
                      </TableCell>
                      <TableCell
                        className={cn(
                          "text-xs font-medium uppercase",
                          l.level === "error" && "text-danger",
                          l.level === "warn" && "text-warning",
                          l.level === "info" && "text-muted-foreground",
                        )}
                      >
                        {l.level}
                      </TableCell>
                      <TableCell className="max-w-md whitespace-normal">{l.message}</TableCell>
                      <TableCell className="text-right tabular">{l.statusCode ?? "—"}</TableCell>
                      <TableCell className="pr-4 text-right tabular">
                        {l.duration == null ? "—" : `${Math.round(l.duration)} ms`}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <EmptyState
                title="No events"
                detail="Health checks and reported requests appear here."
              />
            )}
          </Section>
        </TabsContent>

        <TabsContent value="settings">
          <div className="grid gap-4 lg:grid-cols-2">
            <Section title="Health check" description="How CloudOps probes this service">
              <dl className="grid grid-cols-2 gap-4 p-4 text-sm">
                <div className="col-span-2">
                  <dt className="text-xs text-muted-foreground">URL</dt>
                  <dd className="font-mono text-xs break-all">{s.endpoint}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Interval</dt>
                  <dd>Every {s.intervalSeconds}s</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Timeout</dt>
                  <dd>{s.timeoutMs} ms</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Expected status</dt>
                  <dd>{s.expectedStatus}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">CPU monitoring</dt>
                  <dd>{s.instanceId ? `${s.instanceId} (${s.region})` : "Off"}</dd>
                </div>
              </dl>
            </Section>
            <Section title="Application connection" description="Reports every request, error and failed sign-in">
              <div className="flex flex-col gap-3 p-4 text-sm">
                <p className="flex items-center gap-2">
                  <span className={cn("size-2 rounded-full", connected ? "bg-success" : "bg-muted-foreground/50")} />
                  {connected
                    ? `Connected. Last event ${since(s.lastEventAt)}.`
                    : s.lastEventAt
                      ? `No events recently. The last one arrived ${since(s.lastEventAt)}.`
                      : "Not connected."}
                </p>
                <p className="text-muted-foreground">
                  {s.hasToken
                    ? "An ingestion token exists for this service. Creating a new one stops the old one working."
                    : "No ingestion token yet."}
                </p>
                <Button variant="outline" size="sm" className="self-start" onClick={() => onGuide("")}>
                  <KeyRound /> Connection guide and token
                </Button>
              </div>
            </Section>
            <Section title="Delete service" description="This cannot be undone">
              <div className="flex items-center justify-between gap-4 p-4">
                <p className="text-sm text-muted-foreground">
                  Removes the service with its checks, request data, logs and incidents.
                </p>
                <Button variant="destructive" size="sm" onClick={() => setConfirming(true)}>
                  <Trash2 /> Delete
                </Button>
              </div>
            </Section>
          </div>
        </TabsContent>
      </Tabs>

      {confirming && (
        <ConfirmDelete
          service={s}
          busy={busy}
          onClose={() => setConfirming(false)}
          onConfirm={async () => {
            const done = await act(`services/${s.id}`, {}, "DELETE");
            if (done) onDeleted();
          }}
        />
      )}
    </div>
  );
}
