import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { randomUUID } from "node:crypto";
import { openDatabase } from "./db.js";
import { processSignal, maintenance } from "./domain.js";
import { createApp } from "./index.js";
import { claimServices, drainOutbox, archiveNow } from "./worker.js";
import {
  probe,
  publicAddress,
  checkedAddress,
  describeNetworkError,
} from "./network.js";
import { workspace } from "./workspace.js";
import { createHandler } from "./lambda.js";
import { serviceInsights, percentile } from "./insights.js";
import { formatAlert } from "./integrations.js";
async function fixture() {
  const db = await openDatabase({
    file: ":memory:",
    url: "",
    production: false,
  });
  const id = randomUUID();
  await db.tx((tx) =>
    tx.query(
      "INSERT INTO services(id,name,description,endpoint,region,interval_seconds,timeout_ms,expected_status,next_check) VALUES($1,$2,$3,$4,$5,60,5000,200,$6)",
      [
        id,
        "Test service",
        "",
        "https://example.com/health",
        "ap-south-1",
        new Date().toISOString(),
      ],
    ),
  );
  return { db, id };
}
const check = (id, success, n = 0) => ({
  id: randomUUID(),
  kind: "check",
  serviceId: id,
  at: new Date(Date.now() - 10000 + n * 1000).toISOString(),
  result: {
    success,
    statusCode: success ? 200 : 503,
    latency: success ? 100 : 200,
    error: success ? null : "HTTP 503",
  },
});
test("real failure streak creates one incident, replay is idempotent, recovery closes it", async () => {
  const { db, id } = await fixture();
  try {
    for (let i = 0; i < 3; i++) await processSignal(db, check(id, false, i));
    assert.equal((await db.query("SELECT * FROM incidents")).rows.length, 1);
    const duplicate = check(id, false, 3);
    await processSignal(db, duplicate);
    await processSignal(db, duplicate);
    assert.equal((await db.query("SELECT * FROM checks")).rows.length, 4);
    assert.equal((await db.query("SELECT * FROM incidents")).rows.length, 1);
    await processSignal(db, check(id, true, 4));
    assert.equal(
      (await db.query("SELECT status FROM incidents")).rows[0].status,
      "open",
    );
    await processSignal(db, check(id, true, 5));
    assert.equal(
      (await db.query("SELECT status FROM incidents")).rows[0].status,
      "resolved",
    );
    assert.equal((await workspace(db)).services[0].uptime, 33.33);
  } finally {
    await db.close();
  }
});
test("late check cannot overwrite newer service health", async () => {
  const { db, id } = await fixture();
  try {
    await processSignal(db, check(id, true, 5));
    await processSignal(db, check(id, false, 1));
    assert.equal(
      (await db.query("SELECT status FROM services")).rows[0].status,
      "healthy",
    );
  } finally {
    await db.close();
  }
});
test("authentication failures are grouped by account rather than summed across accounts", async () => {
  const { db, id } = await fixture();
  try {
    for (let n = 0; n < 5; n++)
      await processSignal(db, {
        id: randomUUID(),
        kind: "event",
        serviceId: id,
        at: new Date().toISOString(),
        event: {
          type: "auth_failure",
          subject: `account-${n}`,
          message: "Failed login",
          level: "warn",
        },
      });
    assert.equal((await db.query("SELECT * FROM incidents")).rows.length, 0);
    for (let n = 0; n < 4; n++)
      await processSignal(db, {
        id: randomUUID(),
        kind: "event",
        serviceId: id,
        at: new Date().toISOString(),
        event: {
          type: "auth_failure",
          subject: "account-0",
          message: "Failed login",
          level: "warn",
        },
      });
    assert.equal((await db.query("SELECT * FROM incidents")).rows.length, 1);
    assert.ok(
      !(await db.query("SELECT * FROM events")).rows.some(
        (e) => e.subject === "account-0",
      ),
    );
  } finally {
    await db.close();
  }
});
test("error-rate rule requires minimum traffic and evaluates application request events", async () => {
  const { db, id } = await fixture();
  try {
    for (let n = 0; n < 19; n++)
      await processSignal(db, {
        id: randomUUID(),
        kind: "event",
        serviceId: id,
        at: new Date().toISOString(),
        event: {
          type: "request",
          statusCode: 503,
          duration: 80,
          message: "Request failed",
          level: "error",
        },
      });
    assert.equal((await db.query("SELECT * FROM incidents")).rows.length, 0);
    await processSignal(db, {
      id: randomUUID(),
      kind: "event",
      serviceId: id,
      at: new Date().toISOString(),
      event: {
        type: "request",
        statusCode: 503,
        duration: 80,
        message: "Request failed",
        level: "error",
      },
    });
    assert.equal((await db.query("SELECT * FROM incidents")).rows.length, 1);
  } finally {
    await db.close();
  }
});
test("disabled latency rule does not create an incident", async () => {
  const { db, id } = await fixture();
  try {
    await db.tx((tx) =>
      tx.query("UPDATE rules SET enabled=0 WHERE id='rule-latency'"),
    );
    for (let n = 0; n < 3; n++) {
      const c = check(id, true, n);
      c.result.latency = 1500;
      await processSignal(db, c);
    }
    assert.equal((await db.query("SELECT * FROM incidents")).rows.length, 0);
  } finally {
    await db.close();
  }
});
test("rolling baseline detects sustained latency anomalies after a warm-up", async () => {
  const { db, id } = await fixture();
  try {
    for (let n = 0; n < 23; n++) {
      const c = check(id, true, n);
      c.at = new Date(Date.now() - 60000 + n * 1000).toISOString();
      c.result.latency = n >= 20 ? 600 : 100;
      await processSignal(db, c);
    }
    const anomalies = (
      await db.query("SELECT * FROM incidents WHERE rule_id='rule-anomaly'")
    ).rows;
    assert.equal(anomalies.length, 1);
    assert.match(anomalies[0].evidence, /Baseline 100 ms/);
  } finally {
    await db.close();
  }
});
test("CPU needs sustained samples and resolves after two below-threshold samples", async () => {
  const { db, id } = await fixture();
  try {
    for (let n = 0; n < 5; n++)
      await processSignal(db, {
        id: randomUUID(),
        kind: "event",
        serviceId: id,
        at: new Date(Date.now() - 240000 + n * 60000).toISOString(),
        event: { type: "cpu", value: 90, message: "CPU sample", level: "info" },
      });
    assert.equal(
      (await db.query("SELECT status FROM incidents WHERE rule_id='rule-cpu'"))
        .rows[0].status,
      "open",
    );
    for (let n = 0; n < 2; n++)
      await processSignal(db, {
        id: randomUUID(),
        kind: "event",
        serviceId: id,
        at: new Date(Date.now() + n).toISOString(),
        event: { type: "cpu", value: 20, message: "CPU sample", level: "info" },
      });
    assert.equal(
      (await db.query("SELECT status FROM incidents WHERE rule_id='rule-cpu'"))
        .rows[0].status,
      "resolved",
    );
  } finally {
    await db.close();
  }
});
test("FIFO partial failure blocks later records in the same group but processes other groups", async () => {
  const processed = [];
  const handler = createHandler(null, async (_, signal) => {
    if (signal.fail) throw Error("Temporary failure");
    processed.push(signal.id);
  });
  const record = (id, group, fail = false) => ({
    messageId: id,
    attributes: { MessageGroupId: group },
    body: JSON.stringify({ id, fail }),
  });
  const result = await handler({
    Records: [record("a", "one", true), record("b", "one"), record("c", "two")],
  });
  assert.deepEqual(result.batchItemFailures, [
    { itemIdentifier: "a" },
    { itemIdentifier: "b" },
  ]);
  assert.deepEqual(processed, ["c"]);
});
test("workers do not claim the same scheduled check concurrently", async () => {
  const { db } = await fixture();
  try {
    const claims = await Promise.all([claimServices(db), claimServices(db)]);
    assert.equal(claims.flat().length, 1);
  } finally {
    await db.close();
  }
});
test("failed alerts persist for retry and successful attempts clear the queue", async () => {
  const { db, id } = await fixture();
  try {
    for (let n = 0; n < 3; n++) await processSignal(db, check(id, false, n));
    await drainOutbox(db, {
      sendAlert: async () => {
        throw Error("SNS unavailable");
      },
    });
    let job = (await db.query("SELECT * FROM outbox WHERE kind='alert'"))
      .rows[0];
    assert.equal(job.status, "pending");
    assert.equal(job.attempts, 1);
    assert.match(job.last_error, /SNS unavailable/);
    await db.tx((tx) =>
      tx.query("UPDATE outbox SET next_attempt=$1", [
        new Date(Date.now() - 1000).toISOString(),
      ]),
    );
    await drainOutbox(db, { sendAlert: async () => {} });
    job = (await db.query("SELECT * FROM outbox WHERE kind='alert'")).rows[0];
    assert.equal(job.status, "sent");
  } finally {
    await db.close();
  }
});
test("retention deletes old telemetry but retains incident history", async () => {
  const { db, id } = await fixture();
  try {
    for (let n = 0; n < 3; n++) await processSignal(db, check(id, false, n));
    await db.tx((tx) =>
      tx.query("UPDATE checks SET at=$1", [
        new Date(Date.now() - 40 * 86400000).toISOString(),
      ]),
    );
    await maintenance(db);
    assert.equal((await db.query("SELECT * FROM checks")).rows.length, 0);
    assert.equal((await db.query("SELECT * FROM incidents")).rows.length, 1);
  } finally {
    await db.close();
  }
});
test("private, mapped, metadata, and reserved addresses are blocked", async () => {
  for (const ip of [
    "127.0.0.1",
    "10.0.0.1",
    "172.16.1.1",
    "192.168.1.1",
    "169.254.169.254",
    "::1",
    "::ffff:127.0.0.1",
    "fc00::1",
    "100.64.1.1",
  ])
    assert.equal(publicAddress(ip), false, ip);
  assert.equal(publicAddress("8.8.8.8"), true);
  await assert.rejects(
    () =>
      checkedAddress(new URL("https://rebind.example/"), {
        lookup: async () => [
          { address: "8.8.8.8", family: 4 },
          { address: "127.0.0.1", family: 4 },
        ],
      }),
    /blocked/,
  );
});
test("HTTP monitoring observes real failures, times out, and never follows redirects", async () => {
  let internal = 0;
  const server = http.createServer((req, res) => {
    if (req.url === "/slow") return setTimeout(() => res.end("ok"), 500);
    if (req.url === "/redirect") {
      res.writeHead(302, { Location: "/internal" });
      return res.end();
    }
    if (req.url === "/internal") internal++;
    res.writeHead(req.url === "/outage" ? 503 : 200);
    res.end("ok");
  });
  await new Promise((r, j) => {
    server.once("error", j);
    server.listen(4100, "127.0.0.1", r);
  });
  try {
    assert.equal(
      (await probe("http://127.0.0.1:4100/health", { allowLocalTest: true }))
        .success,
      true,
    );
    assert.equal(
      (await probe("http://127.0.0.1:4100/outage", { allowLocalTest: true }))
        .statusCode,
      503,
    );
    assert.equal(
      (await probe("http://127.0.0.1:4100/redirect", { allowLocalTest: true }))
        .success,
      false,
    );
    assert.equal(internal, 0);
    assert.match(
      (
        await probe("http://127.0.0.1:4100/slow", {
          allowLocalTest: true,
          timeoutMs: 80,
        })
      ).error,
      /timed out/,
    );
  } finally {
    await new Promise((r) => server.close(r));
  }
});
test("authenticated API rejects anonymous access and missing CSRF, and accepts token-scoped events", async () => {
  const { db } = await fixture();
  const server = createApp(db).listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const request = (p, body, headers = {}) =>
    fetch(base + p, {
      method: body ? "POST" : "GET",
      headers: { "Content-Type": "application/json", ...headers },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  try {
    assert.equal((await request("/workspace")).status, 401);
    const setup = await request("/auth/setup", {
      email: "admin@example.com",
      password: "test-password-long-123",
    });
    assert.equal(setup.status, 201);
    const session = await setup.json();
    const cookie = setup.headers.get("set-cookie").split(";")[0];
    assert.equal(
      (await request("/workspace", null, { Cookie: cookie })).status,
      200,
    );
    assert.equal(
      (
        await request(
          "/services",
          { name: "Blocked", endpoint: "https://example.com/health" },
          { Cookie: cookie },
        )
      ).status,
      403,
    );
    const created = await request(
      "/services",
      { name: "Real API", endpoint: "https://example.com/health" },
      { Cookie: cookie, "X-CSRF-Token": session.csrfToken },
    );
    assert.equal(created.status, 201);
    const service = await created.json();
    const token = await (
      await request(
        `/services/${service.id}/token`,
        {},
        { Cookie: cookie, "X-CSRF-Token": session.csrfToken },
      )
    ).json();
    assert.equal(
      (
        await request(
          "/events",
          { id: "event-1234", type: "log", message: "Actual event" },
          { Authorization: `Bearer ${token.token}` },
        )
      ).status,
      202,
    );
    assert.equal(
      (
        await request(
          "/events",
          { id: "event-1234", type: "log", message: "Actual event" },
          { Authorization: `Bearer ${token.token}` },
        )
      ).status,
      202,
    );
    assert.equal(
      (await db.query("SELECT * FROM outbox WHERE kind='signal'")).rows.length,
      1,
    );
    assert.equal(
      (
        await request("/events", {
          id: "event-1234",
          type: "log",
          message: "bad",
        })
      ).status,
      401,
    );
    assert.equal(
      (
        await request("/auth/setup", {
          email: "other@example.com",
          password: "another-test-password-123",
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await request(
          "/auth/logout",
          {},
          { Cookie: cookie, "X-CSRF-Token": session.csrfToken },
        )
      ).status,
      200,
    );
    assert.equal(
      (await request("/workspace", null, { Cookie: cookie })).status,
      401,
    );
  } finally {
    await new Promise((r) => server.close(r));
    await db.close();
  }
});
test("network errors are described in plain language", () => {
  assert.match(describeNetworkError({ code: "ECONNREFUSED" }), /refused/i);
  assert.match(describeNetworkError({ code: "ENOTFOUND" }), /DNS/);
  assert.match(describeNetworkError({ code: "ECONNRESET" }), /reset/i);
  assert.match(
    describeNetworkError({ code: "DEPTH_ZERO_SELF_SIGNED_CERT" }),
    /certificate/i,
  );
  assert.match(describeNetworkError({ code: "EWEIRD" }), /EWEIRD/);
});
test("uptime covers only the last 24 hours", async () => {
  const { db, id } = await fixture();
  try {
    // An old failure outside the window must not count against uptime.
    await db.query(
      "INSERT INTO checks(id,service_id,at,success,status_code,latency,error) VALUES($1,$2,$3,0,503,100,'old')",
      [randomUUID(), id, new Date(Date.now() - 3 * 86400000).toISOString()],
    );
    await processSignal(db, check(id, true, 0));
    await processSignal(db, check(id, true, 1));
    assert.equal((await workspace(db)).services[0].uptime, 100);
  } finally {
    await db.close();
  }
});
test("archive now queues recent events for S3 and refuses without a bucket", async () => {
  const { db, id } = await fixture();
  const previous = process.env.S3_LOG_BUCKET;
  try {
    delete process.env.S3_LOG_BUCKET;
    await assert.rejects(() => archiveNow(db), /not configured/);
    process.env.S3_LOG_BUCKET = "test-bucket";
    await db.query(
      "INSERT INTO events(id,service_id,type,subject,at,level,message,trace_id) VALUES($1,$2,'log','',$3,'info','hello','t')",
      [randomUUID(), id, new Date().toISOString()],
    );
    const result = await archiveNow(db);
    assert.equal(result.count, 1);
    assert.match(result.prefix, /^logs\/manual-/);
    const jobs = (await db.query("SELECT * FROM outbox WHERE kind='archive'")).rows;
    assert.equal(jobs.length, 1);
    assert.match(JSON.parse(jobs[0].payload).key, /part-00000\.ndjson$/);
  } finally {
    if (previous === undefined) delete process.env.S3_LOG_BUCKET;
    else process.env.S3_LOG_BUCKET = previous;
    await db.close();
  }
});
test("error-rate incident resolves once its window has no errors, even with little traffic", async () => {
  const { db, id } = await fixture();
  try {
    for (let n = 0; n < 20; n++)
      await processSignal(db, {
        id: randomUUID(),
        kind: "event",
        serviceId: id,
        at: new Date().toISOString(),
        event: { type: "request", statusCode: 503, duration: 80, message: "Request failed", level: "error" },
      });
    const status = async () =>
      (await db.query("SELECT status FROM incidents WHERE rule_id='rule-errors'")).rows[0].status;
    assert.equal(await status(), "open");
    // The failures age out of the five-minute window and traffic has stopped.
    await db.query("UPDATE events SET at=$1", [new Date(Date.now() - 600000).toISOString()]);
    await processSignal(db, check(id, true, 0));
    assert.equal(await status(), "resolved");
  } finally {
    await db.close();
  }
});
test("the demo shop runs exactly the code the CloudOps integration guide shows customers", async () => {
  const { readFile } = await import("node:fs/promises");
  const { shopClientSource } = await import("../scripts/sync-shop-client.mjs");
  const onDisk = await readFile(new URL("../examples/acme-shop/cloudops.cjs", import.meta.url), "utf8");
  assert.equal(onDisk, shopClientSource(), "Run: node scripts/sync-shop-client.mjs");
});
const request = (id, method, route, statusCode, duration, at = new Date().toISOString()) =>
  processSignal(id.db, {
    id: randomUUID(),
    kind: "event",
    serviceId: id.id,
    at,
    event: { type: "request", method, route, statusCode, duration, message: `${method} ${route}`, level: statusCode >= 500 ? "error" : "info" },
  });
test("insights summarize each endpoint with request counts, error rate and p95", async () => {
  const f = await fixture();
  try {
    for (let n = 1; n <= 20; n++) await request(f, "GET", "/api/products", 200, n * 10);
    for (let n = 0; n < 4; n++) await request(f, "POST", "/api/orders", n < 1 ? 502 : 201, 100);
    const r = await serviceInsights(f.db, f.id, { range: "1h" });
    assert.equal(r.traffic.requests, 24);
    assert.equal(r.traffic.endpoints, 2);
    const products = r.endpoints.find((e) => e.key === "GET /api/products");
    assert.equal(products.requests, 20);
    assert.equal(products.errors, 0);
    assert.equal(products.avgMs, 105);
    assert.equal(products.p95Ms, 190);
    const orders = r.endpoints.find((e) => e.key === "POST /api/orders");
    assert.equal(orders.errorRate, 25);
    assert.equal(r.endpoints[0].key, "GET /api/products", "busiest endpoint first");
    // filtering to one endpoint narrows the series and the logs to it
    const only = await serviceInsights(f.db, f.id, { endpoint: "POST /api/orders" });
    assert.equal(only.series.reduce((n, b) => n + (b.requests || 0), 0), 4);
    assert.ok(only.logs.every((l) => l.message.startsWith("POST /api/orders")));
    assert.equal(await serviceInsights(f.db, "missing"), null);
  } finally {
    await f.db.close();
  }
});
test("percentile uses the nearest rank", () => {
  assert.equal(percentile([], 0.95), null);
  assert.equal(percentile([5], 0.95), 5);
  assert.equal(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.95), 10);
  assert.equal(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.5), 5);
});
test("error-rate incidents are raised per endpoint and resolve independently", async () => {
  const f = await fixture();
  try {
    for (let n = 0; n < 12; n++) await request(f, "GET", "/api/products", 200, 20);
    for (let n = 0; n < 10; n++) await request(f, "POST", "/api/orders", 502, 80);
    const open = (await f.db.query("SELECT title,scope,evidence FROM incidents WHERE status<>'resolved'")).rows;
    assert.equal(open.length, 1);
    assert.equal(open[0].scope, "POST /api/orders");
    assert.match(open[0].title, /API error rate: POST \/api\/orders \(Test service\)/);
    assert.match(open[0].evidence, /10 of 10 requests to POST \/api\/orders/);
    // the failing endpoint ages out of the window; the healthy one carries on
    await f.db.query("UPDATE events SET at=$1 WHERE route='/api/orders'", [new Date(Date.now() - 600000).toISOString()]);
    await request(f, "GET", "/api/products", 200, 20);
    assert.equal((await f.db.query("SELECT status FROM incidents")).rows[0].status, "resolved");
  } finally {
    await f.db.close();
  }
});
test("requests reported without route fields still count, grouped under the service", async () => {
  const f = await fixture();
  try {
    for (let n = 0; n < 20; n++)
      await processSignal(f.db, {
        id: randomUUID(), kind: "event", serviceId: f.id, at: new Date().toISOString(),
        event: { type: "request", statusCode: 503, duration: 50, message: "Old style request", level: "error" },
      });
    const incidents = (await f.db.query("SELECT scope,title FROM incidents")).rows;
    assert.equal(incidents.length, 1);
    assert.equal(incidents[0].scope, "");
    assert.equal(incidents[0].title, "API error rate: Test service");
    const r = await serviceInsights(f.db, f.id);
    assert.equal(r.endpoints[0].key, "(no route)");
  } finally {
    await f.db.close();
  }
});
test("the event API stores method and route, and derives them from old-style messages", async () => {
  const f = await fixture();
  let server;
  try {
    const app = createApp(f.db, { production: false });
    server = await new Promise((r) => { const s = app.listen(0, "127.0.0.1", () => r(s)); });
    const base = `http://127.0.0.1:${server.address().port}`;
    const token = "t".repeat(64);
    const { createHash } = await import("node:crypto");
    await f.db.query("UPDATE services SET key_hash=$1 WHERE id=$2", [createHash("sha256").update(token).digest("hex"), f.id]);
    const send = (body) => fetch(`${base}/api/events`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
    assert.equal((await send({ id: "event-aaaa-0001", type: "request", method: "post", route: "/api/orders?x=1", statusCode: 201, duration: 5, message: "ignored text" })).status, 202);
    assert.equal((await send({ id: "event-aaaa-0002", type: "request", statusCode: 200, duration: 5, message: "GET /api/products?page=2" })).status, 202);
    for (const row of (await f.db.query("SELECT payload FROM outbox WHERE kind='signal'")).rows) {
      const p = JSON.parse(row.payload);
      await processSignal(f.db, p);
    }
    const got = (await f.db.query("SELECT method,route FROM events WHERE type='request' ORDER BY route")).rows;
    assert.deepEqual(got.map((g) => `${g.method} ${g.route}`), ["POST /api/orders", "GET /api/products"]);
  } finally {
    server?.closeAllConnections();
    server?.close();
    await f.db.close();
  }
});
test("migrating an older events table adds method and route without losing rows", async () => {
  const { DatabaseSync } = await import("node:sqlite");
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const dir = await mkdtemp(`${tmpdir()}/cloudops-migrate-`);
  const file = `${dir}/old.sqlite`;
  try {
    const old = new DatabaseSync(file);
    old.exec("CREATE TABLE services (id TEXT PRIMARY KEY); CREATE TABLE events (id TEXT PRIMARY KEY, service_id TEXT NOT NULL, type TEXT NOT NULL, subject TEXT NOT NULL DEFAULT '', at TEXT NOT NULL, value REAL, duration REAL, status_code INTEGER, level TEXT NOT NULL, message TEXT NOT NULL, trace_id TEXT NOT NULL);");
    old.exec("INSERT INTO services VALUES('s1'); INSERT INTO events VALUES('e1','s1','log','','2026-01-01T00:00:00.000Z',NULL,NULL,NULL,'info','kept','t')");
    old.close();
    for (let n = 0; n < 2; n++) {
      const db = await openDatabase({ file, url: "", production: false });
      assert.equal((await db.query("SELECT message,method,route FROM events")).rows[0].message, "kept");
      await db.close();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("workspace reports real request durations and keeps request logs visible among health checks", async () => {
  const f = await fixture();
  try {
    for (let n = 0; n < 3; n++) await request(f, "GET", "/api/products", 200, 100 + n * 100);
    for (let n = 0; n < 200; n++) await processSignal(f.db, check(f.id, true, n));
    const w = await workspace(f.db);
    const withTraffic = w.metrics.find((m) => m.requests);
    assert.equal(withTraffic.appLatency, 200);
    assert.ok(w.metrics.some((m) => m.latency != null), "health check latency still reported");
    assert.equal(w.logs.filter((l) => l.type === "request").length, 3, "requests not crowded out by health checks");
    assert.ok(w.logs.some((l) => l.type === "health_check"));
  } finally {
    await f.db.close();
  }
});
test("alert emails are readable plain text with a link back to the service", () => {
  const alert = {
    id: "INC-A92A8820",
    serviceId: "svc-1",
    service: "CCL SHOP",
    title: "Response latency: CCL SHOP",
    severity: "high",
    status: "resolved",
    evidence: "Two consecutive responses below the configured latency threshold.",
    at: "2026-10-28T14:22:32.555Z",
  };
  const mail = formatAlert(alert, "http://example.test/");
  assert.equal(mail.subject, "[CloudOps] Resolved · High · Response latency: CCL SHOP");
  assert.match(mail.message, /^An incident has been resolved\./);
  assert.match(mail.message, /Service: {3}CCL SHOP/);
  assert.match(mail.message, /Time: {6}2026-10-28 14:22 UTC/);
  assert.match(mail.message, /http:\/\/example\.test\/#\/services\/svc-1/);
  assert.ok(!mail.message.includes("{"), "no JSON in the body");
  const opened = formatAlert({ ...alert, status: "open", severity: "critical", title: "x".repeat(200) }, undefined);
  assert.ok(opened.subject.startsWith("[CloudOps] Incident opened · Critical"));
  assert.ok(opened.subject.length <= 100, "SNS limits subjects to 100 characters");
  assert.ok(!opened.message.includes("http"), "no link when the app address is unknown");
});
