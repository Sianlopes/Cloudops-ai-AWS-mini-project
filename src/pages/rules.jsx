import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Section } from "@/components/section";
import { StatusBadge } from "@/components/status-badge";
import { cn } from "@/lib/utils";

export function RulesPage({ rules, busy, toggle, edit }) {
  return (
    <div className="flex flex-col gap-4">
      <p className="max-w-3xl text-sm text-muted-foreground">
        Rules turn checks and application events into incidents. Availability
        and latency incidents resolve automatically after two healthy checks.
      </p>
      <Section>
        <ul className="divide-y">
          {rules.map((r) => (
            <li
              key={r.id}
              className={cn(
                "flex flex-wrap items-center gap-4 px-4 py-4 sm:flex-nowrap",
                !r.enabled && "opacity-60",
              )}
            >
              <Switch
                checked={!!r.enabled}
                disabled={busy}
                aria-label={`Enable ${r.name}`}
                onCheckedChange={(enabled) => toggle(r.id, enabled)}
              />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">{r.name}</div>
                <div className="text-sm text-muted-foreground">
                  {r.description}
                </div>
              </div>
              <div className="w-48 text-sm">
                <span className="font-medium tabular">{r.threshold}</span>{" "}
                <span className="text-muted-foreground">{r.unit}</span>
              </div>
              <StatusBadge value={r.severity} className="w-24 justify-center" />
              <Button variant="outline" size="sm" onClick={() => edit(r.id)}>
                Edit
              </Button>
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}
