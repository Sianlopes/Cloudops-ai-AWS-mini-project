// cloudops.js: reports this app's requests and events to CloudOps.
const { randomUUID } = require("node:crypto");

let CLOUDOPS_URL = process.env.CLOUDOPS_URL || "http://127.0.0.1:4000";
let TOKEN = process.env.CLOUDOPS_INGESTION_TOKEN;
const queue = [];
let sending = false;

async function flush() {
  if (sending || !TOKEN) return;
  sending = true;
  try {
    while (queue.length) {
      const res = await fetch(`${CLOUDOPS_URL}/api/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` },
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
      message: `${req.method} ${route}`,
    });
  });
  next();
}

module.exports = { cloudops, report, configure };
