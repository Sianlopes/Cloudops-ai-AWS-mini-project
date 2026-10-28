import { useEffect, useState } from "react";
import { Check, ChevronDown, Copy, KeyRound, Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { eventTypes, integrationSnippets } from "@/lib/snippets";
import { since } from "@/lib/format";
import { copyText, eventId } from "@/lib/clipboard";
import { cn } from "@/lib/utils";

const PREVIEW_LINES = 12;

// A code block with a title bar (name + Copy). Long files start collapsed.
function Code({ children, name, wrap = false }) {
  const [copied, setCopied] = useState(false);
  const lines = children.split("\n").length;
  const long = lines > PREVIEW_LINES + 4;
  const [open, setOpen] = useState(!long);
  return (
    <div className="overflow-hidden rounded-md border">
      <div className="flex items-center justify-between border-b bg-muted/60 px-3 py-1.5">
        <span className="font-mono text-xs text-muted-foreground">{name}</span>
        <Button
          variant="ghost"
          size="xs"
          onClick={async () => {
            try {
              await copyText(children);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            } catch {
              toast.error("Select the code and copy it manually.");
            }
          }}
        >
          {copied ? <Check /> : <Copy />}
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      <div className="relative">
        <pre
          className={cn(
            "bg-muted/30 p-3 font-mono text-xs leading-relaxed",
            wrap
              ? "break-all whitespace-pre-wrap"
              : "overflow-x-auto whitespace-pre",
            !open && "max-h-52 overflow-hidden",
          )}
        >
          {children}
        </pre>
        {!open && (
          <div className="absolute inset-x-0 bottom-0 flex h-20 items-end justify-center bg-gradient-to-t from-background to-transparent pb-2">
            <Button variant="outline" size="xs" onClick={() => setOpen(true)}>
              <ChevronDown /> Show all {lines} lines
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
function Step({ n, title, children }) {
  return (
    <section className="flex min-w-0 gap-3">
      <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-medium">
        {n}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-2.5">
        <h3 className="text-sm font-medium">{title}</h3>
        {children}
      </div>
    </section>
  );
}
const Note = ({ children }) => (
  <p className="text-sm text-muted-foreground">{children}</p>
);

export function IntegrationDialog({
  service,
  token,
  busy,
  onNewToken,
  onClose,
  onRefresh,
}) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 5000);
    return () => clearInterval(t);
  }, []);
  const url = window.location.origin;
  const code = integrationSnippets({ url, token });
  const last = service.lastEventAt ? new Date(service.lastEventAt) : null;
  const live = last && Date.now() - last < 5 * 60000;

  async function sendTest() {
    try {
      const res = await fetch("/api/events", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          id: eventId("test"),
          type: "log",
          level: "info",
          message: "Test event from the CloudOps integration guide",
        }),
      });
      if (!res.ok) throw Error(`CloudOps answered HTTP ${res.status}`);
      toast.success("Test event sent.");
      setTimeout(onRefresh, 2500);
    } catch (e) {
      toast.error(e.message);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[90vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl">
        {/* fixed top: title and connection status */}
        <div className="flex flex-col gap-4 border-b p-6">
          <DialogHeader className="pr-8">
            <DialogTitle>Connect {service.name}</DialogTitle>
            <DialogDescription>
              Health checks only tell you whether the service is up. Add this
              code to the application itself and CloudOps also sees every
              request, error and failed sign-in.
            </DialogDescription>
          </DialogHeader>
          <div
            className={cn(
              "flex items-center gap-3 rounded-md border px-3 py-2 text-sm",
              live && "border-success/40 bg-success/5",
            )}
          >
            <span
              className={cn(
                "size-2 shrink-0 rounded-full",
                live ? "bg-success" : "bg-muted-foreground/50",
              )}
            />
            <span className="min-w-0 flex-1">
              {live ? (
                <>
                  <strong className="font-medium">Connected.</strong> Last
                  event {since(last).toLowerCase()}.
                </>
              ) : last ? (
                <>No events recently. The last one arrived {since(last)}.</>
              ) : (
                <>Waiting for the first event from your application…</>
              )}
            </span>
            {token && (
              <Button variant="outline" size="sm" onClick={sendTest}>
                <Send /> Send test event
              </Button>
            )}
          </div>
        </div>

        {/* the only scrolling area */}
        <div className="flex min-h-0 flex-1 flex-col gap-7 overflow-y-auto p-6">
          <Step n={1} title="Your ingestion token">
            {token ? (
              <>
                <Code name="token" wrap>
                  {token}
                </Code>
                <Note>
                  Copy it now: it's shown only once. Keep it in your server's
                  environment variables and never in browser code or Git.
                </Note>
              </>
            ) : (
              <div className="flex flex-wrap items-center gap-3">
                <Note>
                  The token is only shown when it's created.{" "}
                  {service.hasToken
                    ? "Creating a new one stops the old one working."
                    : "This service has no token yet."}
                </Note>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={onNewToken}
                >
                  <KeyRound />{" "}
                  {service.hasToken ? "Create a new token" : "Create token"}
                </Button>
              </div>
            )}
          </Step>

          <Step n={2} title="Set environment variables on your server">
            <Code name=".env" wrap>
              {code.env}
            </Code>
          </Step>

          <Step n={3} title="Add the code to your application">
            <Tabs defaultValue="node" className="min-w-0 gap-3">
              <TabsList>
                <TabsTrigger value="node">Node.js (Express)</TabsTrigger>
                <TabsTrigger value="python">Python (Flask)</TabsTrigger>
                <TabsTrigger value="curl">Any language (HTTP)</TabsTrigger>
              </TabsList>
              <TabsContent value="node" className="flex flex-col gap-3">
                <Note>
                  Save this file in your project (Node 18+, no dependencies). If
                  your project uses ES modules (<code className="font-mono">"type": "module"</code>),
                  name it <code className="font-mono">cloudops.cjs</code>.
                </Note>
                <Code name="cloudops.js">{code.node.file}</Code>
                <Note>Then use it in your app:</Note>
                <Code name="app.js">{code.node.usage}</Code>
              </TabsContent>
              <TabsContent value="python" className="flex flex-col gap-3">
                <Note>Save this file in your project (standard library only).</Note>
                <Code name="cloudops.py">{code.python.file}</Code>
                <Note>Then use it in your app:</Note>
                <Code name="app.py">{code.python.usage}</Code>
              </TabsContent>
              <TabsContent value="curl" className="flex flex-col gap-3">
                <Note>
                  Any language can report events with one HTTP request. Each
                  event needs a unique <code className="font-mono">id</code>, a{" "}
                  <code className="font-mono">type</code> and a{" "}
                  <code className="font-mono">message</code>.
                </Note>
                <Code name="terminal" wrap>
                  {code.curl}
                </Code>
                <div className="overflow-hidden rounded-md border text-xs">
                  <div className="grid grid-cols-[92px_1fr] gap-x-3 border-b bg-muted/60 px-3 py-1.5 font-medium text-muted-foreground sm:grid-cols-[92px_1fr_1.2fr]">
                    <span>Event type</span>
                    <span>Fields</span>
                    <span className="hidden sm:block">What it does</span>
                  </div>
                  {eventTypes.map(([type, fields, effect]) => (
                    <div
                      key={type}
                      className="grid grid-cols-[92px_1fr] gap-x-3 gap-y-0.5 border-b px-3 py-2 last:border-0 sm:grid-cols-[92px_1fr_1.2fr]"
                    >
                      <code className="font-mono font-medium">{type}</code>
                      <span className="text-muted-foreground">{fields}</span>
                      <span className="col-span-2 sm:col-span-1">{effect}</span>
                    </div>
                  ))}
                </div>
              </TabsContent>
            </Tabs>
          </Step>

          <Step n={4} title="Check the connection">
            <Note>
              Use your application normally. The status bar at the top turns
              green when the first event arrives, and requests, errors and
              failed sign-ins appear under Metrics, Logs and Incidents.
            </Note>
          </Step>
        </div>
      </DialogContent>
    </Dialog>
  );
}
