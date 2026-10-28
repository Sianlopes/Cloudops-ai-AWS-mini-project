// Acme Shop: a small online store used to demonstrate CloudOps.
//
// It is instrumented like any real application: the CloudOps client middleware
// reports every API request (route, status, duration), and the app reports failed
// sign-ins and business events (orders placed, payment failures) as logs.
//
//   /           storefront (catalog, cart, sign-in, checkout, order history)
//   /control    presenter controls: connect to CloudOps, failure scenarios, simulations
//   /health     shallow health check that CloudOps probes
//
// Environment: PORT, HOST, CLOUDOPS_URL (default address), SHOP_STATE_FILE,
// CLOUDOPS_INGESTION_TOKEN (optional; the token is normally entered on /control).
import express from "express";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

// The very same file the CloudOps "Connect your application" guide gives customers
// (generated from it by scripts/sync-shop-client.mjs; a test keeps them identical).
const { cloudops, report, configure } = createRequire(import.meta.url)("./cloudops.cjs");

const PORT = Number(process.env.PORT) || 4100;
const self = `http://127.0.0.1:${PORT}`;
const stateFile = process.env.SHOP_STATE_FILE || "data/acme-shop-telemetry.json";
const defaultUrl = process.env.CLOUDOPS_URL || "http://127.0.0.1:4000";
const app = express();
app.use(express.json());

// ---- catalog, accounts, orders (in memory) --------------------------------
const products = [
  { id: 1, name: "Dot-grid notebook", category: "Stationery", price: 4.5, emoji: "📓", description: "A5, 120 pages of thick dot-grid paper." },
  { id: 2, name: "Gel pen set", category: "Stationery", price: 6, emoji: "🖊️", description: "Ten smooth gel pens in everyday colours." },
  { id: 3, name: "Everyday backpack", category: "Bags", price: 29, emoji: "🎒", description: "Water-resistant, with a padded laptop sleeve." },
  { id: 4, name: "Canvas tote", category: "Bags", price: 12, emoji: "👜", description: "Heavy cotton tote for books and groceries." },
  { id: 5, name: "Wireless headphones", category: "Audio", price: 59, emoji: "🎧", description: "Over-ear, 30-hour battery, quick charge." },
  { id: 6, name: "Bluetooth speaker", category: "Audio", price: 35, emoji: "🔊", description: "Pocket-sized speaker with deep bass." },
  { id: 7, name: "Steel water bottle", category: "Home", price: 12, emoji: "🧴", description: "Keeps drinks cold for 24 hours." },
  { id: 8, name: "Ceramic mug", category: "Home", price: 8, emoji: "☕", description: "350 ml stoneware mug, dishwasher safe." },
];
const accounts = { demo: "shop123", priya: "priya123" };
const sessions = new Map(); // session id -> username
const orders = []; // { id, user, items, total, at }
let nextOrder = 1001;

// ---- demo controls state ----------------------------------------------------
let scenario = "healthy"; // healthy | slow | payments | outage
let connection = null; // { url, tokenHint, connectedAt } while connected

function connect(url, token) {
  configure({ url, token });
  connection = { url, tokenHint: `${token.slice(0, 6)}…`, connectedAt: new Date().toISOString() };
}
function disconnect() {
  configure({ token: "" });
  connection = null;
}
try {
  const saved = JSON.parse(readFileSync(stateFile, "utf8"));
  connect(saved.url, saved.token);
} catch {
  if (process.env.CLOUDOPS_INGESTION_TOKEN)
    connect(defaultUrl, process.env.CLOUDOPS_INGESTION_TOKEN);
}
const log = (message, level = "info") => connection && report({ type: "log", message, level });

// ---- middleware ----------------------------------------------------------------
const controlPath = (p) =>
  ["/api/simulate", "/api/connect", "/api/control"].some((c) => p.startsWith(c));
// Report every customer-facing API request to CloudOps.
app.use((req, res, next) =>
  connection && req.path.startsWith("/api/") && !controlPath(req.path)
    ? cloudops(req, res, next)
    : next(),
);
// Failure scenarios apply to the shop's own API.
app.use("/api", async (req, res, next) => {
  if (controlPath(req.originalUrl)) return next();
  if (scenario === "slow") await new Promise((r) => setTimeout(r, 1500));
  if (scenario === "outage")
    return res.status(503).json({ error: "The shop is temporarily unavailable." });
  next();
});
// Realistic processing time, so the endpoints in CloudOps show believable latencies.
const work = (min, max) =>
  new Promise((r) => setTimeout(r, min + Math.random() * (max - min)));
const cookie = (req) =>
  Object.fromEntries(
    (req.headers.cookie || "").split(";").map((c) => c.trim().split("=").map(decodeURIComponent)),
  ).shop_session;
const user = (req) => sessions.get(cookie(req));

