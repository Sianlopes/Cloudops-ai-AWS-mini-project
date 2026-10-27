# CloudOps AI: AWS Console deployment guide

You create and manage the AWS resources. The repository supplies the application, monitoring worker, Lambda handler, Docker files, IAM policy templates, and validation steps. No resources have been created in your account.

Use **one region throughout**, for example `ap-south-1` (Mumbai). Replace `REGION`, `ACCOUNT`, `BUCKET`, domain names, and endpoints with your values. Account IDs and resource ARNs are identifiers; passwords and tokens are secrets. Keep secrets in Parameter Store and never commit them.

## 1. Verify the application locally first

Install Node.js 24, open this project directory, and run:

```powershell
npm.cmd ci
npm.cmd test
npm.cmd run dev
```

Open `http://127.0.0.1:5173`, create your administrator, then follow [LOCAL-TESTING.md](LOCAL-TESTING.md). Local data uses SQLite unless `DATABASE_URL` is configured. Production startup requires PostgreSQL with verified TLS. Old `data/demo.json` is deliberately not imported into the live database.

For a local PostgreSQL rehearsal, install Docker Desktop, set `POSTGRES_PASSWORD`, `ADMIN_EMAIL`, and `ADMIN_PASSWORD` in your untracked `.env`, then:

```powershell
docker compose up --build -d
```

Open `http://127.0.0.1:4000`. Use a URL-encoded PostgreSQL password in the connection string. The compose setup is local HTTP development only. AWS uses HTTPS and RDS.

## 2. Set a budget before creating resources

Console → **Billing and Cost Management → Budgets → Create budget**:

1. Select a monthly cost budget and enter your own maximum.
2. Add actual-cost notifications at 50%, 80%, and 100% and a forecast notification.
3. Enter your email and confirm any requested subscription.
4. Enable billing visibility and cost anomaly notifications if appropriate for your account.

A budget sends notifications; it does **not** automatically stop resources. ALB, RDS, NAT gateways, public IPv4 addresses, and retained logs can incur ongoing costs. Check the AWS calculator for your region and configuration before launching them. Do not assume the complete architecture is free.

## 3. Build the custom VPC

Console → **VPC → Create VPC → VPC and more**:

- Name: `cloudops-vpc`; IPv4 CIDR: `10.20.0.0/16`.
- Two Availability Zones.
- Two public subnets for the load balancer.
- Two private application subnets for EC2 and Lambda.
- Two private database subnets. Add these manually if the wizard creates only four subnets.
- Internet gateway attached to the VPC.
- Public route table: `0.0.0.0/0 → internet gateway`.
- Private application route tables: `0.0.0.0/0 → NAT gateway` in a public subnet.
- Database route tables: local VPC route only; no default internet route required.
- Enable DNS resolution and DNS hostnames.

Example subnets:

| Purpose | AZ A | AZ B |
|---|---|---|
| Public | `10.20.0.0/24` | `10.20.1.0/24` |
| Application | `10.20.10.0/24` | `10.20.11.0/24` |
| Database | `10.20.20.0/24` | `10.20.21.0/24` |

For the resilient configuration, use one NAT gateway per AZ. A one-NAT project configuration costs less but creates an egress dependency on one AZ. The worker needs outbound access to monitored public APIs; an AWS VPC endpoint alone cannot provide that access. An S3 gateway endpoint can reduce S3 traffic through NAT. Interface endpoints for SSM, ECR, SQS, CloudWatch Logs, and SNS are optional alternatives for AWS-service traffic, with their own costs.

## 4. Create security groups

Console → **VPC → Security groups**. All groups belong to `cloudops-vpc`.

| Group | Inbound rule | Purpose |
|---|---|---|
| `cloudops-alb-sg` | TCP 443 from intended users; TCP 80 only for redirect | HTTPS entry point |
| `cloudops-app-sg` | TCP 4000 **from `cloudops-alb-sg` only** | Express API/UI |
| `cloudops-lambda-sg` | No inbound rules | Queue processor |
| `cloudops-db-sg` | TCP 5432 from app SG and Lambda SG only | Private RDS |

