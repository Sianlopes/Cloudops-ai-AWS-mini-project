# Real monitoring on your computer

## Start the application

Requires Node.js 24. In this folder:

```powershell
npm.cmd ci
npm.cmd run dev
```

Open http://127.0.0.1:5173. Create your administrator using a unique password of at least 12 characters. There is no preset account. The local database is `data/cloudops.sqlite`.

In another terminal:

```powershell
npm.cmd run example
```

Register a service through **Services → Add service**:

- Name: Test API
- Endpoint: `http://127.0.0.1:4100/health`
- Interval: 15 seconds
- Timeout: 5000 ms
- Expected HTTP status: 200

`npm run dev` allows exactly this loopback host and port for the controlled example. The exception is disabled in production. Other private/reserved targets remain blocked.

## Create an actual outage

```powershell
Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:4100/scenario' -ContentType 'application/json' -Body '{"scenario":"outage"}'
```

The example endpoint now really returns HTTP 503. After three failed checks, an availability incident appears. Inspect its evidence and acknowledge it. Repeated failures update the existing incident.

Restore health:

```powershell
Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:4100/scenario' -ContentType 'application/json' -Body '{"scenario":"healthy"}'
```

After two healthy checks, the availability incident resolves. Choose `slow` to delay responses by 1500 ms; three slow checks trigger the latency rule.

Without SNS configuration, alerts are **queued and retried**, not emailed. Settings shows this explicitly. Real endpoint monitoring and incident detection still work locally.

## Send application events

Open a service detail and click **Create ingestion token**. Copy it securely; generating another token revokes the old one. Put it in your application environment. Do not put it in frontend code or Git.

An HTTP client sends:

```http
POST /api/events
Authorization: Bearer YOUR_SERVICE_TOKEN
Content-Type: application/json

{"id":"unique-event-001","type":"request","statusCode":503,"duration":120,"level":"error","message":"Order request failed"}
```

Supported event types:

| Type | Required additional fields | Rule |
|---|---|---|
| `request` | `statusCode`, `duration` in ms | 5xx percentage over five minutes, minimum 20 requests |
| `auth_failure` | `subject`, a stable account identifier | Five failures for the same account over five minutes |
| `cpu` | `value` between 0 and 100 | Five sustained samples, spaced roughly a minute apart |
| `log` | No additional fields | Stored and searchable |

All events require `id` (8–128 letters, digits, underscores, or dashes), `type`, and `message`. `level` defaults to `info`; `traceId` is optional. Reuse the event ID when retrying a delivery: it prevents double counting. IDs are scoped to their service. Authentication subjects are stored as SHA-256 fingerprints, not cleartext; avoid sensitive information in log messages.

Dashboard charts use **actual** collected values. CPU and request charts stay empty until the relevant events arrive. Availability is successful scheduled probes divided by all recorded probes since registration; it is not a contractual uptime measurement.

## Statistical anomaly detection

The anomaly rule needs at least 20 baseline successful checks and three recent successful checks. It compares recent latency with the baseline mean and configurable standard deviations, plus floors of 1.5× the mean and mean+50 ms to avoid noisy tiny changes. Three unusual responses create an incident; two responses within the baseline resolve it. This is statistical detection, not a trained model or a proven root-cause diagnosis.

## Verify persistence and protection

- Restart the app: your services, incidents, rules, and administrator persist.
- Sign out: private API routes return 401.
- Try an expired or invalid ingestion token: ingestion returns 401.
- Try write requests without the CSRF header: authenticated writes return 403.
- Register a metadata/private endpoint: its check is blocked; no network request is made to it.
- Pause a service: its scheduled checks stop; resume to start again.

Run `npm.cmd test` for automated checks. For PostgreSQL testing, see the Docker Compose instructions in the AWS deployment guide. The test suite uses SQLite by default; RDS and actual AWS delivery must be tested in your deployment.
