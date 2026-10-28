// Copy-paste integration code shown in the "Connect your application" guide.
// Plain strings only (no imports), so they can also be executed in tests.
export function integrationSnippets({ url, token }) {
  const t = token || "YOUR_INGESTION_TOKEN";

  const nodeFile = `// cloudops.js: reports this app's requests and events to CloudOps.
const { randomUUID } = require("node:crypto");

let CLOUDOPS_URL = process.env.CLOUDOPS_URL || "${url}";
let TOKEN = process.env.CLOUDOPS_INGESTION_TOKEN;
const queue = [];
let sending = false;

async function flush() {
  if (sending || !TOKEN) return;
  sending = true;
  try {
    while (queue.length) {
      const res = await fetch(\`\${CLOUDOPS_URL}/api/events\`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: \`Bearer \${TOKEN}\` },
        body: JSON.stringify(queue[0]),
        signal: AbortSignal.timeout(5000),
      });
      if (res.status >= 500) break; // CloudOps is busy: retry later
      queue.shift(); // delivered (or rejected, so drop it)
    }
  } catch {
    // network problem: retry on the next tick
  }
  sending = false;
}
setInterval(flush, 1000).unref();

// Optional: set the address and token in code instead of environment variables.
function configure({ url, token }) {
  if (url) CLOUDOPS_URL = url;
  TOKEN = token;
}

// Report anything that happens in your app.
function report(event) {
  if (queue.length < 1000) queue.push({ id: randomUUID(), level: "info", ...event });
}

// Express middleware: reports every request's endpoint, status code and duration.
function cloudops(req, res, next) {
  const start = Date.now();
  res.on("finish", () => {
    // "/api/products/:id" rather than "/api/products/42", so endpoints group together.
    const route = req.route ? req.baseUrl + req.route.path : "(unmatched)";
    report({
      type: "request",
      method: req.method,
      route,
      statusCode: res.statusCode,
      duration: Date.now() - start,
      level: res.statusCode >= 500 ? "error" : "info",
      message: \`\${req.method} \${route}\`,
    });
  });
  next();
}

module.exports = { cloudops, report, configure };`;

  const nodeUsage = `const { cloudops, report } = require("./cloudops");

app.use(cloudops); // 1. reports every request (add before your routes)

// 2. report a failed sign-in (CloudOps alerts on repeated failures per account)
report({ type: "auth_failure", subject: username, level: "warn", message: "Sign-in rejected" });

// 3. optional: report any business event or error
report({ type: "log", message: "Order 1042 placed" });`;

  const pythonFile = `# cloudops.py: reports this app's requests and events to CloudOps (standard library only).
import json, os, queue, threading, time, urllib.error, urllib.request, uuid

CLOUDOPS_URL = os.environ.get("CLOUDOPS_URL", "${url}")
TOKEN = os.environ.get("CLOUDOPS_INGESTION_TOKEN")
_events = queue.Queue(maxsize=1000)


def report(**event):
    """Report anything that happens in your app."""
    event.setdefault("id", str(uuid.uuid4()))
    event.setdefault("level", "info")
    try:
        _events.put_nowait(event)
    except queue.Full:
        pass


def _sender():
    while True:
        event = _events.get()
        while TOKEN:
            try:
                request = urllib.request.Request(
                    f"{CLOUDOPS_URL}/api/events",
                    data=json.dumps(event).encode(),
                    headers={"Content-Type": "application/json", "Authorization": f"Bearer {TOKEN}"},
                )
                urllib.request.urlopen(request, timeout=5).close()
                break
            except urllib.error.HTTPError as error:
                if error.code < 500:
                    break  # rejected: drop it
                time.sleep(2)  # CloudOps is busy: retry
            except Exception:
                time.sleep(2)  # network problem: retry


threading.Thread(target=_sender, daemon=True).start()


def init_flask(app):
    """Flask: reports every request's route, status code and duration."""
    from flask import g, request

    @app.before_request
    def _start():
        g.cloudops_start = time.time()

    @app.after_request
    def _finish(response):
        # "/api/products/<id>" rather than "/api/products/42", so endpoints group together.
        route = request.url_rule.rule if request.url_rule else "(unmatched)"
        report(
            type="request",
            method=request.method,
            route=route,
            statusCode=response.status_code,
            duration=int((time.time() - g.cloudops_start) * 1000),
            level="error" if response.status_code >= 500 else "info",
            message=f"{request.method} {route}",
        )
        return response`;

  const pythonUsage = `from cloudops import init_flask, report

init_flask(app)  # 1. reports every request (Flask)

# 2. report a failed sign-in (CloudOps alerts on repeated failures per account)
report(type="auth_failure", subject=username, level="warn", message="Sign-in rejected")

# 3. optional: report any business event or error
report(type="log", message="Order 1042 placed")`;

  const curl = `curl -X POST ${url}/api/events \\
  -H "Authorization: Bearer ${t}" \\
  -H "Content-Type: application/json" \\
  -d '{"id":"evt-0001-unique","type":"request","method":"POST","route":"/api/orders","statusCode":503,"duration":120,"level":"error","message":"POST /api/orders"}'`;

  return {
    env: `CLOUDOPS_INGESTION_TOKEN=${t}\nCLOUDOPS_URL=${url}`,
    node: { file: nodeFile, usage: nodeUsage },
    python: { file: pythonFile, usage: pythonUsage },
    curl,
  };
}

export const eventTypes = [
  ["request", "method, route, statusCode, duration (ms), message", "Builds the per-endpoint view and the API error rate rule"],
  ["auth_failure", "subject (account id), message", "Alerts on repeated failed sign-ins for one account"],
  ["cpu", "value (0 to 100), message", "Sustained high CPU rule"],
  ["log", "message", "Stored and searchable under Logs"],
];