Permit required outbound traffic: application/processor → RDS 5432 and AWS HTTPS 443; worker → approved health-check ports (normally 80/443). If you restrict outbound DNS, allow VPC DNS resolution. Use Systems Manager Session Manager rather than opening SSH to the internet.

Never expose RDS or application port 4000 directly to `0.0.0.0/0`. The app trusts exactly one reverse proxy when `TRUST_PROXY=1`; the SG restriction is part of that trust boundary.

## 5. Create RDS PostgreSQL

Console → **RDS → Subnet groups → Create DB subnet group**. Select both private database subnets.

Then **Databases → Create database → Standard create**:

- Engine: PostgreSQL 17 or another supported version after compatibility testing.
- Identifier: `cloudops-db`; initial database: `cloudops`.
- Master username: `cloudops_admin`; choose a unique password.
- VPC: your custom VPC; subnet group: your database subnet group.
- Public access: **No**.
- Security group: `cloudops-db-sg`.
- Enable storage encryption, automated backups, and deletion protection.
- Use Multi-AZ for real availability; a single-AZ mini-project deployment does not provide database failover.
- Check that the parameter group requires TLS (`rds.force_ssl=1`).

Record the **RDS hostname**, port, and database name. Certificate verification relies on the hostname, not the IP address. Download the public CA bundle:

```powershell
New-Item -ItemType Directory -Force certs
Invoke-WebRequest 'https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem' -OutFile 'certs/global-bundle.pem'
```

On an EC2 Session Manager shell, connect with `psql` using `sslmode=verify-full` and the CA bundle. Prompt for the master password; do not embed it in a command. Create an application user:

```sql
CREATE ROLE cloudops_app LOGIN;
\password cloudops_app
GRANT CONNECT ON DATABASE cloudops TO cloudops_app;
GRANT USAGE, CREATE ON SCHEMA public TO cloudops_app;
```

Use `cloudops_app` in `DATABASE_URL`, not the master user. The app owns its tables and needs DDL access for startup migrations. A larger deployment should separate migration and runtime database roles; this project uses one application database role. [RDS TLS guidance](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/PostgreSQL.Concepts.General.SSL.html)

## 6. Create SQS queues

Console → **SQS → Create queue**:

1. Create FIFO dead-letter queue: `cloudops-incidents-dlq.fifo`; retention: 14 days; enable encryption.
2. Create FIFO source queue: `cloudops-incidents.fifo`.
3. Visibility timeout: **180 seconds**; message retention: four days; receive wait time: 20 seconds.
4. Enable encryption; configure the DLQ with maximum receives: **5**.
5. Save its queue URL and ARN.

The worker groups messages by service and assigns an event ID for deduplication. Database idempotency protects against re-delivery after the queue deduplication interval. At a Lambda timeout of 30 seconds, 180 seconds meets AWS's recommendation of at least six times the function timeout. [SQS/Lambda configuration](https://docs.aws.amazon.com/lambda/latest/dg/services-sqs-configure.html)

## 7. Create SNS and S3

**SNS → Topics → Create topic**:

- Type: Standard; name: `cloudops-alerts`.
- Create an email subscription for each actual recipient.
- Click **Confirm subscription** in the email. Pending subscriptions receive no incident alerts.
- Record the topic ARN.

The website's contact email does not automatically subscribe someone to SNS. Add recipients in the Console. [SNS email confirmation](https://docs.aws.amazon.com/sns/latest/dg/sns-email-notifications.html)

**S3 → Create bucket**:

- Choose a globally unique bucket name in your region.
- Keep **Block all public access** on.
- Enable encryption and versioning as required.
- Add a lifecycle rule for the `logs/` prefix, such as archive or expire after your retention policy.

The worker queues yesterday's application-event logs as NDJSON objects in `logs/YYYY-MM-DD/`. Delivery jobs remain visible if uploads fail. CSV downloads in the dashboard are immediate local exports; they do not require S3.

## 8. Create CloudWatch log groups and IAM roles

**CloudWatch → Logs → Log groups**:

- `/cloudops/application`: container stdout/stderr, 30-day retention.
- `/aws/lambda/cloudops-incident-processor`: Lambda logs, 30-day retention.

**IAM → Roles → Create role**:

