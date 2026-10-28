import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { EmptyState } from "@/components/empty-state";
import { Activity } from "lucide-react";
import { date } from "@/lib/format";

const meta = {
  appLatency: { label: "Avg response time", unit: " ms", color: "var(--chart-1)" },
  latency: { label: "Response time", unit: " ms", color: "var(--chart-1)" },
  requests: { label: "Requests", unit: "", color: "var(--chart-1)" },
  errorRate: { label: "Error rate", unit: "%", color: "var(--chart-4)" },
  cpu: { label: "CPU utilization", unit: "%", color: "var(--chart-1)" },
};
const emptyDetail = {
  appLatency: "Connect the application to see real response times.",
  cpu: "Enter an EC2 instance ID on a service, or send CPU events.",
  requests: "Send request events using a service ingestion token.",
  errorRate: "Send request events using a service ingestion token.",
  latency: "Add a service and let the worker complete its first checks.",
};

export function MetricChart({ data, metric = "latency", height = 240 }) {
  const m = meta[metric];
  if (!data.some((d) => d[metric] !== null && d[metric] !== undefined))
    return (
      <EmptyState
        icon={Activity}
        title="No data yet"
        detail={emptyDetail[metric]}
      />
    );
  return (
    <ChartContainer
      config={{ [metric]: { label: m.label, color: m.color } }}
      className="w-full"
      style={{ height }}
    >
      <AreaChart data={data} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey="timestamp"
          tickLine={false}
          axisLine={false}
          minTickGap={56}
          tickMargin={8}
          tickFormatter={(v) =>
            new Date(v).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })
          }
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          width={44}
          tickFormatter={(v) => `${v}${m.unit.trim()}`}
        />
        <ChartTooltip
          content={
            <ChartTooltipContent
              labelFormatter={(_, p) => date(p?.[0]?.payload?.timestamp)}
              formatter={(v) => `${v}${m.unit}`}
            />
          }
        />
        <Area
          dataKey={metric}
          type="monotone"
          stroke={m.color}
          strokeWidth={1.5}
          fill={m.color}
          fillOpacity={0.06}
          connectNulls
          isAnimationActive={false}
        />
      </AreaChart>
    </ChartContainer>
  );
}
