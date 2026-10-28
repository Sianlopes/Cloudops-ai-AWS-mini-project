import { useEffect, useState } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Section } from "@/components/section";
import { MetricChart } from "@/components/metric-chart";
import { api } from "@/lib/api";
import { exportCsv } from "@/lib/format";

const charts = [
  ["latency", "Response time (health checks)", "Milliseconds per health check"],
  ["appLatency", "Response time (real traffic)", "Average time the application takes to answer a request"],
  ["requests", "Request volume", "Requests per minute, all endpoints"],
  ["errorRate", "Error rate", "Share of requests returning 5xx, all endpoints"],
  ["cpu", "CPU utilization", "Percent, from CloudWatch or CPU events"],
];

export function MetricsPage({ chart, range, setRange, services }) {
  const [serviceId, setServiceId] = useState("all");
  const [series, setSeries] = useState(null);

  // One service: its own series come from the insights endpoint (same 1h/6h/24h range).
  useEffect(() => {
    if (serviceId === "all") return setSeries(null);
    if (!services.some((s) => s.id === serviceId)) return setServiceId("all");
    let live = true;
    const load = () =>
      api(`services/${serviceId}/insights?range=${range}`)
        .then((r) => live && setSeries(r.series))
        .catch(() => {});
    load();
    const t = setInterval(load, 10000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [serviceId, range, services]);

  const data = serviceId === "all" ? chart : series || [];
  const name = services.find((s) => s.id === serviceId)?.name;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Select value={serviceId} onValueChange={setServiceId}>
            <SelectTrigger size="sm" className="w-52" aria-label="Service">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All services</SelectItem>
              {services.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="hidden text-sm text-muted-foreground sm:block">
            One-minute aggregates
          </span>
        </div>
        <div className="flex items-center gap-2">
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
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              exportCsv(
                `cloudops-metrics${name ? `-${name.toLowerCase().replace(/\W+/g, "-")}` : ""}.csv`,
                data,
              )
            }
          >
            <Download /> Export CSV
          </Button>
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {charts.map(([metric, title, description]) => (
          <Section key={metric} title={title} description={description}>
            <div className="p-4">
              <MetricChart data={data} metric={metric} height={200} />
            </div>
          </Section>
        ))}
      </div>
    </div>
  );
}
