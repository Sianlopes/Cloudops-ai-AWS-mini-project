import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { openDatabase } from "./db.js";
import { probe } from "./network.js";
import { hash } from "./auth.js";
import { enqueue, iso, maintenance, processSignal } from "./domain.js";
import {
  archive,
  cpuFor,
  loadParameters,
  sendAlert,
  sendSignal,
} from "./integrations.js";
export async function claimServices(db) {
  return db.tx(async (tx) => {
    const now = iso();
    const rows = (
      await tx.query(
        "SELECT * FROM services WHERE enabled=1 AND next_check<=$1 AND (lease_until IS NULL OR lease_until<$1) ORDER BY next_check LIMIT 10",
        [now],
      )
    ).rows;
    for (const s of rows)
      await tx.query(
        "UPDATE services SET next_check=$1,lease_until=$2 WHERE id=$3",
        [
          new Date(Date.now() + s.interval_seconds * 1000).toISOString(),
          new Date(Date.now() + 60000).toISOString(),
          s.id,
        ],
      );
    return rows;
  });
}
export async function checkService(db, service) {
  const result = await probe(service.endpoint, {
    timeoutMs: service.timeout_ms,
    expectedStatus: service.expected_status,
  });
  const at = iso();
  await db.tx(async (tx) => {
    await enqueue(tx, "signal", {
      id: randomUUID(),
      kind: "check",
      serviceId: service.id,
      at,
      result,
    });
    await tx.query("UPDATE services SET lease_until=NULL WHERE id=$1", [
      service.id,
    ]);
  });
  if (service.instance_id) {
    try {
      const cpu = await cpuFor(service);
      if (cpu !== null)
        await db.tx((tx) =>
          enqueue(tx, "signal", {
            id: `cpu-${hash(service.id + cpu.at)}`,
            kind: "event",
            serviceId: service.id,
            at: cpu.at,
            event: {
              type: "cpu",
              value: cpu.value,
              level: "info",
              message: "CPUUtilization collected from CloudWatch",
            },
          }),
        );
    } catch {
      console.error(
        JSON.stringify({
          level: "error",
          message: "CloudWatch CPU read failed",
          serviceId: service.id,
        }),
      );
    }
  }
}
export async function drainOutbox(
  db,
  adapters = { sendSignal, sendAlert, archive },
) {
  for (let processed = 0; processed < 20; processed++) {
    const job = await db.tx(async (tx) => {
      const now = iso();
      const rows = (
        await tx.query(
          "SELECT * FROM outbox WHERE status='pending' AND next_attempt<=$1 AND (lease_until IS NULL OR lease_until<$1) ORDER BY next_attempt LIMIT 1",
          [now],
        )
      ).rows;
      for (const job of rows)
        await tx.query("UPDATE outbox SET lease_until=$1 WHERE id=$2", [
          new Date(Date.now() + 120000).toISOString(),
          job.id,
        ]);
      return rows[0];
    });
    if (!job) break;
    try {
      const payload = JSON.parse(job.payload);
      if (job.kind === "signal") {
        if (process.env.SQS_QUEUE_URL) await adapters.sendSignal(payload);
        else await processSignal(db, payload);
      } else if (job.kind === "alert") await adapters.sendAlert(payload);
      else if (job.kind === "archive")
        await adapters.archive(payload.key, payload.records);
      else throw Error("Unknown outbox job");
      await db.tx((tx) =>
        tx.query(
          "UPDATE outbox SET status='sent',sent_at=$1,lease_until=NULL,last_error=NULL WHERE id=$2",
          [iso(), job.id],
        ),
      );
    } catch (error) {
      const attempts = job.attempts + 1;
      await db.tx((tx) =>
        tx.query(
          "UPDATE outbox SET attempts=$1,status=$2,next_attempt=$3,lease_until=NULL,last_error=$4 WHERE id=$5",
          [
            attempts,
            attempts >= 10 ? "failed" : "pending",
            new Date(
              Date.now() + Math.min(3600000, 2 ** attempts * 1000),
            ).toISOString(),
            error.message.slice(0, 300),
            job.id,
          ],
        ),
      );
    }
  }
}
export async function archivePreviousDay(db) {
  if (!process.env.S3_LOG_BUCKET) return;
  const day = new Date(Date.now() - 86400000).toISOString().slice(0, 10),
    marker = `archive:${day}`;
  if (
    (await db.query("SELECT id FROM heartbeats WHERE id=$1", [marker])).rows
      .length
  )
    return;
  await db.tx(async (tx) => {
    if (
      (await tx.query("SELECT id FROM heartbeats WHERE id=$1", [marker])).rows
        .length
    )
      return;
    let offset = 0;
    while (true) {
      const records = (
        await tx.query(
          "SELECT * FROM events WHERE at>=$1 AND at<$2 ORDER BY at,id LIMIT 1000 OFFSET $3",
          [
            `${day}T00:00:00.000Z`,
            new Date(
              new Date(`${day}T00:00:00Z`).getTime() + 86400000,
            ).toISOString(),
            offset,
          ],
        )
      ).rows;
      if (!records.length) break;
      await enqueue(tx, "archive", {
        key: `logs/${day}/part-${String(offset / 1000).padStart(5, "0")}.ndjson`,
        records,
      });
      offset += records.length;
    }
    await tx.query("INSERT INTO heartbeats(id,at,detail) VALUES($1,$2,$3)", [
      marker,
      iso(),
      "Archive chunks queued",
    ]);
  });
}
export function startWorker(db, { interval = 5000 } = {}) {
  let stopped = false,
    running = false,
    lastMaintenance = 0;
  const heartbeat = () =>
    db.tx((tx) =>
      tx.query(
        "INSERT INTO heartbeats(id,at,detail) VALUES($1,$2,$3) ON CONFLICT(id) DO UPDATE SET at=$2,detail=$3",
        ["worker", iso(), "Monitoring checks and delivery queue active"],
      ),
    );
  const tick = async () => {
    if (stopped || running) return;
    running = true;
    try {
      await heartbeat();
      await Promise.all(
        (await claimServices(db)).map((service) => checkService(db, service)),
      );
      await drainOutbox(db);
      if (Date.now() - lastMaintenance > 60000) {
        await archivePreviousDay(db);
        await maintenance(db);
        lastMaintenance = Date.now();
      }
      await heartbeat();
    } catch (error) {
      console.error(
        JSON.stringify({
          level: "error",
          message: "Monitoring worker cycle failed",
          error: error.message,
        }),
      );
    } finally {
      running = false;
    }
  };
  const timer = setInterval(tick, interval);
  tick();
  return async () => {
    stopped = true;
    clearInterval(timer);
    while (running) await new Promise((r) => setTimeout(r, 50));
  };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await loadParameters();
  const db = await openDatabase();
  const stop = startWorker(db);
  console.log("CloudOps monitoring worker started");
  for (const signal of ["SIGINT", "SIGTERM"])
    process.on(signal, async () => {
      await stop();
      await db.close();
      process.exit(0);
    });
}
