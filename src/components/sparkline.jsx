export function Sparkline({ values, color = "var(--chart-1)", height = 48 }) {
  const pts = values.filter((v) => typeof v === "number");
  if (pts.length < 2)
    return (
      <p className="text-sm text-muted-foreground">Not enough data yet.</p>
    );
  const w = 300,
    h = height;
  const min = Math.min(...pts),
    max = Math.max(...pts),
    span = max - min || 1;
  const line = pts
    .map(
      (v, i) =>
        `${i ? "L" : "M"}${((i / (pts.length - 1)) * w).toFixed(1)} ${(h - 3 - ((v - min) / span) * (h - 6)).toFixed(1)}`,
    )
    .join(" ");
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      style={{ height, width: "100%" }}
      aria-hidden
    >
      <path
        d={line}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
