import { randomUUID } from "node:crypto";
import { hash } from "./auth.js";
export const iso = () => new Date().toISOString();
export async function enqueue(tx, kind, payload) {
  const id = randomUUID();
  await tx.query(
    "INSERT INTO outbox(id,kind,payload,status,next_attempt) VALUES($1,$2,$3,$4,$5)",
    [id, kind, JSON.stringify(payload), "pending", iso()],
  );
  return id;
}
async function timeline(tx, id, message) {
  await tx.query(
    "INSERT INTO timeline(id,incident_id,at,message) VALUES($1,$2,$3,$4)",
    [randomUUID(), id, iso(), message],
  );
}
async function incident(tx, service, rule, scope, breach, evidence) {
  const active = (
    await tx.query(
      "SELECT * FROM incidents WHERE service_id=$1 AND rule_id=$2 AND scope=$3 AND status<>'resolved'",
      [service.id, rule.id, scope],
    )
  ).rows[0];
  if (breach && rule.enabled) {
    if (active) {
      await tx.query(
        "UPDATE incidents SET updated_at=$1,evidence=$2 WHERE id=$3",
        [iso(), evidence, active.id],
      );
      return;
    }
    const id = `INC-${randomUUID().slice(0, 8).toUpperCase()}`;
    const now = iso();
    const title = `${rule.name}: ${service.name}`;
    await tx.query(
      "INSERT INTO incidents(id,service_id,rule_id,scope,title,severity,status,detected_at,updated_at,evidence) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$8,$9)",
      [
        id,
        service.id,
        rule.id,
        scope,
        title,
        rule.severity,
        "open",
        now,
        evidence,
      ],
    );
    await timeline(tx, id, "Automatically detected from real telemetry");
    await enqueue(tx, "alert", {
      id,
      service: service.name,
      title,
      severity: rule.severity,
      status: "open",
      evidence,
      at: now,
    });
  } else if (active && !breach) {
    await tx.query(
      "UPDATE incidents SET status='resolved',updated_at=$1,evidence=$2 WHERE id=$3",
      [iso(), evidence, active.id],
    );
    await timeline(
      tx,
      active.id,
      "Automatically resolved after sustained recovery",
    );
    await enqueue(tx, "alert", {
      id: active.id,
      service: service.name,
      title: active.title,
      severity: active.severity,
      status: "resolved",
      evidence,
      at: iso(),
    });
  }
}
export async function processSignal(db, signal) {
  return db.tx(async (tx) => {
    if (
      !signal ||
      typeof signal.id !== "string" ||
      !["check", "event"].includes(signal.kind)
    )
      throw Error("Invalid signal");
    if (
      (
        await tx.query("SELECT id FROM processed_signals WHERE id=$1", [
          signal.id,
        ])
      ).rows.length
    )
      return { duplicate: true };
    const s = (
      await tx.query("SELECT * FROM services WHERE id=$1", [signal.serviceId])
    ).rows[0];
    if (!s) return { ignored: true };
    await tx.query("INSERT INTO processed_signals(id,at) VALUES($1,$2)", [
      signal.id,
      iso(),
    ]);
    const rules = (await tx.query("SELECT * FROM rules")).rows;
    const rule = (metric) => rules.find((r) => r.metric === metric);
    if (signal.kind === "check") {
      const { success, statusCode, latency, error, cpu } = signal.result;
      await tx.query(
        "INSERT INTO checks(id,service_id,at,success,status_code,latency,error,cpu) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
        [
          signal.id,
          s.id,
          signal.at,
          success ? 1 : 0,
          statusCode,
          latency,
          error,
          cpu ?? null,
        ],
      );
      if (s.last_evaluated && signal.at <= s.last_evaluated)
        return { stale: true };
      const available = rule("failures"),
        slow = rule("latency");
      s.failure_streak = success ? 0 : s.failure_streak + 1;
      s.slow_streak =
        success && latency > slow.threshold ? s.slow_streak + 1 : 0;
      s.recovery_streak =
        success && latency <= slow.threshold ? s.recovery_streak + 1 : 0;
      s.total_checks++;
      s.successful_checks += success ? 1 : 0;
      const status = !success
        ? "unhealthy"
        : latency > slow.threshold
          ? "degraded"
          : "healthy";
      await tx.query(
        "UPDATE services SET status=$1,latency=$2,uptime=$3,total_checks=$4,successful_checks=$5,failure_streak=$6,slow_streak=$7,recovery_streak=$8,last_checked=$9,last_evaluated=$9,last_error=$10 WHERE id=$11",
        [
          status,
          latency,
          Number(((s.successful_checks / s.total_checks) * 100).toFixed(2)),
          s.total_checks,
          s.successful_checks,
          s.failure_streak,
          s.slow_streak,
          s.recovery_streak,
          signal.at,
          error,
          s.id,
        ],
      );
      if (s.failure_streak >= available.threshold)
        await incident(
          tx,
          s,
          available,
          "",
          true,
          `${s.failure_streak} consecutive failed checks. ${error || "Unexpected response"}. Threshold: ${available.threshold}.`,
        );
      else if (s.recovery_streak >= 2)
        await incident(
          tx,
          s,
          available,
          "",
          false,
          "Two consecutive successful checks within the latency threshold.",
        );
      if (s.slow_streak >= slow.consecutive)
        await incident(
          tx,
          s,
          slow,
          "",
          true,
          `${s.slow_streak} consecutive slow responses; latest ${latency} ms, threshold ${slow.threshold} ms.`,
        );
      else if (s.recovery_streak >= 2)
        await incident(
          tx,
          s,
          slow,
          "",
          false,
          "Two consecutive responses below the configured latency threshold.",
        );
      const anomaly = rule("latencyAnomaly");
      const samples = (
        await tx.query(
          "SELECT latency FROM checks WHERE service_id=$1 AND success=1 ORDER BY at DESC LIMIT 33",
          [s.id],
        )
      ).rows.map((c) => c.latency);
      if (success && samples.length >= 23 && anomaly) {
        const baseline = samples.slice(3),
          mean = baseline.reduce((a, v) => a + v, 0) / baseline.length;
        const std = Math.sqrt(
          baseline.reduce((a, v) => a + (v - mean) ** 2, 0) / baseline.length,
        );
        const cutoff = Math.max(
          mean + anomaly.threshold * std,
          mean * 1.5,
          mean + 50,
        );
        if (samples.slice(0, 3).every((v) => v > cutoff))
          await incident(
            tx,
            s,
            anomaly,
            "",
            true,
            `Three unusual responses. Baseline ${mean.toFixed(0)} ms; standard deviation ${std.toFixed(0)} ms; detection threshold ${cutoff.toFixed(0)} ms. Latest ${latency} ms. Statistical detection, not a root-cause diagnosis.`,
          );
        else if (samples.slice(0, 2).every((v) => v <= cutoff))
          await incident(
            tx,
            s,
            anomaly,
            "",
            false,
            "Two successful checks returned within the rolling response-time baseline.",
          );
      }
      await tx.query(
        "INSERT INTO events(id,service_id,type,subject,at,value,duration,status_code,level,message,trace_id) VALUES($1,$2,$3,$4,$5,NULL,$6,$7,$8,$9,$10)",
        [
          randomUUID(),
          s.id,
          "health_check",
          "",
          signal.at,
          latency,
          statusCode,
          success ? "info" : "error",
          success
            ? `Health check returned HTTP ${statusCode} in ${latency} ms`
            : error || "Health check failed",
          signal.id.slice(0, 12),
        ],
      );
    } else {
      const e = signal.event;
      await tx.query(
        "INSERT INTO events(id,service_id,type,subject,at,value,duration,status_code,level,message,trace_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
        [
          signal.id,
          s.id,
          e.type,
          e.subject ? hash(e.subject) : "",
          signal.at,
          e.value ?? null,
          e.duration ?? null,
          e.statusCode ?? null,
          e.level,
          e.message,
          e.traceId || signal.id.slice(0, 12),
        ],
      );
    }
    await evaluateWindows(tx, s, rules);
    return { processed: true };
  });
}
export async function evaluateWindows(tx, s, rules) {
  const now = Date.now();
  for (const r of rules.filter((r) =>
    ["authFailures", "cpu", "errorRate"].includes(r.metric),
  )) {
    const cutoff = new Date(now - r.window_seconds * 1000).toISOString();
    if (r.metric === "authFailures") {
      const groups = (
        await tx.query(
          "SELECT subject,COUNT(*) AS count FROM events WHERE service_id=$1 AND type='auth_failure' AND at>$2 GROUP BY subject",
          [s.id, cutoff],
        )
      ).rows;
      const scopes = new Set(groups.map((g) => g.subject));
      for (const g of groups)
        await incident(
          tx,
          s,
          r,
          g.subject,
          Number(g.count) >= r.threshold,
          `${g.count} authentication failures for account fingerprint ${g.subject.slice(0, 8)} in ${r.window_seconds} seconds.`,
        );
      const active = (
        await tx.query(
          "SELECT scope FROM incidents WHERE service_id=$1 AND rule_id=$2 AND status<>'resolved'",
          [s.id, r.id],
        )
      ).rows;
      for (const i of active)
        if (!scopes.has(i.scope))
          await incident(
            tx,
            s,
            r,
            i.scope,
            false,
            "No failures in the current authentication window.",
          );
    }
    if (r.metric === "errorRate") {
      const totals = (
        await tx.query(
          "SELECT COUNT(*) AS count,SUM(CASE WHEN status_code>=500 THEN 1 ELSE 0 END) AS failures FROM events WHERE service_id=$1 AND type='request' AND at>$2",
          [s.id, cutoff],
        )
      ).rows[0];
      const count = Number(totals.count),
        pct = count ? (Number(totals.failures) / count) * 100 : 0;
      if (count >= 20)
        await incident(
          tx,
          s,
          r,
          "",
          pct > r.threshold,
          `${Number(totals.failures)} of ${count} requests returned HTTP 5xx (${pct.toFixed(1)}%) in ${r.window_seconds} seconds.`,
        );
    }
    if (r.metric === "cpu") {
      const samples = (
        await tx.query(
          "SELECT at,value FROM events WHERE service_id=$1 AND type='cpu' AND at>$2 ORDER BY at DESC LIMIT 10",
          [s.id, cutoff],
        )
      ).rows;
      if (samples.length >= r.consecutive) {
        const recent = samples.slice(0, r.consecutive);
        const sustained =
          recent.every((e) => e.value > r.threshold) &&
          new Date(recent[0].at) - new Date(recent.at(-1).at) >=
            (r.consecutive - 1) * 50000;
        const recovered = recent
          .slice(0, 2)
          .every((e) => e.value <= r.threshold);
        if (sustained)
          await incident(
            tx,
            s,
            r,
            "",
            true,
            `${r.consecutive} sustained CPU samples above ${r.threshold}%; latest ${recent[0].value}%.`,
          );
        else if (recovered)
          await incident(
            tx,
            s,
            r,
            "",
            false,
            "Two consecutive CPU samples are below the configured threshold.",
          );
      }
    }
  }
}
export async function maintenance(db) {
  await db.tx(async (tx) => {
    const services = (await tx.query("SELECT * FROM services WHERE enabled=1"))
        .rows,
      rules = (await tx.query("SELECT * FROM rules")).rows;
    for (const s of services) await evaluateWindows(tx, s, rules);
    const retention = (
      await tx.query("SELECT retention FROM settings WHERE id=1")
    ).rows[0].retention;
    const cutoff = new Date(Date.now() - retention * 86400000).toISOString();
    for (const table of ["checks", "events", "audit"])
      await tx.query(`DELETE FROM ${table} WHERE at<$1`, [cutoff]);
    await tx.query("DELETE FROM sessions WHERE expires_at<$1", [iso()]);
    await tx.query("DELETE FROM outbox WHERE status='sent' AND sent_at<$1", [
      new Date(Date.now() - 7 * 86400000).toISOString(),
    ]);
    await tx.query("DELETE FROM processed_signals WHERE at<$1", [
      new Date(Date.now() - 30 * 86400000).toISOString(),
    ]);
  });
}
