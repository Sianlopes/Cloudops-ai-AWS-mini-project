import { useState } from "react";
import {
  ArrowRight,
  Check,
  CheckCheck,
  Copy,
  KeyRound,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import { StatusBadge } from "@/components/status-badge";
import { date } from "@/lib/format";
import { copyText } from "@/lib/clipboard";

function Field({ label, id, hint, children }) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
function Detail({ label, children }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium">{children}</dd>
    </div>
  );
}

export function ServiceFormDialog({ onClose, busy, onSave }) {
  const [cpu, setCpu] = useState(false);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[92vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-lg">
        <DialogHeader className="p-6 pr-14 pb-4">
          <DialogTitle>Add a service</DialogTitle>
          <DialogDescription>
            Register an endpoint. The worker starts checking it automatically.
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(e) => {
            e.preventDefault();
            const { connect, ...f } = Object.fromEntries(
              new FormData(e.currentTarget),
            );
            onSave(
              {
                ...f,
                intervalSeconds: Number(f.intervalSeconds),
                timeoutMs: Number(f.timeoutMs),
                expectedStatus: Number(f.expectedStatus),
              },
              connect === "on",
            );
          }}
        >
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto border-t px-6 py-4">
          <Field label="Service name" id="name">
            <Input
              id="name"
              name="name"
              placeholder="e.g. Customer API"
              maxLength={80}
              required
            />
          </Field>
          <Field label="Health-check URL" id="endpoint">
            <Input
              id="endpoint"
              name="endpoint"
              type="url"
              placeholder="https://api.example.com/health"
              required
            />
          </Field>
          <Field label="Description" id="description">
            <Input
              id="description"
              name="description"
              placeholder="What does this service do?"
              maxLength={300}
            />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Check interval (seconds)" id="intervalSeconds">
              <Input
                id="intervalSeconds"
                name="intervalSeconds"
                type="number"
                min={15}
                max={3600}
                defaultValue={60}
                required
              />
            </Field>
            <Field label="Timeout (ms)" id="timeoutMs">
              <Input
                id="timeoutMs"
                name="timeoutMs"
                type="number"
                min={1000}
                max={30000}
                defaultValue={5000}
                required
              />
            </Field>
            <Field
              label="Expected HTTP status"
              id="expectedStatus"
              hint="Usually 200. A check fails on any other code."
            >
              <Input
                id="expectedStatus"
                name="expectedStatus"
                type="number"
                min={100}
                max={599}
                defaultValue={200}
                required
              />
            </Field>
          </div>
          <div className="rounded-md border">
            <button
              type="button"
              onClick={() => setCpu((v) => !v)}
              aria-expanded={cpu}
              className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left"
            >
              <span>
                <span className="block text-sm font-medium">
                  CPU monitoring{" "}
                  <span className="font-normal text-muted-foreground">
                    (optional)
                  </span>
                </span>
                <span className="block text-xs text-muted-foreground">
                  Only for services running on an EC2 instance in this AWS
                  account. Skip for other websites and APIs.
                </span>
              </span>
              <Plus
                className={`size-4 shrink-0 text-muted-foreground transition-transform ${cpu ? "rotate-45" : ""}`}
              />
            </button>
            {cpu && (
              <div className="grid grid-cols-2 gap-4 border-t px-3 py-3">
                <Field
                  label="EC2 instance ID"
                  id="instanceId"
                  hint="CloudOps reads this instance's CPU from CloudWatch."
                >
                  <Input
                    id="instanceId"
                    name="instanceId"
                    placeholder="i-0123456789abcdef0"
                    pattern="i-[a-f0-9]{8,17}"
                    title="An EC2 instance ID, for example i-0123456789abcdef0"
                    required
                  />
                </Field>
                <Field
                  label="Instance region"
                  id="region"
                  hint="Where that instance runs."
                >
                  <Select name="region" defaultValue="ap-south-1">
                    <SelectTrigger id="region" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ap-south-1">ap-south-1 (Mumbai)</SelectItem>
                      <SelectItem value="us-east-1">us-east-1 (N. Virginia)</SelectItem>
                      <SelectItem value="eu-west-1">eu-west-1 (Ireland)</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
              </div>
            )}
          </div>
          <label className="flex cursor-pointer items-start gap-2.5 text-sm">
            <input
              type="checkbox"
              name="connect"
              className="mt-0.5 size-4 accent-foreground"
            />
            <span>
              <span className="font-medium">Connect my application</span>
              <span className="block text-xs text-muted-foreground">
                Also create an ingestion token and show the code to add to your
                app, so CloudOps sees its requests, errors and failed sign-ins.
                Skip for websites you don't own.
              </span>
            </span>
          </label>
          <p className="text-xs text-muted-foreground">
            Only public URLs can be monitored. Private and internal addresses
            are blocked.
          </p>
          </div>
          <DialogFooter className="border-t px-6 py-4">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button disabled={busy}>
              <Plus /> Add service
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function TokenDialog({ token, onClose }) {
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Service ingestion token</DialogTitle>
          <DialogDescription>
            Copy this token now. It is shown once, and creating another
            invalidates it.
          </DialogDescription>
        </DialogHeader>
        <div className="rounded-md bg-muted p-3 font-mono text-sm break-all">
          {token}
        </div>
        <p className="text-xs text-muted-foreground">
          Keep it in your monitored application's environment and send it as
          Authorization: Bearer TOKEN to POST /api/events. Never include it in
          browser code.
        </p>
        <DialogFooter>
          <Button
            onClick={async () => {
              try {
                await copyText(token);
                toast.success("Token copied.");
              } catch {
                toast.error("Select and copy the token manually.");
              }
            }}
          >
            <Copy /> Copy token
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function RuleDialog({ rule: r, busy, act, onClose }) {
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit {r.name.toLowerCase()}</DialogTitle>
          <DialogDescription>
            Changes apply to future checks and events.
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            act(
              `rules/${r.id}`,
              { threshold: Number(new FormData(e.currentTarget).get("threshold")) },
              "PATCH",
            );
          }}
        >
          <Field label="Threshold" id="threshold" hint={r.unit}>
            <Input
              id="threshold"
              name="threshold"
              type="number"
              defaultValue={r.threshold}
              min={1}
              max={["cpu", "errorRate"].includes(r.metric) ? 100 : 100000}
              step={["failures", "authFailures"].includes(r.metric) ? 1 : "any"}
              required
            />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button disabled={busy}>Save threshold</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const steps = [
  [
    "Register an endpoint",
    "Add a public HTTP(S) health-check URL. CloudOps requests it on a schedule and records status and latency.",
  ],
  [
    "Detect problems",
    "Rules open an incident after repeated failures or unusual latency. Create an ingestion token to also report request errors, failed logins and CPU from inside your app.",
  ],
  [
    "Get alerted and recover",
    "Incidents are queued through SQS, processed by Lambda, stored in RDS and emailed through SNS. Two healthy checks resolve availability and latency incidents automatically.",
  ],
];

export function GuideDialog({ onClose, onAdd }) {
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Getting started</DialogTitle>
          <DialogDescription>
            From health checks to actionable incidents.
          </DialogDescription>
        </DialogHeader>
        <ol className="flex flex-col gap-4">
          {steps.map(([title, text], n) => (
            <li key={title} className="flex gap-3">
              <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold">
                {n + 1}
              </span>
              <div>
                <h3 className="text-sm font-medium">{title}</h3>
                <p className="text-sm text-muted-foreground">{text}</p>
              </div>
            </li>
          ))}
        </ol>
        <DialogFooter>
          <Button onClick={onAdd}>
            Add a service <ArrowRight />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
