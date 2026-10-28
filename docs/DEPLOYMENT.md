# Deploying CloudOps on AWS

One CloudFormation template ([deploy/cloudops.yaml](../deploy/cloudops.yaml)) creates the whole environment. The application itself is uploaded to S3 and installed by the EC2 instance's start-up script, so there is no Docker and no container registry.

## What gets created

| Area | Resources |
|---|---|
| Network | VPC `10.20.0.0/16`, 2 public / 2 application / 2 database subnets, Internet and NAT gateways, S3 gateway endpoint, four security groups |
| Compute | EC2 app server (Node.js 24 as `systemd` services `cloudops-api` and `cloudops-worker`), Lambda incident processor |
| Entry point | Application Load Balancer: port 80 to the app (4000), port 8080 to the demo shop (4100) |
| Data | RDS PostgreSQL 17 (private, encrypted) |
| Messaging | SQS FIFO queue with a dead-letter queue, SNS topic with an email subscription |
| Storage | S3 bucket for log archives |
| Operations | CloudWatch log groups, three alarms and a dashboard, Systems Manager Parameter Store, IAM roles, an AWS Budget |

Approximate running cost is a few US dollars a day (NAT gateway, load balancer, RDS and EC2). Delete the stack when you no longer need it.

## Prerequisites

- An AWS account and the AWS CLI configured with a profile that can create these resources (the examples use `--profile cloudops --region ap-south-1`).
- Node.js 24 and Python 3 on your computer.
- An email address for alerts.

## 1. Create an artifact bucket

The application and the Lambda code are uploaded here. It lives outside the stack.

```sh
BUCKET=cloudops-artifacts-<account-id>
aws s3api create-bucket --bucket $BUCKET --region ap-south-1 \
  --create-bucket-configuration LocationConstraint=ap-south-1
aws s3api put-public-access-block --bucket $BUCKET --public-access-block-configuration \
  BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
```

## 2. Build and upload

```sh
npm ci
npm run build
tar -czf cloudops-app.tgz dist server scripts certs examples package.json package-lock.json
aws s3 cp cloudops-app.tgz s3://$BUCKET/artifacts/cloudops-app.tgz

npm run package:lambda
# zip the CONTENTS of build/lambda-bundle with forward-slash paths, for example:
python -c "import zipfile,os;z=zipfile.ZipFile('cloudops-lambda.zip','w',zipfile.ZIP_DEFLATED);[z.write(os.path.join(d,f),os.path.relpath(os.path.join(d,f),'build/lambda-bundle').replace(os.sep,'/')) for d,_,fs in os.walk('build/lambda-bundle') for f in fs]"
aws s3 cp cloudops-lambda.zip s3://$BUCKET/artifacts/cloudops-lambda.zip
```

## 3. Create the stack

Choose a database password (letters and digits only, 12 or more characters).

```sh
aws cloudformation create-stack --stack-name cloudops \
  --template-body file://deploy/cloudops.yaml --capabilities CAPABILITY_NAMED_IAM \
  --parameters ParameterKey=AlertEmail,ParameterValue=you@example.com \
               ParameterKey=AdminEmail,ParameterValue=you@example.com \
               ParameterKey=DbPassword,ParameterValue=<DB_PASSWORD> \
               ParameterKey=ArtifactBucket,ParameterValue=$BUCKET
aws cloudformation wait stack-create-complete --stack-name cloudops
aws cloudformation describe-stacks --stack-name cloudops --query 'Stacks[0].Outputs'
```

Outputs include `AppUrl`, `ShopUrl`, `DbHost` and `InstanceId`. **Confirm the SNS subscription** from the email AWS sends, or no alert is delivered. Budget notices arrive by email too.

## 4. Store the secrets

CloudFormation cannot create `SecureString` parameters, so add them yourself. The database URL is needed under both paths (the app and the Lambda).

