import express from "express";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { randomUUID, randomBytes } from "node:crypto";
import { openDatabase } from "./db.js";
import {
  audit,
  bootstrapAdmin,
  constantEqual,
  createAdmin,
  credentials,
  hash,
  newSession,
  passwordMatches,
  sessionFor,
  setSessionCookie,
} from "./auth.js";
import { validateEndpoint } from "./network.js";
import { enqueue, iso } from "./domain.js";
import { integrationStatus, loadParameters } from "./integrations.js";
import { workspace } from "./workspace.js";
import { archiveNow, startWorker } from "./worker.js";
import { serviceInsights } from "./insights.js";
function fail(message, status = 400) {
  throw Object.assign(Error(message), { status });
}
const validEmail = (email) =>
  typeof email === "string" &&
  email.length <= 254 &&
  (!email || /^\S+@\S+\.\S+$/.test(email));
const number = (v, min, max, integer = true) =>
  typeof v === "number" &&
  Number.isFinite(v) &&
  v >= min &&
  v <= max &&
  (!integer || Number.isInteger(v));
export function createApp(
  db,
  { production = process.env.NODE_ENV === "production" } = {},
) {
  const app = express();
  // Demo deployments without a domain/certificate run over plain HTTP.
  const insecureHttp = process.env.ALLOW_INSECURE_HTTP === "true";
  const secureCookies = production && !insecureHttp;
  app.disable("x-powered-by");
  if (process.env.TRUST_PROXY === "1") app.set("trust proxy", 1);
  app.use(
    helmet({
      contentSecurityPolicy: production
        ? {
            directives: {
              defaultSrc: ["'self'"],
              scriptSrc: ["'self'"],
              styleSrc: [
                "'self'",
                "'unsafe-inline'",
                "https://fonts.googleapis.com",
              ],
              fontSrc: ["'self'", "https://fonts.gstatic.com"],
              imgSrc: ["'self'", "data:"],
              connectSrc: ["'self'"],
              upgradeInsecureRequests: insecureHttp ? null : [],
            },
          }
        : false,
    }),
  );
  app.use(express.json({ limit: "64kb" }));
  app.use("/api", (req, res, next) => {
    if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
    const allowed = production
      ? [process.env.APP_ORIGIN]
      : [
          process.env.APP_ORIGIN,
          "http://127.0.0.1:5173",
          "http://localhost:5173",
          "http://127.0.0.1:4000",
          "http://localhost:4000",
        ].filter(Boolean);
    if (req.headers.origin && !allowed.includes(req.headers.origin))
      return res.status(403).json({ error: "Origin is not allowed." });
    next();
  });
  const authLimit = rateLimit({
    windowMs: 15 * 60000,
    limit: 15,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: "Too many sign-in attempts. Try again in 15 minutes." },
  });
  app.get("/api/health", (_, res) => res.json({ status: "ok" }));
  app.get("/api/ready", async (_, res) => {
    try {
      await db.query("SELECT 1");
      res.json({ status: "ready" });
    } catch {
      res.status(503).json({ status: "database unavailable" });
    }
  });
  app.get("/api/auth/session", async (req, res) => {
    const session = await sessionFor(db, req);
    const setupRequired = !(await db.query("SELECT id FROM users LIMIT 1")).rows
      .length;
    res.json({
      user: session ? { id: session.user_id, email: session.email } : null,
      csrfToken: session?.csrf || null,
      setupRequired: setupRequired && !production,
    });
  });
  app.post("/api/auth/setup", authLimit, async (req, res) => {
    if (production)
      fail(
        "Production administrator must be provisioned from the server environment.",
        403,
      );
    const c = credentials(req.body);
    const user = await createAdmin(db, c.email, c.password);
    const session = await newSession(db, user.id);
    setSessionCookie(res, session.token, secureCookies);
    res.status(201).json({ user, csrfToken: session.csrf });
  });
  app.post("/api/auth/login", authLimit, async (req, res) => {
    const c = credentials(req.body);
    const user = (
      await db.query("SELECT * FROM users WHERE email=$1", [c.email])
    ).rows[0];
    const dummy = "00000000000000000000000000000000:" + "00".repeat(64);
    if (
      !(await passwordMatches(c.password, user?.password_hash || dummy)) ||
      !user
    )
      fail("Invalid email or password.", 401);
    const session = await newSession(db, user.id);
    setSessionCookie(res, session.token, secureCookies);
    await db.tx((tx) => audit(tx, user.id, "login", "session"));
    res.json({
      user: { id: user.id, email: user.email },
      csrfToken: session.csrf,
    });
  });
  app.post(
    "/api/events",
    rateLimit({
      windowMs: 60000,
      limit: 600,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      message: { error: "Event ingestion rate limit reached." },
    }),
    async (req, res) => {
      const token = req.headers.authorization?.startsWith("Bearer ")
        ? req.headers.authorization.slice(7)
        : "";
      if (token.length < 32)
        fail("A service ingestion token is required.", 401);
      const s = (
        await db.query("SELECT * FROM services WHERE key_hash=$1", [
          hash(token),
        ])
      ).rows[0];
      if (!s) fail("Invalid ingestion token.", 401);
      const e = req.body;
      if (
        !e ||
        !["request", "auth_failure", "cpu", "log"].includes(e.type) ||
        typeof e.id !== "string" ||
        !/^[a-zA-Z0-9_-]{8,128}$/.test(e.id) ||
        typeof e.message !== "string" ||
        e.message.length > 2000 ||
        !["info", "warn", "error"].includes(e.level || "info")
      )
        fail(
          "Provide an event id (8–128 letters, digits, dashes), type, and message (up to 2000 characters).",
        );
      if (
        e.type === "auth_failure" &&
        (typeof e.subject !== "string" || !e.subject || e.subject.length > 254)
      )
        fail("Authentication events need a subject identifier.");
      if (e.type === "cpu" && !number(e.value, 0, 100, false))
        fail("CPU value must be between 0 and 100.");
      if (
        e.type === "request" &&
        (!number(e.statusCode, 100, 599) ||
          !number(e.duration, 0, 300000, false))
      )
        fail("Request events need statusCode and duration.");
      if (
        e.traceId !== undefined &&
        (typeof e.traceId !== "string" || e.traceId.length > 128)
      )
        fail("Invalid trace ID.");
      // Which endpoint a request event belongs to: explicit fields, or parsed from an
      // older-style message such as "GET /api/products".
      let method = null,
        route = null;
      if (e.type === "request") {
        const parsed = /^([A-Za-z]{3,10})\s+(\/[^\s?]*)/.exec(e.message);
        const m = (typeof e.method === "string" ? e.method : parsed?.[1] || "")
          .toUpperCase()
          .trim();
        const r = (typeof e.route === "string" ? e.route : parsed?.[2] || "")
          .split("?")[0]
          .trim()
          .slice(0, 200);
        if (/^[A-Z]{3,10}$/.test(m)) method = m;
        if (r) route = r;
      }
      const signal = {
        id: `event-${hash(s.id + ":" + e.id)}`,
        kind: "event",
        serviceId: s.id,
        at: iso(),
        event: {
          type: e.type,
          message: e.message,
          level: e.level || "info",
          subject: e.type === "auth_failure" ? e.subject : "",
          value: e.type === "cpu" ? e.value : null,
          statusCode: e.type === "request" ? e.statusCode : null,
          duration: e.type === "request" ? e.duration : null,
          method,
          route,
          traceId: e.traceId || "",
        },
      };
      await db.tx(async (tx) => {
        const existing =
          (await tx.query("SELECT id FROM outbox WHERE id=$1", [signal.id]))
            .rows.length ||
          (
            await tx.query("SELECT id FROM processed_signals WHERE id=$1", [
              signal.id,
            ])
          ).rows.length;
        if (!existing)
          await tx.query(
            "INSERT INTO outbox(id,kind,payload,status,next_attempt) VALUES($1,$2,$3,$4,$5)",
            [signal.id, "signal", JSON.stringify(signal), "pending", iso()],
          );
      });
      res.status(202).json({ accepted: true, eventId: e.id });
    },
  );
  app.use("/api", async (req, res, next) => {
    const session = await sessionFor(db, req);
    if (!session)
      return res.status(401).json({ error: "Sign in to continue." });
    req.user = { id: session.user_id, email: session.email };
    req.session = session;
    if (
      !["GET", "HEAD"].includes(req.method) &&
      !constantEqual(req.headers["x-csrf-token"], session.csrf)
    )
      return res.status(403).json({
        error: "Invalid session protection token. Reload and try again.",
      });
    next();
  });
  app.use(
    "/api",
    rateLimit({
      windowMs: 60000,
      limit: 180,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      message: { error: "Too many requests. Try again shortly." },
    }),
  );
  app.post("/api/auth/logout", async (req, res) => {
    await db.tx((tx) =>
      tx.query("DELETE FROM sessions WHERE id=$1", [req.session.id]),
    );
    res.clearCookie("cloudops_session", {
      httpOnly: true,
      sameSite: "strict",
      secure: secureCookies,
      path: "/",
    });
    res.json({ message: "Signed out." });
  });
  app.get("/api/workspace", async (req, res) =>
    res.json({
      ...(await workspace(db)),
      user: req.user,
      integrations: integrationStatus(),
    }),
  );
  app.post("/api/services", async (req, res) => {
    const {
      name,
      endpoint,
      description = "",
      region = "ap-south-1",
      intervalSeconds = 60,
      timeoutMs = 5000,
      expectedStatus = 200,
      instanceId = "",
    } = req.body || {};
    if (
      typeof name !== "string" ||
      !name.trim() ||
      name.length > 80 ||
      typeof description !== "string" ||
      description.length > 300 ||
      typeof region !== "string" ||
      !/^[a-z]{2}(-[a-z]+)+-\d$/.test(region) ||
      !number(intervalSeconds, 15, 3600) ||
      !number(timeoutMs, 1000, 30000) ||
      !number(expectedStatus, 100, 599) ||
      typeof instanceId !== "string" ||
      (instanceId && !/^i-[a-f0-9]{8,17}$/.test(instanceId))
    )
      fail(
        "Check service fields: interval 15–3600 seconds, timeout 1000–30000 ms, and a valid AWS region.",
      );
    validateEndpoint(endpoint);
    const id = randomUUID();
    await db.tx(async (tx) => {
      await tx.query(
        "INSERT INTO services(id,name,description,endpoint,region,interval_seconds,timeout_ms,expected_status,instance_id,next_check) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
        [
          id,
          name.trim(),
          description,
          endpoint,
          region,
          intervalSeconds,
          timeoutMs,
          expectedStatus,
          instanceId || null,
          iso(),
        ],
      );
      await audit(tx, req.user.id, "service.create", id);
    });
    res.status(201).json({
      id,
      message:
        "Service added. The monitoring worker will run its first check shortly.",
    });
  });
  app.patch("/api/services/:id", async (req, res) => {
    const { enabled } = req.body;
    if (typeof enabled !== "boolean") fail("Enabled must be true or false.");
    await db.tx(async (tx) => {
      const result = await tx.query(
        "UPDATE services SET enabled=$1,next_check=$2 WHERE id=$3",
        [enabled ? 1 : 0, iso(), req.params.id],
      );
      if (!result.rowCount) fail("Service not found.", 404);
      await audit(
        tx,
        req.user.id,
        enabled ? "service.resume" : "service.pause",
        req.params.id,
      );
    });
    res.json({
      message: enabled ? "Monitoring resumed." : "Monitoring paused.",
    });
  });
  app.delete("/api/services/:id", async (req, res) => {
    await db.tx(async (tx) => {
      const result = await tx.query("DELETE FROM services WHERE id=$1", [
        req.params.id,
      ]);
      if (!result.rowCount) fail("Service not found.", 404);
      await audit(tx, req.user.id, "service.delete", req.params.id);
    });
    res.json({ message: "Service deleted." });
  });
  app.get("/api/services/:id/insights", async (req, res) => {
    const insights = await serviceInsights(db, req.params.id, {
      range: String(req.query.range || "24h"),
      endpoint: String(req.query.endpoint || "").slice(0, 250),
    });
    if (!insights) fail("Service not found.", 404);
    res.json(insights);
  });
  app.post("/api/services/:id/check", async (req, res) => {
    await db.tx(async (tx) => {
      const result = await tx.query(
        "UPDATE services SET next_check=$1 WHERE id=$2 AND enabled=1",
        [iso(), req.params.id],
      );
      if (!result.rowCount)
        fail("Service not found or monitoring is paused.", 404);
      await audit(tx, req.user.id, "service.check", req.params.id);
    });
    res.json({ message: "Health check scheduled." });
  });
  app.post("/api/services/:id/token", async (req, res) => {
    const token = randomBytes(32).toString("hex");
    await db.tx(async (tx) => {
      const result = await tx.query(
        "UPDATE services SET key_hash=$1 WHERE id=$2",
        [hash(token), req.params.id],
      );
      if (!result.rowCount) fail("Service not found.", 404);
      await audit(tx, req.user.id, "service.token.rotate", req.params.id);
    });
    res.json({
      token,
      message: "Ingestion token created. Copy it now; it is shown only once.",
    });
  });
  app.patch("/api/incidents/:id", async (req, res) => {
    if (!["acknowledged", "resolved"].includes(req.body.status))
      fail("Invalid incident status.");
    await db.tx(async (tx) => {
      const i = (
        await tx.query("SELECT * FROM incidents WHERE id=$1", [req.params.id])
      ).rows[0];
      if (!i) fail("Incident not found.", 404);
      if (i.status === "resolved")
        fail("This incident is already resolved.", 409);
      await tx.query(
        "UPDATE incidents SET status=$1,updated_at=$2 WHERE id=$3",
        [req.body.status, iso(), i.id],
      );
      await tx.query(
        "INSERT INTO timeline(id,incident_id,at,message) VALUES($1,$2,$3,$4)",
        [
          randomUUID(),
          i.id,
          iso(),
          `${req.body.status === "resolved" ? "Manually resolved" : "Acknowledged"} by ${req.user.email}`,
        ],
      );
      await audit(tx, req.user.id, `incident.${req.body.status}`, i.id);
      if (req.body.status === "resolved")
        await enqueue(tx, "alert", {
          id: i.id,
          service: i.service_id,
          title: i.title,
          severity: i.severity,
          status: "resolved",
          evidence: "Manually resolved by administrator",
          at: iso(),
        });
    });
    res.json({ message: "Incident updated." });
  });
  app.patch("/api/rules/:id", async (req, res) => {
    await db.tx(async (tx) => {
      const r = (
        await tx.query("SELECT * FROM rules WHERE id=$1", [req.params.id])
      ).rows[0];
      if (!r) fail("Rule not found.", 404);
      const { threshold = r.threshold, enabled = !!r.enabled } = req.body;
      const count = ["failures", "authFailures"].includes(r.metric);
      if (
        !number(
          threshold,
          count ? 1 : 0.01,
          ["cpu", "errorRate"].includes(r.metric) ? 100 : 100000,
          count,
        ) ||
        typeof enabled !== "boolean"
      )
        fail(
          "Enter a positive threshold; percentages must be at most 100 and failure counts must be integers.",
        );
      await tx.query("UPDATE rules SET threshold=$1,enabled=$2 WHERE id=$3", [
        threshold,
        enabled ? 1 : 0,
        r.id,
      ]);
      await audit(tx, req.user.id, "rule.update", r.id);
    });
    res.json({ message: "Monitoring rule saved." });
  });
  app.post("/api/archive", async (req, res) => {
    let result;
    try {
      result = await archiveNow(db);
    } catch (e) {
      fail(e.message, 400);
    }
    if (!result.count) fail("There are no events in the last 24 hours to archive.", 400);
    res.json({
      message: `Queued ${result.count} events for S3: ${result.prefix}/`,
      ...result,
    });
  });
  app.put("/api/settings", async (req, res) => {
    const { workspace: label, email, retention } = req.body;
    if (
      typeof label !== "string" ||
      !label.trim() ||
      label.length > 80 ||
      !validEmail(email) ||
      ![7, 30, 90].includes(retention)
    )
      fail("Enter a valid workspace, email, and retention period.");
    await db.tx(async (tx) => {
      await tx.query(
        "UPDATE settings SET workspace=$1,email=$2,retention=$3 WHERE id=1",
        [label.trim(), email, retention],
      );
      await audit(tx, req.user.id, "settings.update", "workspace");
    });
    res.json({
      message: "Preferences saved. Retention is enforced by the worker.",
    });
  });
  app.get("/api/audit", async (_, res) =>
    res.json(
      (await db.query("SELECT * FROM audit ORDER BY at DESC LIMIT 200")).rows,
    ),
  );
  app.post("/api/deliveries/:id/retry", async (req, res) => {
    await db.tx(async (tx) => {
      const result = await tx.query(
        "UPDATE outbox SET status='pending',attempts=0,next_attempt=$1,lease_until=NULL WHERE id=$2 AND status='failed'",
        [iso(), req.params.id],
      );
      if (!result.rowCount) fail("Failed delivery not found.", 404);
      await audit(tx, req.user.id, "delivery.retry", req.params.id);
    });
    res.json({ message: "Delivery queued for retry." });
  });
  const dist = fileURLToPath(new URL("../dist/", import.meta.url));
  app.use(express.static(dist));
  app.use("/api", (_, res) =>
    res.status(404).json({ error: "API route not found." }),
  );
  app.get("/{*path}", (_, res) => res.sendFile(path.join(dist, "index.html")));
  app.use((err, req, res, next) => {
    if (!err.status || err.status >= 500)
      console.error(
        JSON.stringify({
          level: "error",
          message: "API request failed",
          path: req.path,
        }),
      );
    res.status(err.status || 500).json({
      error:
        err.status && err.status < 500
          ? err.message
          : "The request could not be completed. Try again.",
    });
  });
  return app;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await loadParameters();
  const production = process.env.NODE_ENV === "production";
  if (
    production &&
    ((process.env.ALLOW_INSECURE_HTTP !== "true" &&
      !process.env.APP_ORIGIN?.startsWith("https://")) ||
      process.env.EMBEDDED_WORKER === "true")
  )
    throw Error("Production requires HTTPS APP_ORIGIN and a separate worker.");
  const db = await openDatabase();
  await bootstrapAdmin(db);
  if (
    production &&
    !(await db.query("SELECT id FROM users LIMIT 1")).rows.length
  )
    throw Error(
      "Set ADMIN_EMAIL and ADMIN_PASSWORD to provision the first administrator.",
    );
  const app = createApp(db);
  const stop = process.env.EMBEDDED_WORKER === "true" ? startWorker(db) : null;
  const server = app.listen(
    Number(process.env.PORT) || 4000,
    process.env.HOST || "127.0.0.1",
    () => console.log("CloudOps API started (live monitoring mode)"),
  );
  for (const signal of ["SIGINT", "SIGTERM"])
    process.on(signal, async () => {
      server.close(async () => {
        if (stop) await stop();
        await db.close();
        process.exit(0);
      });
    });
}