1. Create `cloudops-ec2-role`, trusted service **EC2**.
2. Attach `AmazonSSMManagedInstanceCore` for Session Manager.
3. Add an inline policy using [iam-ec2.json](../deploy/iam-ec2.json), replacing `REGION`, `ACCOUNT`, and `BUCKET`.
4. Create `cloudops-lambda-role`, trusted service **Lambda**.
5. Add the policy from [iam-lambda.json](../deploy/iam-lambda.json), replacing placeholders.

The Lambda role needs VPC network-interface actions, SQS receive/delete, its processor parameter path, and its pre-created log group. EC2 owns SQS sending, SNS publishing, S3 archiving, and CloudWatch CPU reads. The Lambda processor creates incidents and alert outbox rows; the worker delivers alerts.

These templates assume default AWS-managed encryption keys. If you select customer-managed KMS keys, add precisely scoped KMS permissions and update the key policies for Parameter Store, SQS, and SNS. Do not attach `AdministratorAccess`. Lambda does not need permission to read `/cloudops/prod/ADMIN_PASSWORD`.

## 9. Create Parameter Store configuration

Console → **Systems Manager → Parameter Store → Create parameter**. Use **SecureString** for the two password-bearing entries. Do not put SSL parameters such as `sslmode` into the database URL; the code supplies verified TLS separately.

| Parameter name | Type | Value |
|---|---|---|
| `/cloudops/prod/DATABASE_URL` | SecureString | `postgresql://cloudops_app:URL_ENCODED_PASSWORD@RDS_HOST:5432/cloudops` |
| `/cloudops/prod/APP_ORIGIN` | String | `https://cloudops.your-domain.com` |
| `/cloudops/prod/ADMIN_EMAIL` | String | Your administrator email |
| `/cloudops/prod/ADMIN_PASSWORD` | SecureString | Unique password, 12–128 characters |
| `/cloudops/prod/SQS_QUEUE_URL` | String | Source FIFO queue URL |
| `/cloudops/prod/SNS_TOPIC_ARN` | String | Alert topic ARN |
| `/cloudops/prod/S3_LOG_BUCKET` | String | Private bucket name |
| `/cloudops/processor/DATABASE_URL` | SecureString | Same application database URL |

Optional: `/cloudops/prod/MONITOR_PRIVATE_HOSTS`, a comma-separated list of exact trusted private DNS hostnames. By default, private-network monitoring is blocked. The allowlist permits RFC1918/IPv6 unique-local destinations for those exact names; it still blocks loopback, metadata, and link-local addresses. Restrict outbound networking as well.

The EC2 processes read `/cloudops/prod/`; Lambda reads `/cloudops/processor/`. Parameters are loaded at process startup. Restart containers or redeploy the function after changing them. Existing admin passwords are not silently changed by setting a new bootstrap password; use the password-reset procedure in the README.

## 10. Build and publish your image to ECR

Console → **ECR → Private repositories → Create repository**:

- Name: `cloudops`; enable immutable tags and image scanning.
- Open the repository and select **View push commands**.

On your computer with Docker Desktop running, follow those commands, but choose a release tag such as `v1` rather than `latest`. Build for the EC2 architecture:

```powershell
docker build --platform linux/amd64 -t cloudops:v1 .
```

Use the ECR login, tag, and push commands with your account and region. This publishing step uses your AWS identity; it is not performed by the coding agent. Preserve the image tag for rollback.

## 11. Launch EC2 and run the application

**EC2 → Launch instance**:

- Amazon Linux 2023, x86_64; choose capacity appropriate to your traffic and budget.
- Private application subnet; no public IP.
- Security group: `cloudops-app-sg`.
- IAM instance profile: `cloudops-ec2-role`.
- Encrypted root volume; require IMDSv2. Set the metadata response hop limit to **2** so the Docker containers can use the instance role; keep instance metadata access limited to trusted processes.

Use Session Manager to open a shell. Install Docker and the official Docker Compose plugin. Enable Docker at boot. Transfer `deploy/compose.aws.yaml` to a deployment directory as `compose.yaml` and the CA bundle to `certs/global-bundle.pem`. Use your source repository or an S3 transfer with a separately scoped download permission.