```sh
DBHOST=<DbHost output>
URL="postgresql://cloudops_admin:<DB_PASSWORD>@$DBHOST:5432/cloudops"
aws ssm put-parameter --name /cloudops/prod/DATABASE_URL      --type SecureString --value "$URL"
aws ssm put-parameter --name /cloudops/processor/DATABASE_URL --type SecureString --value "$URL"
aws ssm put-parameter --name /cloudops/prod/ADMIN_PASSWORD    --type SecureString --value "<ADMIN_PASSWORD>"
```

Restart the app so it picks them up (the first start may have run before they existed):

```sh
aws ssm send-command --instance-ids <InstanceId> --document-name AWS-RunShellScript \
  --parameters 'commands=["systemctl restart cloudops-api cloudops-worker"]'
```

Open `AppUrl` and sign in with the administrator email and `ADMIN_PASSWORD`. The administrator is created from these values the first time the server starts with an empty database.

## 5. Updating the application

Upload a new build and reinstall it on the server:

```sh
aws s3 cp cloudops-app.tgz s3://$BUCKET/artifacts/cloudops-app.tgz
aws ssm send-command --instance-ids <InstanceId> --document-name AWS-RunShellScript --parameters 'commands=[
  "aws s3 cp s3://<bucket>/artifacts/cloudops-app.tgz /tmp/app.tgz --region ap-south-1",
  "cd /opt/cloudops && rm -rf dist server scripts examples",
  "tar -xzf /tmp/app.tgz -C /opt/cloudops && rm /tmp/app.tgz",
  "cd /opt/cloudops && npm ci --omit=dev && chown -R cloudops /opt/cloudops",
  "systemctl restart cloudops-api cloudops-worker"]'
```

**The rules and incident logic run in Lambda.** If anything under `server/` changes, update the function too:

```sh
aws s3 cp cloudops-lambda.zip s3://$BUCKET/artifacts/cloudops-lambda.zip
aws lambda update-function-code --function-name cloudops-incident-processor \
  --s3-bucket $BUCKET --s3-key artifacts/cloudops-lambda.zip
```

Database migrations run automatically when the server (or Lambda) starts and are safe to repeat. Take an RDS snapshot first when a release changes the schema.

## 6. The demo shop (optional)

`examples/acme-shop` is a small online store that CloudOps can monitor, with a break/fix control page for presentations. Install it as a service on the app server using [deploy/cloudops-shop.service](../deploy/cloudops-shop.service) (set `CLOUDOPS_URL` to the load balancer address):

```sh
sudo cp cloudops-shop.service /etc/systemd/system/ && sudo systemctl daemon-reload
sudo systemctl enable --now cloudops-shop
```

- Store: `http://<load balancer>:8080/`
- Presenter controls: `http://<load balancer>:8080/control`
- Add `http://<load balancer>:8080/health` as a service in CloudOps, click **Connect your app** to create its token, and paste the token on the control page.

The control page has no password. It is for demonstrations only.

## 7. HTTP and a domain

Without a domain the load balancer serves HTTP, and the server runs with `ALLOW_INSECURE_HTTP=true` so session cookies work over HTTP. For production, request an ACM certificate for your domain, add an HTTPS listener (443) to the load balancer, set `APP_ORIGIN` to the HTTPS address, and remove `ALLOW_INSECURE_HTTP` from the service environment.

## 8. Tearing everything down

1. Empty the log bucket (its name is the `LogBucketName` output).
2. `aws cloudformation delete-stack --stack-name cloudops`
3. Delete the artifact bucket, the three `SecureString` parameters, and any RDS snapshots you took.
4. Delete any IAM access keys you created for deploying.

## Troubleshooting

| Symptom | Check |
|---|---|
| Target group unhealthy | `systemctl status cloudops-api`, the `/var/log/cloudops-bootstrap.log` start-up log, and that the Parameter Store values exist |
| Cannot sign in over HTTP | `ALLOW_INSECURE_HTTP=true` is set and `APP_ORIGIN` matches the address you opened |
| No alert emails | the SNS subscription is confirmed (not "Pending"), and Settings shows no failed deliveries |
| Incidents never appear | the worker heartbeat in the sidebar, the SQS queue and its dead-letter queue, and the Lambda logs |
| Lambda times out | it needs the NAT gateway (to reach Parameter Store) and the database security group rule |
