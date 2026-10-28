CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, csrf TEXT NOT NULL, expires_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY, workspace TEXT NOT NULL, email TEXT NOT NULL, region TEXT NOT NULL, retention INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS rules (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL, metric TEXT NOT NULL, threshold REAL NOT NULL, unit TEXT NOT NULL, severity TEXT NOT NULL, enabled INTEGER NOT NULL, consecutive INTEGER NOT NULL, window_seconds INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS services (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL, endpoint TEXT NOT NULL, region TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending', latency REAL, uptime REAL, enabled INTEGER NOT NULL DEFAULT 1,
 interval_seconds INTEGER NOT NULL, timeout_ms INTEGER NOT NULL, expected_status INTEGER NOT NULL,
 key_hash TEXT, instance_id TEXT, last_checked TEXT, last_evaluated TEXT, last_error TEXT,
 next_check TEXT NOT NULL, lease_until TEXT, total_checks INTEGER NOT NULL DEFAULT 0, successful_checks INTEGER NOT NULL DEFAULT 0,
 failure_streak INTEGER NOT NULL DEFAULT 0, slow_streak INTEGER NOT NULL DEFAULT 0, recovery_streak INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS checks (id TEXT PRIMARY KEY, service_id TEXT NOT NULL REFERENCES services(id) ON DELETE CASCADE, at TEXT NOT NULL, success INTEGER NOT NULL, status_code INTEGER, latency REAL NOT NULL, error TEXT, cpu REAL);
CREATE INDEX IF NOT EXISTS checks_service_time ON checks(service_id,at);
CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, service_id TEXT NOT NULL REFERENCES services(id) ON DELETE CASCADE, type TEXT NOT NULL, subject TEXT NOT NULL DEFAULT '', at TEXT NOT NULL, value REAL, duration REAL, status_code INTEGER, level TEXT NOT NULL, message TEXT NOT NULL, trace_id TEXT NOT NULL, method TEXT, route TEXT);
CREATE INDEX IF NOT EXISTS events_service_time ON events(service_id,at);
CREATE TABLE IF NOT EXISTS incidents (id TEXT PRIMARY KEY, service_id TEXT NOT NULL REFERENCES services(id) ON DELETE CASCADE, rule_id TEXT NOT NULL REFERENCES rules(id), scope TEXT NOT NULL DEFAULT '', title TEXT NOT NULL, severity TEXT NOT NULL, status TEXT NOT NULL, detected_at TEXT NOT NULL, updated_at TEXT NOT NULL, evidence TEXT NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS one_active_incident ON incidents(service_id,rule_id,scope) WHERE status <> 'resolved';
CREATE TABLE IF NOT EXISTS timeline (id TEXT PRIMARY KEY, incident_id TEXT NOT NULL REFERENCES incidents(id) ON DELETE CASCADE, at TEXT NOT NULL, message TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS timeline_incident ON timeline(incident_id,at);
CREATE TABLE IF NOT EXISTS outbox (id TEXT PRIMARY KEY, kind TEXT NOT NULL, payload TEXT NOT NULL, status TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, next_attempt TEXT NOT NULL, lease_until TEXT, last_error TEXT, sent_at TEXT);
CREATE INDEX IF NOT EXISTS outbox_due ON outbox(status,next_attempt);
CREATE TABLE IF NOT EXISTS processed_signals (id TEXT PRIMARY KEY, at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS audit (id TEXT PRIMARY KEY, user_id TEXT, action TEXT NOT NULL, resource TEXT NOT NULL, at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS heartbeats (id TEXT PRIMARY KEY, at TEXT NOT NULL, detail TEXT NOT NULL);
