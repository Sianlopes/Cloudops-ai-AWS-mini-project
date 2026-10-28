// Per-service insights built from the requests an application reports about itself:
// a traffic summary, one row per endpoint, per-minute series and recent log lines.
const RANGES = { "1h": 3600000, "6h": 6 * 3600000, "24h": 86400000 };
const MAX_ROWS = 100000; // safety cap on request events read per call
const MAX_ENDPOINTS = 50; // the rest are folded into one "Other" row
const minute = (at) =>
  new Date(Math.floor(new Date(at).getTime() / 60000) * 60000).toISOString();
const avg = (list) =>
  list.length ? list.reduce((n, v) => n + v, 0) / list.length : null;
const round = (v, d = 0) => (v == null ? null : Number(v.toFixed(d)));
export const endpointKey = (r) =>
  r.route ? `${r.method || ""} ${r.route}`.trim() : "(no route)";

export function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)];
}
// Requests, 5xx errors, error rate and latency for a list of request rows.
export function summarize(rows) {
  const durations = rows.map((r) => Number(r.duration)).filter(Number.isFinite);
  const errors = rows.filter((r) => Number(r.status_code) >= 500).length;
  return {
    requests: rows.length,
    errors,
    errorRate: rows.length ? round((errors / rows.length) * 100, 1) : null,
    avgMs: round(avg(durations)),
    p95Ms: round(percentile(durations, 0.95)),
  };
}
function splitEndpoint(endpoint) {
  const m = /^([A-Z]{3,10}) (\/.*)$/.exec(endpoint);
  return m ? { method: m[1], route: m[2] } : { method: null, route: endpoint };
}

export async function serviceInsights(db, serviceId, { range = "24h", endpoint = "" } = {}) {
  if (!RANGES[range]) range = "24h";
  const exists = (
    await db.query("SELECT id FROM services WHERE id=$1", [serviceId])
  ).rows.length;
  if (!exists) return null;
  const since = new Date(Date.now() - RANGES[range]).toISOString();

  const requests = (
    await db.query(
      "SELECT method,route,status_code,duration,at FROM events WHERE service_id=$1 AND type='request' AND at>=$2 ORDER BY at DESC LIMIT " +
        MAX_ROWS,
      [serviceId, since],
    )
  ).rows;

  // One row per endpoint.
  const groups = new Map();
  for (const r of requests) {
    const key = endpointKey(r);
    if (!groups.has(key)) groups.set(key, { key, method: r.method, route: r.route, rows: [] });
    groups.get(key).rows.push(r);
  }
  const toEndpoint = (g) => ({
    key: g.key,
    method: g.method,
    route: g.route,
    ...summarize(g.rows),
    lastAt: g.rows[0]?.at || null, // rows are newest first
  });
  const ranked = [...groups.values()].sort((a, b) => b.rows.length - a.rows.length);
  const endpoints = ranked.slice(0, MAX_ENDPOINTS).map(toEndpoint);
  const rest = ranked.slice(MAX_ENDPOINTS);
  if (rest.length)
    endpoints.push({
      key: `Other (${rest.length} endpoints)`,
      method: null,
      route: null,
      other: true,
      ...summarize(rest.flatMap((g) => g.rows)),
      lastAt: rest.map((g) => g.rows[0]?.at).sort().at(-1) || null,
    });

  // Per-minute series. Filtering to one endpoint leaves only its own request data.
  const selected = endpoint
    ? requests.filter((r) => endpointKey(r) === endpoint)
    : requests;
  const buckets = new Map();
  const bucket = (at) => {
    const key = minute(at);
    if (!buckets.has(key))
      buckets.set(key, { timestamp: key, checks: [], durations: [], requests: 0, failed: 0, cpu: [] });
    return buckets.get(key);
  };
  for (const r of selected) {
    const b = bucket(r.at);
    b.requests++;
    if (Number(r.status_code) >= 500) b.failed++;
    if (Number.isFinite(Number(r.duration))) b.durations.push(Number(r.duration));
  }
  if (!endpoint) {
    for (const c of (
      await db.query(
        "SELECT at,latency FROM checks WHERE service_id=$1 AND at>=$2 ORDER BY at",
        [serviceId, since],
      )
    ).rows)
      bucket(c.at).checks.push(Number(c.latency));
    for (const c of (
      await db.query(
        "SELECT at,value FROM events WHERE service_id=$1 AND type='cpu' AND at>=$2 ORDER BY at",
        [serviceId, since],
      )
    ).rows)
      bucket(c.at).cpu.push(Number(c.value));
  }
  const series = [...buckets.values()]
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
    .map((b) => ({
      timestamp: b.timestamp,
      latency: round(avg(b.checks)),
      appLatency: round(avg(b.durations)),
      requests: b.requests || null,
      errorRate: b.requests ? round((b.failed / b.requests) * 100, 2) : null,
      cpu: round(avg(b.cpu), 2),
    }));

  // Recent log lines (optionally only this endpoint's requests).
  let sql =
    "SELECT id,at,type,level,message,status_code,duration,method,route FROM events WHERE service_id=$1 AND at>=$2";
  const args = [serviceId, since];
  if (endpoint) {
    if (endpoint === "(no route)") sql += " AND type='request' AND route IS NULL";
    else {
      const { method, route } = splitEndpoint(endpoint);
      sql += " AND type='request' AND route=$3";
      args.push(route);
      if (method) {
        sql += " AND method=$4";
        args.push(method);
      }
    }
  }
  const logs = (
    await db.query(sql + " ORDER BY at DESC LIMIT 200", args)
  ).rows.map((l) => ({
    id: l.id,
    at: l.at,
    type: l.type,
    level: l.level,
    message: l.message,
    statusCode: l.status_code,
    duration: l.duration,
  }));

  return {
    range,
    endpoint,
    traffic: { ...summarize(requests), endpoints: groups.size },
    endpoints,
    series,
    logs,
  };
}
