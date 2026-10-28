import { cn } from "@/lib/utils";

const label = {
  healthy: "Healthy",
  degraded: "Degraded",
  unhealthy: "Down",
  pending: "Pending",
  paused: "Paused",
  open: "Open",
  acknowledged: "Acknowledged",
  resolved: "Resolved",
  critical: "Critical",
  high: "High",
  warning: "Warning",
};
const dot = {
  healthy: "bg-success",
  resolved: "bg-success",
  degraded: "bg-warning",
  warning: "bg-warning",
  high: "bg-warning",
  acknowledged: "bg-muted-foreground",
  unhealthy: "bg-danger",
  critical: "bg-danger",
  open: "bg-danger",
  pending: "bg-muted-foreground/50",
  paused: "bg-muted-foreground/50",
};

export function StatusDot({ value, className }) {
  return (
    <span
      className={cn(
        "inline-block size-2 shrink-0 rounded-full",
        dot[value] || "bg-muted-foreground/50",
        className,
      )}
    />
  );
}

export function StatusBadge({ value, className }) {
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center gap-1.5 rounded-md border px-2 text-xs font-medium text-foreground",
        className,
      )}
    >
      <StatusDot value={value} className="size-1.5" />
      {label[value] || value}
    </span>
  );
}
