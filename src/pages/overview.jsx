import { ArrowRight, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Section } from "@/components/section";
import { Stat } from "@/components/stat-card";
import { MonitorList } from "@/components/monitor-list";
import { MetricChart } from "@/components/metric-chart";
import { IncidentTable } from "@/components/incident-table";
import { cn } from "@/lib/utils";

export function OverviewPage({
  data,
  active,
  healthy,
  chart,
  avg,
  appAvg,
  range,
  setRange,
  serviceName,
  navigate,
  openIncident,
  openService,
  openAddService,
}) {
  const services = data.services;
  const down = services.filter(
    (s) => s.enabled && ["degraded", "unhealthy"].includes(s.status),
  );
  const state = !services.length
    ? "empty"
    : down.length
      ? "down"
      : active.length
        ? "issue"
        : services.every((s) => s.status === "pending")
          ? "pending"
          : "ok";
  const headline = {
    empty: "No services monitored yet",
    pending: "Running the first health checks",
    down: `${down.length} of ${services.length} services ${down.length === 1 ? "is" : "are"} down`,
    issue: `${active.length} active incident${active.length === 1 ? "" : "s"}`,
    ok: "All systems operational",
  }[state];
  const detail = {
    empty: "Add a service to start monitoring it.",
    pending: "Results appear within a few seconds.",
    down: down.map((s) => s.name).join(", "),
    issue: "Every service responds, but a rule has tripped.",
    ok: `${services.length} service${services.length === 1 ? "" : "s"} responding normally.`,
  }[state];
  const withUptime = services.filter((s) => s.uptime != null);
  const availability = withUptime.length
    ? (
        withUptime.reduce((n, s) => n + s.uptime, 0) / withUptime.length
      ).toFixed(1)
    : "—";
  return (
    <div className="flex flex-col gap-6">
      <Card className="flex-row items-center gap-4 px-5 py-4 shadow-none">
        <span
          className={cn(
            "size-2.5 shrink-0 rounded-full",
            { ok: "bg-success", down: "bg-danger", issue: "bg-warning" }[state] ||
              "bg-muted-foreground/50",
          )}
        />
        <div className="min-w-0 flex-1">
          <div className="font-medium">{headline}</div>
          <div className="truncate text-sm text-muted-foreground">{detail}</div>
        </div>
        {state === "empty" ? (
          <Button size="sm" onClick={openAddService}>
            <Plus /> Add service
          </Button>
        ) : (
          <span className="hidden text-xs text-muted-foreground sm:block">
            Updated {new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </span>
        )}
      </Card>

      <Card className="grid grid-cols-2 gap-0 divide-border py-0 shadow-none lg:grid-cols-4 lg:divide-x [&>*:nth-child(-n+2)]:max-lg:border-b [&>*:nth-child(odd)]:max-lg:border-r">
        <Stat
          label="Availability"
          value={availability}
          suffix={availability === "—" ? "" : "%"}
          note="Successful checks, last 24h"
        />
        <Stat
          label="Active incidents"
          value={active.length}
          note={`${active.filter((i) => ["critical", "high"].includes(i.severity)).length} high priority`}
        />
        <Stat
          label="Avg. response"
          value={appAvg ?? avg}
          suffix={(appAvg ?? avg) === "—" ? "" : "ms"}
          note={
            appAvg == null
              ? `Health checks, last ${range}`
              : `Real traffic · health check ${avg === "—" ? "—" : `${avg} ms`}`
          }
        />
        <Stat
          label="Services"
          value={services.length}
          note={`${healthy} healthy`}
        />
      </Card>

      <Section
        title="Services"
        description="Latest health checks"
        action={
          services.length > 0 && (
            <Button variant="ghost" size="sm" onClick={() => navigate("Services")}>
              View all <ArrowRight />
            </Button>
          )
        }
      >
        <MonitorList
          services={services.slice(0, 6)}
          onOpen={openService}
          empty={{
            action: (
              <Button size="sm" className="mt-3" onClick={openAddService}>
                <Plus /> Add service
              </Button>
            ),
          }}
        />
      </Section>

      <Section
        title="Response time (health checks)"
        description="Average across all services. Real request times are on Metrics"
        action={
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
        }
      >
        <div className="p-4">
          <MetricChart data={chart} metric="latency" height={220} />
        </div>
      </Section>

      <Section
        title="Active incidents"
        action={
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate("Incidents", "all")}
          >
            View all <ArrowRight />
          </Button>
        }
      >
        <IncidentTable
          items={active.slice(0, 5)}
          serviceName={serviceName}
          onOpen={openIncident}
        />
      </Section>
    </div>
  );
}