Create a deployment `.env` containing **only non-secret values**:

```dotenv
AWS_REGION=ap-south-1
CLOUDOPS_IMAGE=ACCOUNT.dkr.ecr.ap-south-1.amazonaws.com/cloudops:v1
INSTANCE_LABEL=cloudops-a
```

Then, in the EC2 shell:

```sh
aws ecr get-login-password --region ap-south-1 | sudo docker login --username AWS --password-stdin ACCOUNT.dkr.ecr.ap-south-1.amazonaws.com
sudo docker compose pull
sudo docker compose run --rm api node scripts/migrate.mjs
sudo docker compose up -d
curl --fail http://127.0.0.1:4000/api/ready
sudo docker compose ps
```

The migration command should finish successfully and readiness should return `{"status":"ready"}`. The first API startup creates your admin from Parameter Store. Session cookies are marked Secure in production, so sign in through the HTTPS domain, not through an HTTP EC2 URL.

For application availability, repeat in the other AZ using a unique `INSTANCE_LABEL=cloudops-b`, or bake the configuration into a launch template and Auto Scaling group. Workers use database leases to distribute checks. A single EC2 instance plus an ALB does not make the application highly available. Avoid exposing Docker's remote API.

## 12. Create HTTPS entry point

**ACM → Request certificate** in the same region as the ALB:

- Request a certificate for `cloudops.your-domain.com`.
- Use DNS validation and add the provided records to your DNS provider.

**EC2 → Target groups → Create target group**:

- Target type: Instances; protocol HTTP; port **4000**.
- VPC: custom VPC; health check path: `/api/ready`.
- Register your application instances; wait for Healthy status.

**EC2 → Load balancers → Create Application Load Balancer**:

- Internet-facing, two public subnets in different AZs.
- Security group: `cloudops-alb-sg`.
- HTTPS listener 443 using your ACM certificate, forwarding to the target group.
- HTTP listener 80 redirects to HTTPS.
- Add an alias DNS record, or a CNAME for a subdomain, pointing to the ALB.

The exact domain must match `APP_ORIGIN`, including scheme and port if applicable. Enable ALB access logs and add AWS WAF rules if publishing to the general internet. In-memory API rate limiting is per instance; WAF gives an additional shared edge boundary.

## 13. Deploy the incident Lambda

On your development computer:

```powershell
npm.cmd run package:lambda
Compress-Archive -Path 'build/lambda-bundle/*' -DestinationPath 'build/cloudops-lambda.zip' -Force
```

The package script requires `certs/global-bundle.pem` from step 5. It bundles the runtime code and includes the SQL schema and public CA certificate. The prepared `build/cloudops-lambda.zip` is an upload artifact; regenerate it after changing backend code.

**Lambda → Create function → Author from scratch**:

- Name: `cloudops-incident-processor`.
- Runtime: **Node.js 24.x**; architecture x86_64.
- Existing role: `cloudops-lambda-role`.
- Upload your zip; handler: **`server/lambda.handler`**.
- Timeout: **30 seconds**; memory: initially 512 MB.
- VPC: custom VPC; both private application subnets; `cloudops-lambda-sg`.
- Reserved concurrency: initially 5 to keep RDS connections bounded.

Environment variables:

```dotenv
NODE_ENV=production
SSM_PARAMETER_PATH=/cloudops/processor/
DB_SSL=true
DB_CA_FILE=/var/task/certs/global-bundle.pem
```

Lambda supplies `AWS_REGION` automatically. Do not add it as a custom environment variable; it is reserved by the runtime.

Add an SQS trigger for `cloudops-incidents.fifo`, batch size 5. Enable **`ReportBatchItemFailures`** on the event source mapping. If your Console view does not expose it, open CloudShell and run this after obtaining the mapping UUID from the trigger details:

```sh
aws lambda update-event-source-mapping --uuid YOUR_MAPPING_UUID --function-response-types ReportBatchItemFailures --region ap-south-1
```

