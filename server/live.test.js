import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { randomUUID } from "node:crypto";
import { openDatabase } from "./db.js";
import { processSignal, maintenance } from "./domain.js";
import { createApp } from "./index.js";
import { claimServices, drainOutbox } from "./worker.js";
import { probe, publicAddress, checkedAddress } from "./network.js";
import { workspace } from "./workspace.js";
import { createHandler } from "./lambda.js";
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
