# CloudOps AI

A live monitoring and incident-management application with a neutral React dashboard and a Node.js/Express backend.

## What works now

- Administrator setup/login/logout, scrypt password hashing, expiring HttpOnly session cookies, CSRF protection, origin checks, rate limits, and security headers.
- Scheduled real HTTP(S) health checks: configured interval, timeout, expected status, pause/resume, and check-now controls.
- Availability and latency detection, incident deduplication, acknowledgement, evidence, timeline, and automatic recovery.
- Per-service ingestion tokens for request events, login failures, CPU samples, and logs. Tokens are hashed; event retries are idempotent.
- Error-rate and account-specific authentication rules, sustained CPU thresholds, and rolling statistical latency anomalies.
- Dashboard polling, actual metric charts, searchable events, CSV exports, worker heartbeat warnings, and delivery retries.
- Normalized tables, database transactions, worker leases, and durable delivery outbox. SQLite for local development; PostgreSQL required in production.
- AWS SDK integration: SQS producer, FIFO-aware Lambda processor, SNS alerts, CloudWatch CPU reads, Parameter Store configuration, and S3 log archives.
- Docker deployment files, IAM templates, and detailed manual AWS Console instructions.

There are no pre-populated service metrics or incidents in live mode. The previous demo data file is preserved but not imported.

## Start locally

Requires **Node.js 24**.

```sh
npm ci
npm run dev
```

On Windows PowerShell use `npm.cmd` if script execution policy blocks `npm.ps1`. Open **http://127.0.0.1:5173**. The first visit lets you create an administrator; choose your own password of at least 12 characters. A monitoring worker starts with the development server.

In another terminal, run `npm run example`, register `http://127.0.0.1:4100/health`, and follow [the real HTTP testing walkthrough](docs/LOCAL-TESTING.md).

Copy `.env.example` to `.env` to change configuration. Without `DATABASE_URL`, data lives in `data/cloudops.sqlite`. Do not run local development mode on a public server. The loopback test-target exception is restricted to `127.0.0.1:4100` and disabled in production.

## Build and verify

```sh
npm test
npm run build
npm start
```

`npm start` serves the compiled UI and API on port 4000. Start `npm run worker` in another terminal when not using the development command. Database schema/default rules are applied idempotently at startup; `npm run migrate` also applies them explicitly.

The automated suite exercises real HTTP failure/timeout/redirect handling, network target protection, authentication and CSRF, ingestion token scope, idempotency, thresholds, anomaly warm-up, recovery, worker claims, retention, alert retries, and FIFO partial failure behavior.

SQLite tests do not verify your RDS instance or AWS account. The Docker/PostgreSQL and AWS acceptance steps must pass before relying on production alerts. Browser visual verification was unavailable in the coding environment.

## Deploy on AWS

Follow [**AWS-DEPLOYMENT.md**](docs/AWS-DEPLOYMENT.md) in order. You perform the Console steps; this repository does not create or deploy AWS resources automatically.

```text
Browser → HTTPS ALB → EC2 API/UI → RDS
                     EC2 worker → scheduled HTTP checks
Application events → API → durable outbox → SQS FIFO → Lambda → RDS incidents
                                                          └→ alert outbox
                     EC2 worker → SNS notifications / S3 archives
                     EC2 worker ← CloudWatch CPU metrics
```

Production uses a separate worker process, PostgreSQL with verified TLS, HTTPS Secure cookies, IAM instance/function roles, and configuration from Parameter Store. The application does not require static AWS access keys. AWS integration indicators mean configuration is present; they do not prove delivery. Confirm real messages and objects using the guide.

## Instrument your own application

Generate an ingestion token in a service's detail panel. Use [examples/cloudops-client.js](examples/cloudops-client.js) from your application's backend:

```js
import { createCloudOpsClient } from './cloudops-client.js';

const telemetry = createCloudOpsClient({
  url: process.env.CLOUDOPS_URL,
  token: process.env.CLOUDOPS_INGESTION_TOKEN,
  onError: () => console.error('CloudOps telemetry delivery failed'),
});
app.use(telemetry.middleware);

// Emit at the point where your application actually rejects a login.
telemetry.emit({
  type: 'auth_failure',
  subject: accountId,
  message: 'Login rejected',
  level: 'warn',
});
```

The helper's bounded in-memory buffer retries deliveries five times and never blocks request responses. It is not a durable log agent; events can be lost when the monitored application crashes. Use your established logging pipeline when durable event collection is required. Never log passwords, bearer tokens, payment details, or other unnecessary sensitive payloads.

## Reset an administrator password

Local: temporarily set `RESET_EMAIL` and `RESET_PASSWORD` in your untracked `.env`, run `npm run admin:reset`, then remove those values. The operation revokes all sessions. It requires access to the server environment; no unauthenticated password-reset API exists.

AWS: create temporary SecureString `/cloudops/prod/RESET_PASSWORD` and String `/cloudops/prod/RESET_EMAIL` parameters. In the EC2 deployment directory run:

```sh
sudo docker compose run --rm api node scripts/reset-password.mjs
```

Remove the reset parameters immediately afterward. Changing the bootstrap `ADMIN_PASSWORD` parameter alone does not change an existing account.

## Operating boundaries

This is a single-workspace operations MVP for a controlled deployment. It does not implement multi-tenant isolation, SSO/MFA, on-call rotations, escalation policies, tracing, automatic remediation, or a trained AI model. Latency anomalies use an explicit statistical rolling baseline.

The dashboard returns the latest 500 incidents/logs and 24 hours of metric aggregates. It is designed for modest service counts; validate your workload and database behavior before scaling. Transactions currently use an application advisory lock for simple cross-process consistency. Larger workloads require narrower locks, query pagination, and capacity testing.

Alerts are delivered at least once. A worker crash after a successful publish but before recording it can cause a duplicate notification; the incident ID is included for correlation. Ten failed delivery attempts mark a job failed for manual retry. No SNS configuration means no email delivery. Recoveries can generate notifications for all configured severities.

Default target protection blocks private, loopback, reserved, and metadata addresses, pins validated DNS results, and rejects redirects. Exact trusted private hostnames can be explicitly allowlisted by server configuration. Use network egress controls too. CPU/request absence appears as missing data, not zero. An independent platform watchdog is necessary when this monitoring system itself fails.

Daily S3 archives cover the previous UTC day. Check archive delivery failures; downtime or very late telemetry may require a manual backfill. Database retention still runs on the configured schedule, so archive verification matters. Incident history is retained independently of telemetry retention. Keep backups and test restores.
