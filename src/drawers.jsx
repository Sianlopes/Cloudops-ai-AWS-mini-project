import { Check, CheckCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { StatusBadge } from "@/components/status-badge";
import { date } from "@/lib/format";

function Field({ label, children }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-sm font-medium tabular">{children}</dd>
    </div>
  );
}
function Block({ title, children }) {
  return (
    <div>
      <h3 className="mb-2 text-xs font-medium text-muted-foreground">
        {title}
      </h3>
      {children}
    </div>
  );
}

export function IncidentDrawer({ incident: i, serviceName, busy, act, onClose }) {
  const set = (status) => act(`incidents/${i.id}`, { status }, "PATCH", false);
  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full gap-0 overflow-y-auto p-0 sm:max-w-md">
        <SheetHeader className="gap-1 border-b p-5">
          <SheetTitle className="leading-snug">{i.title}</SheetTitle>
          <SheetDescription className="font-mono text-xs">{i.id}</SheetDescription>
          <div className="mt-2 flex gap-2">
            <StatusBadge value={i.severity} />
            <StatusBadge value={i.status} />
          </div>
        </SheetHeader>
        <div className="flex flex-col gap-6 p-5">
          <dl className="grid grid-cols-2 gap-4">
            <Field label="Service">{serviceName(i.serviceId)}</Field>
            <Field label="Detected">{date(i.detectedAt)}</Field>
            <Field label="Last updated">{date(i.updatedAt)}</Field>
            <Field label="Detection">Monitoring rule</Field>
          </dl>
          <Block title="Evidence">
            <p className="rounded-md border bg-muted/50 px-3 py-2 text-sm">
              {i.evidence}
            </p>
          </Block>
          <Block title="Timeline">
            <ol className="flex flex-col gap-3 border-l pl-4">
              {i.timeline.map((t, n) => (
                <li key={n} className="relative">
                  <span className="absolute top-1.5 -left-[21px] size-2 rounded-full border-2 border-background bg-foreground" />
                  <div className="text-sm">{t.text}</div>
                  <div className="text-xs text-muted-foreground">
                    {date(t.at)}
                  </div>
                </li>
              ))}
            </ol>
          </Block>
          <div className="flex flex-wrap gap-2 border-t pt-5">
            {i.status === "open" && (
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => set("acknowledged")}
              >
                <Check /> Acknowledge
              </Button>
            )}
            {i.status !== "resolved" ? (
              <Button size="sm" disabled={busy} onClick={() => set("resolved")}>
                <CheckCheck /> Resolve
              </Button>
            ) : (
              <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <CheckCheck className="size-4 text-success" /> Resolved
              </span>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
