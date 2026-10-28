import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Section } from "@/components/section";
import { cn } from "@/lib/utils";

const good = ["configured", "Running", "postgresql", "sqlite", "local"];

export function SettingsPage({ data, busy, save, retry, archive }) {
  const rows = [
    ["Database", data.storage === "postgresql" ? "Amazon RDS (PostgreSQL)" : "SQLite (local)", true],
    ["Incident queue", data.integrations.queue === "configured" ? "Amazon SQS" : "Local", true],
    ["Email alerts", data.integrations.alerts === "configured" ? "Amazon SNS" : "Not configured", good.includes(data.integrations.alerts)],
    ["Log archives", data.integrations.archives === "configured" ? "Amazon S3" : "Not configured", good.includes(data.integrations.archives)],
    ["CPU metrics", data.integrations.cloudwatch === "configured" ? "Amazon CloudWatch" : "Not configured", good.includes(data.integrations.cloudwatch)],
    ["Monitoring worker", data.worker.healthy ? "Running" : "Heartbeat missing", data.worker.healthy],
  ];
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Section title="Workspace" description="General preferences">
        <form
          className="flex flex-col gap-4 p-4"
          onSubmit={(e) => {
            e.preventDefault();
            const f = Object.fromEntries(new FormData(e.currentTarget));
            save({ ...f, retention: Number(f.retention) });
          }}
        >
          <div className="flex flex-col gap-2">
            <Label htmlFor="workspace">Workspace name</Label>
            <Input
              id="workspace"
              name="workspace"
              defaultValue={data.settings.workspace}
              maxLength={80}
              required
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="email">Contact email</Label>
            <Input
              id="email"
              name="email"
              type="email"
              defaultValue={data.settings.email}
              placeholder="admin@example.com"
            />
            <p className="text-xs text-muted-foreground">
              Alert emails go to confirmed SNS subscribers.
            </p>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="retention">Log retention</Label>
            <Select
              name="retention"
              defaultValue={String(data.settings.retention)}
            >
              <SelectTrigger id="retention" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7">7 days</SelectItem>
                <SelectItem value="30">30 days</SelectItem>
                <SelectItem value="90">90 days</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Older checks and logs are removed. Incidents are kept.
            </p>
          </div>
          <Button className="self-start" disabled={busy}>
            Save
          </Button>
        </form>
      </Section>
      <div className="flex flex-col gap-4">
        <Section title="Integrations" description="Where each part of CloudOps runs">
          <ul className="divide-y">
            {rows.map(([label, value, ok]) => (
              <li
                key={label}
                className="flex items-center justify-between gap-4 px-4 py-3 text-sm"
              >
                <span className="text-muted-foreground">{label}</span>
                <span className="flex items-center gap-2">
                  <span
                    className={cn(
                      "size-1.5 rounded-full",
                      ok ? "bg-success" : "bg-warning",
                    )}
                  />
                  {value}
                </span>
              </li>
            ))}
          </ul>
          {data.integrations.archives === "configured" && (
            <div className="flex items-center justify-between gap-4 border-t px-4 py-3">
              <p className="text-xs text-muted-foreground">
                Logs are archived to S3 automatically each day. Archive the
                last 24 hours now:
              </p>
              <Button variant="outline" size="sm" disabled={busy} onClick={archive}>
                Archive to S3
              </Button>
            </div>
          )}
        </Section>
        <Section title="Recent deliveries" description="Queue messages and alert emails">
          <ul className="max-h-64 divide-y overflow-y-auto">
            {data.deliveries.length ? (
              data.deliveries.map((d) => (
                <li
                  key={d.id}
                  className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm"
                >
                  <span className="min-w-0">
                    <span className="block">
                      {d.kind === "signal" ? "Queue message" : "Alert email"}{" "}
                      <span className="text-muted-foreground">· {d.status}</span>
                    </span>
                    {d.lastError && (
                      <span className="block truncate text-xs text-muted-foreground">
                        {d.lastError}
                      </span>
                    )}
                  </span>
                  {d.status === "failed" && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      onClick={() => retry(d.id)}
                    >
                      Retry
                    </Button>
                  )}
                </li>
              ))
            ) : (
              <li className="px-4 py-6 text-sm text-muted-foreground">
                Nothing delivered yet.
              </li>
            )}
          </ul>
        </Section>
      </div>
    </div>
  );
}
