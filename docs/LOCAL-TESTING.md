# Trying CloudOps on your computer

Requires Node.js 24. Open two terminals in the project folder (on Windows PowerShell use `npm.cmd` if script execution is blocked).

```sh
npm ci
npm run dev          # terminal 1: dashboard on http://127.0.0.1:5173
npm run demo-shop    # terminal 2: demo shop on http://127.0.0.1:4100
```

Create the administrator account on first visit (a password of at least 12 characters; there is no preset account). Locally, alerts are queued and retried because no SNS topic is configured; everything else works.

## 1. A health check

**Add service**, then enter:

- Name: `Acme Shop`
- Health-check URL: `http://127.0.0.1:4100/health` (the loopback demo target is allowed in development only)
- Interval: 15 seconds, expected status 200

Within seconds the service turns healthy and the Services page shows its check history.

## 2. A real outage

Open `http://127.0.0.1:4100/control`, choose **Shop down**, and after three failed checks a **Service availability** incident appears. Choose **Healthy** and it resolves by itself after two healthy checks. **Slow** triggers the response-latency rule.

## 3. Connect the application

1. Open the service in CloudOps and click **Connect your app**. Copy the token.
2. Paste it into the **Connect to CloudOps** box on the shop's control page and click Connect.
3. Under **Simulate real usage**, start **Customer traffic**. The service page now shows real traffic and an **Endpoints** table (requests, errors, average and p95 time for each endpoint).
4. Choose **Payments failing**: `/health` stays green, but `POST /api/orders` fails. An **API error rate** incident opens for that endpoint.
5. Start **Password-guessing attack** to raise an **Authentication failures** incident.

## Rules in brief

| Rule | Trips when |
|---|---|
| Service availability | 3 consecutive failed health checks |
| Response latency | slow checks 3 times in a row |
| Unusual response latency | latency far above that service's own baseline (needs 20 earlier checks) |
| API error rate | more than 10% 5xx for one endpoint in 5 minutes (at least 10 requests) |
| Authentication failures | 5 failures for one account in 5 minutes |
| CPU utilization | 5 sustained samples above the threshold |

Availability and latency incidents resolve after two healthy checks; the window-based rules resolve when their window clears.

## Checks

- Restart the app: services, incidents, rules and the administrator persist.
- Signed out, private API routes return 401. Writes without the CSRF header return 403.
- Registering a private or metadata address is blocked; no request is made to it.
- `npm test` runs the automated suite on SQLite. PostgreSQL and real AWS delivery are verified on a deployment.