The handler returns only failed records and stops processing later records in a failed FIFO group. Other service groups continue. Verify the event mapping is Enabled. [AWS partial-batch guidance](https://docs.aws.amazon.com/prescriptive-guidance/latest/lambda-event-filtering-partial-batch-responses-for-sqs/best-practices-partial-batch-responses.html), [Node.js runtime documentation](https://docs.aws.amazon.com/lambda/latest/dg/lambda-nodejs.html)

## 14. Run acceptance tests before relying on alerts

1. Open the HTTPS site and sign in. Anonymous `/api/workspace` must return 401.
2. Register a real, controlled health endpoint. After its first check, verify real timestamps, response latency, uptime, and logs.
3. Make the endpoint return HTTP 503. After the configured failure count, verify one incident and one alert outbox job.
4. Check SQS receives messages, Lambda invocations succeed, and RDS receives the incident. Confirm an SNS email arrives.
5. Keep the endpoint failing: no duplicate active incident should be created.
6. Acknowledge the incident; restore the endpoint. After two healthy checks, verify automatic resolution and recovery email.
7. Generate a service ingestion token and send valid request/authentication events. Verify failed-login and error-rate rules.
8. Add the relevant EC2 instance ID to a service. Detailed EC2 monitoring gives minute-level CPU samples; basic monitoring is coarser. Verify actual CPU datapoints before expecting the sustained CPU rule to trigger.
9. After the next UTC day starts, verify archived objects appear in S3. Inspect Settings for delivery errors and retry failed jobs after fixing configuration.
10. Restart API and worker processes. Verify data and sessions persist; outage processing resumes.
11. In a test environment, force a processor failure. Verify failed messages retry and eventually reach the DLQ. Fix the cause before redriving.
12. Stop one application instance if you deployed two. Verify ALB routing and worker takeover. Test RDS restore/failover separately.

Do not describe cloud delivery as verified until the actual email, database writes, queue processing, and S3 objects have been observed.

## 15. Monitor this monitoring platform

Create CloudWatch alarms and connect them to the confirmed SNS topic:

- Lambda Errors and Throttles greater than zero.
- DLQ `ApproximateNumberOfMessagesVisible` greater than zero.
- Source queue `ApproximateAgeOfOldestMessage` above your acceptable processing delay.
- ALB unhealthy hosts and HTTP 5xx counts.
- RDS connections, CPU, free storage, and availability.
- EC2 status-check failures and CPU.

Use an external health probe/watchdog for the HTTPS site and worker heartbeat. A failed monitoring platform cannot reliably alert through its own worker. The UI marks a worker heartbeat missing after two minutes; infrastructure alarms are still necessary. Review failed deliveries, certificate expiry, backups, and budgets regularly.

## Troubleshooting

| Symptom | Check |
|---|---|
| Target unhealthy | Port 4000, app SG source, `/api/ready`, container startup and RDS connectivity |
| Login cookie missing | HTTPS domain, Secure cookies, exact `APP_ORIGIN`, ALB forwarding |
| RDS certificate failure | Correct hostname, current CA bundle, readable `DB_CA_FILE`, no URL `sslmode` override |
| Incident never appears | Rule enabled, worker heartbeat, check count, SQS URL, Lambda trigger, event mapping errors |
| All signals pending | Worker stopped, IAM permissions, NAT or VPC endpoints |
| Email absent | Confirmed SNS subscription, correct topic ARN, worker delivery attempts |
| Lambda timeout | NAT/endpoints for SSM, RDS SG, database SSL, reserved concurrency |
| Private API blocked | Exact approved hostname in `MONITOR_PRIVATE_HOSTS`; never allow metadata addresses |
| CPU missing | Correct region/instance ID, CloudWatch permission, detailed monitoring, sample freshness |
| Archive absent | Next UTC day, S3 IAM prefix, bucket name, failed outbox jobs |

## Updating and cleanup

Build a new immutable image tag, push it, change `CLOUDOPS_IMAGE`, pull, migrate, and restart. Take a database snapshot before schema changes. Preserve the previous image tag for rollback; restoring data is a separate operation from rolling back an image.

When finished with a temporary project, take any needed backup and then remove resources deliberately: app instances/ASG, ALB, RDS after reviewing snapshots, NAT gateways, unattached public IPs, queues, Lambda, unused ECR images, log groups, and S3 versions. Retained snapshots and object versions still cost money. Keep billing alerts until cleanup is verified.
