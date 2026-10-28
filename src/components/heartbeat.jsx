import { cn } from "@/lib/utils";

// Strip of recent health checks: green passed, red failed, grey no data.
export function Heartbeat({ history = [], count = 30, className, height = 20 }) {
  const recent = history.slice(-count);
  const slots = [
    ...Array.from({ length: count - recent.length }, () => null),
    ...recent,
  ];
  return (
    <div
      className={cn("flex items-stretch gap-[2px]", className)}
      style={{ height }}
      role="img"
      aria-label="Recent health checks"
    >
      {slots.map((c, i) => (
        <span
          key={i}
          title={
            c
              ? `${c.ok ? "Passed" : "Failed"} · ${c.latency} ms · ${new Date(c.at).toLocaleTimeString()}`
              : "No data"
          }
          className={cn(
            "min-w-[3px] flex-1 rounded-[2px]",
            !c && "bg-muted",
            c?.ok && "bg-success",
            c && !c.ok && "bg-danger",
          )}
        />
      ))}
    </div>
  );
}