// ---- health ----------------------------------------------------------------------
// A deliberately shallow check: it reports components but only fails when the whole
// shop is down. A partial failure (payments) keeps answering 200.
app.get("/health", async (_req, res) => {
  if (scenario === "slow") await new Promise((r) => setTimeout(r, 1500));
  res.status(scenario === "outage" ? 503 : 200).json({
    status: scenario === "outage" ? "unavailable" : "ok",
    components: {
      catalog: scenario === "outage" ? "down" : "ok",
      payments: scenario === "payments" || scenario === "outage" ? "failing" : "ok",
    },
  });
});

// ---- shop API --------------------------------------------------------------------
app.get("/api/products", async (req, res) => {
  await work(8, 28);
  const { category } = req.query;
  res.json(category ? products.filter((p) => p.category === category) : products);
});
app.get("/api/products/:id", async (req, res) => {
  await work(5, 18);
  const p = products.find((p) => p.id === Number(req.params.id));
  if (!p) return res.status(404).json({ error: "Product not found." });
  res.json(p);
});
app.post("/api/login", async (req, res) => {
  await work(40, 95);
  const { username, password } = req.body || {};
  if (typeof username === "string" && accounts[username] === password) {
    const sid = randomBytes(18).toString("hex");
    sessions.set(sid, username);
    res.setHeader("Set-Cookie", `shop_session=${sid}; Path=/; HttpOnly; SameSite=Lax`);
    return res.json({ username });
  }
  if (connection)
    report({
    type: "auth_failure",
    subject: String(username || "unknown").slice(0, 100),
    message: "Sign-in rejected: wrong username or password",
    level: "warn",
  });
  res.status(401).json({ error: "Wrong username or password." });
});
app.post("/api/logout", (req, res) => {
  sessions.delete(cookie(req));
  res.setHeader("Set-Cookie", "shop_session=; Path=/; Max-Age=0");
  res.json({ ok: true });
});
app.get("/api/me", (req, res) => res.json({ username: user(req) || null }));
app.get("/api/orders", async (req, res) => {
  await work(12, 40);
  const u = user(req);
  if (!u) return res.status(401).json({ error: "Sign in to see your orders." });
  res.json(orders.filter((o) => o.user === u).slice().reverse());
});
app.post("/api/orders", async (req, res) => {
  await work(70, 190);
  const u = user(req);
  if (!u) return res.status(401).json({ error: "Sign in to check out." });
  const items = (Array.isArray(req.body?.items) ? req.body.items : [])
    .map((i) => ({ product: products.find((p) => p.id === Number(i.id)), qty: Math.floor(Number(i.qty)) }))
    .filter((i) => i.product && i.qty > 0 && i.qty <= 20);
  if (!items.length) return res.status(400).json({ error: "Your cart is empty." });
  const total = Number(items.reduce((n, i) => n + i.product.price * i.qty, 0).toFixed(2));
  if (scenario === "payments") {
    log(`Payment failed for ${u}: payment provider timed out ($${total.toFixed(2)})`, "error");
    return res.status(502).json({ error: "Payment failed. Our payment provider is not responding." });
  }
  const order = {
    id: nextOrder++,
    user: u,
    items: items.map((i) => ({ id: i.product.id, name: i.product.name, qty: i.qty, price: i.product.price })),
    total,
    at: new Date().toISOString(),
  };
  orders.push(order);
  log(`Order #${order.id} placed by ${u} ($${total.toFixed(2)})`);
  res.status(201).json(order);
});

