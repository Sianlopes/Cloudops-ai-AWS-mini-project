export async function workspace(db) {
  const [
    services,
    incidents,
    timeline,
    rules,
    settings,
    logs,
    checks,
    events,
    worker,
    delivery,
  ] = await Promise.all([
    db.query("SELECT * FROM services ORDER BY name"),
    db.query("SELECT * FROM incidents ORDER BY detected_at DESC LIMIT 500"),
    db.query("SELECT * FROM timeline ORDER BY at"),
    db.query("SELECT * FROM rules ORDER BY id"),
    db.query("SELECT * FROM settings WHERE id=1"),
    db.query("SELECT * FROM events ORDER BY at DESC LIMIT 500"),
    db.query("SELECT * FROM checks WHERE at>$1 ORDER BY at", [
      new Date(Date.now() - 86400000).toISOString(),
    ]),
    db.query(
      "SELECT * FROM events WHERE type IN ('request','cpu') AND at>$1 ORDER BY at",
      [new Date(Date.now() - 86400000).toISOString()],
    ),
    db.query("SELECT * FROM heartbeats WHERE id='worker'"),
    db.query(
      "SELECT id,kind,status,attempts,next_attempt,last_error,sent_at FROM outbox ORDER BY next_attempt DESC LIMIT 50",
    ),
  ]);
  const buckets = new Map();
  const bucket = (at) => {
    const key = new Date(
      Math.floor(new Date(at).getTime() / 60000) * 60000,
    ).toISOString();
    if (!buckets.has(key))
      buckets.set(key, {
        timestamp: key,
        latencies: [],
        requests: 0,
        failedRequests: 0,
        cpuSamples: [],
      });
    return buckets.get(key);
  };
  for (const c of checks.rows) bucket(c.at).latencies.push(c.latency);
  for (const e of events.rows) {
    const b = bucket(e.at);
    if (e.type === "cpu") b.cpuSamples.push(e.value);
    else {
      b.requests++;
      if (e.status_code >= 500) b.failedRequests++;
    }
  }
  const metrics = [...buckets.values()]
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
    .map((b) => ({
      timestamp: b.timestamp,
      latency: b.latencies.length
        ? Math.round(
            b.latencies.reduce((a, v) => a + v, 0) / b.latencies.length,
          )
        : null,
      requests: b.requests || null,
      errorRate: b.requests
        ? Number(((b.failedRequests / b.requests) * 100).toFixed(2))
        : null,
      cpu: b.cpuSamples.length
        ? Number(
            (
              b.cpuSamples.reduce((a, v) => a + v, 0) / b.cpuSamples.length
            ).toFixed(2),
          )
        : null,
    }));
  return {
    mode: "live",
    storage: db.kind,
    settings: settings.rows[0],
    services: services.rows.map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description,
      endpoint: s.endpoint,
      region: s.region,
      status: s.status,
      latency: s.latency,
      uptime: s.uptime,
      enabled: !!s.enabled,
      intervalSeconds: s.interval_seconds,
      timeoutMs: s.timeout_ms,
      expectedStatus: s.expected_status,
      instanceId: s.instance_id,
      lastChecked: s.last_checked,
      lastError: s.last_error,
    })),
    incidents: incidents.rows.map((i) => ({
      id: i.id,
      serviceId: i.service_id,
      ruleId: i.rule_id,
      title: i.title,
      severity: i.severity,
      status: i.status,
      detectedAt: i.detected_at,
      updatedAt: i.updated_at,
      evidence: i.evidence,
      timeline: timeline.rows
        .filter((t) => t.incident_id === i.id)
        .map((t) => ({ at: t.at, text: t.message })),
    })),
    rules: rules.rows.map((r) => ({ ...r, enabled: !!r.enabled })),
    logs: logs.rows.map((e) => ({
      id: e.id,
      at: e.at,
      serviceId: e.service_id,
      level: e.level,
      message: e.message,
      traceId: e.trace_id,
    })),
    metrics,
    worker: {
      lastHeartbeat: worker.rows[0]?.at || null,
      healthy:
        !!worker.rows[0] && Date.now() - new Date(worker.rows[0].at) < 120000,
    },
    deliveries: delivery.rows.map((d) => ({
      id: d.id,
      kind: d.kind,
      status: d.status,
      attempts: d.attempts,
      lastError: d.last_error,
      nextAttempt: d.next_attempt,
      sentAt: d.sent_at,
    })),
  };
}
