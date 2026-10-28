import { mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import pg from "pg";
import { defaultRules } from "./defaults.js";
export async function openDatabase({
  url = process.env.DATABASE_URL,
  file = process.env.SQLITE_PATH || "data/cloudops.sqlite",
  production = process.env.NODE_ENV === "production",
} = {}) {
  if (production && !url)
    throw Error("Production requires DATABASE_URL (PostgreSQL).");
  if (production && process.env.DB_SSL !== "true")
    throw Error(
      "Production requires DB_SSL=true and a trusted PostgreSQL CA certificate.",
    );
  let pool,
    sqlite,
    tail = Promise.resolve();
  if (url) {
    let ssl;
    if (process.env.DB_SSL === "true") {
      ssl = { rejectUnauthorized: true };
      if (process.env.DB_CA_FILE)
        ssl.ca = await readFile(process.env.DB_CA_FILE, "utf8");
    }
    pool = new pg.Pool({
      connectionString: url,
      ssl,
      max: 10,
      connectionTimeoutMillis: 10000,
    });
  } else {
    const { DatabaseSync } = await import("node:sqlite");
    if (file !== ":memory:")
      await mkdir(dirname(resolve(file)), { recursive: true });
    sqlite = new DatabaseSync(file);
    sqlite.exec(
      "PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=10000;",
    );
  }
  function wrap(client) {
    return {
      async query(sql, args = []) {
        if (pool) return client.query(sql, args);
        const values = [];
        const text = sql.replace(/\$(\d+)/g, (_, n) => {
          values.push(args[Number(n) - 1]);
          return "?";
        });
        const stmt = sqlite.prepare(text);
        if (/^\s*(SELECT|WITH)/i.test(text) || /\bRETURNING\b/i.test(text))
          return { rows: stmt.all(...values), rowCount: 0 };
        const result = stmt.run(...values);
        return { rows: [], rowCount: Number(result.changes) };
      },
    };
  }
  const db = {
    kind: pool ? "postgresql" : "sqlite",
    ...wrap(pool),
    async tx(fn) {
      if (pool) {
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          await client.query("SELECT pg_advisory_xact_lock(728410)");
          const result = await fn(wrap(client));
          await client.query("COMMIT");
          return result;
        } catch (e) {
          await client.query("ROLLBACK");
          throw e;
        } finally {
          client.release();
        }
      }
      const result = tail.then(async () => {
        sqlite.exec("BEGIN IMMEDIATE");
        try {
          const value = await fn(wrap(sqlite));
          sqlite.exec("COMMIT");
          return value;
        } catch (e) {
          sqlite.exec("ROLLBACK");
          throw e;
        }
      });
      tail = result.catch(() => {});
      return result;
    },
    async close() {
      if (pool) await pool.end();
      else sqlite.close();
    },
  };
  const schema = await readFile(
    new URL("./schema.sql", import.meta.url),
    "utf8",
  );
  await db.tx(async (tx) => {
    for (const statement of schema
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean))
      await tx.query(statement);
    await tx.query(
      "INSERT INTO schema_migrations(version,applied_at) VALUES(1,$1) ON CONFLICT(version) DO NOTHING",
      [new Date().toISOString()],
    );
    // Migration 2: HTTP method and route on request events (per-endpoint monitoring).
    // New databases get these columns from schema.sql; this adds them to existing ones.
    for (const column of ["method", "route"]) {
      if (db.kind === "postgresql")
        await tx.query(
          `ALTER TABLE events ADD COLUMN IF NOT EXISTS ${column} TEXT`,
        );
      else if (
        !(
          await tx.query("SELECT name FROM pragma_table_info('events')")
        ).rows.some((c) => c.name === column)
      )
        await tx.query(`ALTER TABLE events ADD COLUMN ${column} TEXT`);
    }
    await tx.query(
      "INSERT INTO schema_migrations(version,applied_at) VALUES(2,$1) ON CONFLICT(version) DO NOTHING",
      [new Date().toISOString()],
    );
    await tx.query(
      "UPDATE rules SET description=$1,unit=$2 WHERE id='rule-errors' AND description='HTTP 5xx responses in a five-minute window'",
      [
        "HTTP 5xx responses per endpoint in a five-minute window",
        "% · minimum 10 requests per endpoint",
      ],
    );
    await tx.query(
      "INSERT INTO settings(id,workspace,email,region,retention) VALUES(1,$1,$2,$3,30) ON CONFLICT(id) DO NOTHING",
      ["CloudOps workspace", "", "ap-south-1"],
    );
    for (const r of defaultRules)
      await tx.query(
        "INSERT INTO rules(id,name,description,metric,threshold,unit,severity,enabled,consecutive,window_seconds) VALUES($1,$2,$3,$4,$5,$6,$7,1,$8,$9) ON CONFLICT(id) DO NOTHING",
        [
          r.id,
          r.name,
          r.description,
          r.metric,
          r.threshold,
          r.unit,
          r.severity,
          r.metric === "latency" ? 3 : r.metric === "cpu" ? 5 : 1,
          300,
        ],
      );
    await tx.query(
      "INSERT INTO rules(id,name,description,metric,threshold,unit,severity,enabled,consecutive,window_seconds) VALUES($1,$2,$3,$4,10,$5,$6,1,1,300) ON CONFLICT(id) DO NOTHING",
      [
        "rule-errors",
        "API error rate",
        "HTTP 5xx responses per endpoint in a five-minute window",
        "errorRate",
        "% · minimum 10 requests per endpoint",
        "high",
      ],
    );
    await tx.query(
      "INSERT INTO rules(id,name,description,metric,threshold,unit,severity,enabled,consecutive,window_seconds) VALUES($1,$2,$3,$4,3,$5,$6,1,3,300) ON CONFLICT(id) DO NOTHING",
      [
        "rule-anomaly",
        "Unusual response latency",
        "Statistical deviation from a rolling baseline of successful checks",
        "latencyAnomaly",
        "standard deviations · 20+ baseline checks",
        "warning",
      ],
    );
  });
  return db;
}