// ---- presenter controls ------------------------------------------------------------
const scenarios = ["healthy", "slow", "payments", "outage"];
app.get("/scenario", (_req, res) =>
  res.json({ scenario, simulations: simStatus(), telemetry: connection }),
);
app.post("/scenario", (req, res) => {
  if (!scenarios.includes(req.body?.scenario))
    return res.status(400).json({ error: `Use one of: ${scenarios.join(", ")}.` });
  scenario = req.body.scenario;
  res.json({ scenario });
});
app.post("/api/connect", async (req, res) => {
  const token = String(req.body?.token || "").trim();
  const url = String(req.body?.url || defaultUrl).trim().replace(/\/+$/, "");
  if (!/^https?:\/\/[^\s]+$/.test(url))
    return res.status(400).json({ error: "CloudOps URL must start with http:// or https://" });
  if (token.length < 32)
    return res.status(400).json({ error: "Paste the full ingestion token from CloudOps." });
  try {
    const r = await fetch(`${url}/api/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ id: randomUUID(), type: "log", level: "info", message: "Acme Shop connected to CloudOps" }),
      signal: AbortSignal.timeout(8000),
    });
    if (r.status === 401)
      return res.status(400).json({ error: "CloudOps rejected this token. Copy a fresh one from the service panel." });
    if (!r.ok) return res.status(502).json({ error: `CloudOps answered HTTP ${r.status}.` });
  } catch {
    return res.status(502).json({ error: `Could not reach CloudOps at ${url}.` });
  }
  connect(url, token);
  try {
    mkdirSync(dirname(stateFile), { recursive: true });
    writeFileSync(stateFile, JSON.stringify({ url, token }), { mode: 0o600 });
  } catch (e) {
    console.error("Could not save the CloudOps connection:", e.message);
  }
  res.json({ message: "Connected. The shop now reports to CloudOps." });
});
app.delete("/api/connect", (_req, res) => {
  disconnect();
  rmSync(stateFile, { force: true });
  res.json({ message: "Disconnected. The shop no longer reports to CloudOps." });
});

// ---- simulations -------------------------------------------------------------------
// Simulated customers and attackers make real HTTP requests to the shop's own API, so
// the shop reports them to CloudOps exactly like real usage. Each one can be started
// and stopped on its own and has a safety time limit.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const call = (path, options = {}) =>
  fetch(`${self}${path}`, { ...options, signal: AbortSignal.timeout(10000) });
const sims = {
  traffic: { label: "Customer traffic", maxMs: 15 * 60000 },
  attack: { label: "Password-guessing attack", maxMs: 5 * 60000 },
};
for (const sim of Object.values(sims))
  Object.assign(sim, { running: false, cancelled: false, startedAt: 0, sent: 0, failed: 0 });
const simStatus = () =>
  Object.fromEntries(
    Object.entries(sims).map(([kind, s]) => [
      kind,
      {
        running: s.running,
        stopping: s.running && s.cancelled,
        elapsedMs: s.running ? Date.now() - s.startedAt : 0,
        sent: s.sent,
        failed: s.failed,
      },
    ]),
  );
const active = (s) => !s.cancelled && Date.now() - s.startedAt < s.maxMs;

async function customerSession() {
  const r = await call("/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "priya", password: "priya123" }),
  }).catch(() => null);
  return r?.headers.get("set-cookie")?.split(";")[0] || "";
}
const loops = {
  // Customers browsing, opening product pages, checking their orders and buying.
  async traffic(s) {
    let session = await customerSession();
    while (active(s)) {
      const roll = Math.random();
      const id = 1 + Math.floor(Math.random() * products.length);
      const headers = { "Content-Type": "application/json", Cookie: session };
      const request =
        roll < 0.45
          ? call("/api/products")
          : roll < 0.65
            ? call(`/api/products/${id}`)
            : roll < 0.9
              ? call("/api/orders", {
                  method: "POST",
                  headers,
                  body: JSON.stringify({ items: [{ id, qty: 1 + Math.floor(Math.random() * 2) }] }),
                })
              : call("/api/orders", { headers });
      s.sent++;
      request
        .then(async (r) => {
          if (r.status >= 500) s.failed++;
          if (r.status === 401) session = await customerSession();
        })
        .catch(() => s.failed++);
      await sleep(330);
    }
  },
  // Someone guessing passwords for one account.
  async attack(s) {
    for (let n = 0; active(s); n++) {
      s.sent++;
      await call("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "admin", password: `guess-${n}` }),
      }).catch(() => s.failed++);
      await sleep(500);
    }
  },
};
function startSim(kind) {
  const s = sims[kind];
  if (s.running) return false;
  Object.assign(s, { running: true, cancelled: false, startedAt: Date.now(), sent: 0, failed: 0 });
  loops[kind](s)
    .catch((e) => console.error(`${s.label} ended with an error:`, e.message))
    .finally(() => (s.running = false)); // always reset, whatever happened
  return true;
}
app.post("/api/simulate/stop-all", (_req, res) => {
  for (const s of Object.values(sims)) s.cancelled = true;
  res.json({ message: "Stopping all simulations." });
});
app.post("/api/simulate/:kind/:action", (req, res) => {
  const { kind, action } = req.params;
  const s = sims[kind];
  if (!s) return res.status(404).json({ error: "Unknown simulation." });
  if (action === "start") {
    if (!startSim(kind)) return res.status(409).json({ error: `${s.label} is already running.` });
    return res.json({ message: `${s.label} started.` });
  }
  if (action === "stop") {
    s.cancelled = true;
    return res.json({ message: s.running ? `${s.label} stopping…` : `${s.label} is not running.` });
  }
  res.status(400).json({ error: "Use start or stop." });
});

// ---- pages -----------------------------------------------------------------------
app.get("/api/control/defaults", (_req, res) => res.json({ url: defaultUrl }));
app.use(
  express.static(fileURLToPath(new URL("./public/", import.meta.url)), {
    extensions: ["html"],
  }),
);

app.listen(PORT, process.env.HOST || "127.0.0.1", () =>
  console.log(`Acme Shop listening on ${PORT}; telemetry ${connection ? "on" : "off"}`),
);
