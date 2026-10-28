import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";
import { SNSClient, PublishCommand } from "@aws-sdk/client-sns";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import {
  CloudWatchClient,
  GetMetricStatisticsCommand,
} from "@aws-sdk/client-cloudwatch";
import { SSMClient, GetParametersByPathCommand } from "@aws-sdk/client-ssm";
const options = () => ({
  region: process.env.AWS_REGION || "ap-south-1",
  maxAttempts: 2,
});
export async function loadParameters() {
  if (!process.env.SSM_PARAMETER_PATH) return;
  const client = new SSMClient(options());
  let NextToken;
  do {
    const result = await client.send(
      new GetParametersByPathCommand({
        Path: process.env.SSM_PARAMETER_PATH,
        WithDecryption: true,
        Recursive: false,
        NextToken,
      }),
      { abortSignal: AbortSignal.timeout(10000) },
    );
    for (const p of result.Parameters || []) {
      const name = p.Name.split("/").at(-1);
      if (
        /^[A-Z][A-Z0-9_]+$/.test(name) &&
        !["SSM_PARAMETER_PATH", "AWS_REGION", "NODE_ENV"].includes(name)
      )
        process.env[name] = p.Value;
    }
    NextToken = result.NextToken;
  } while (NextToken);
}
export async function sendSignal(signal) {
  const client = new SQSClient(options());
  const fifo = process.env.SQS_QUEUE_URL.endsWith(".fifo");
  return client.send(
    new SendMessageCommand({
      QueueUrl: process.env.SQS_QUEUE_URL,
      MessageBody: JSON.stringify(signal),
      ...(fifo
        ? {
            MessageGroupId: signal.serviceId,
            MessageDeduplicationId: signal.id,
          }
        : {}),
    }),
    { abortSignal: AbortSignal.timeout(10000) },
  );
}
const cap = (text) => text.charAt(0).toUpperCase() + text.slice(1);
// Plain-text email (SNS email subscriptions send text, not HTML).
export function formatAlert(alert, origin = process.env.APP_ORIGIN) {
  const opened = alert.status !== "resolved";
  const subject = `[CloudOps] ${opened ? "Incident opened" : "Resolved"} · ${cap(alert.severity)} · ${alert.title}`.slice(0, 100);
  const when = new Date(alert.at)
    .toISOString()
    .replace("T", " ")
    .replace(/:\d\d\.\d+Z$/, " UTC");
  const link = origin
    ? `${origin.replace(/\/+$/, "")}/${alert.serviceId ? `#/services/${alert.serviceId}` : ""}`
    : null;
  const message = [
    opened ? "A new incident was detected." : "An incident has been resolved.",
    "",
    `Service:   ${alert.service}`,
    `Incident:  ${alert.title}`,
    `Severity:  ${cap(alert.severity)}`,
    `Status:    ${opened ? "Open" : "Resolved"}`,
    `Time:      ${when}`,
    `ID:        ${alert.id}`,
    "",
    opened ? "What CloudOps saw" : "How it recovered",
    `  ${alert.evidence}`,
    ...(link ? ["", opened ? "Investigate:" : "Review:", `  ${link}`] : []),
    "",
    "CloudOps monitoring and incident management",
  ].join("\n");
  return { subject, message };
}
export async function sendAlert(alert) {
  if (!process.env.SNS_TOPIC_ARN)
    throw Error("SNS_TOPIC_ARN is not configured. Alert remains queued.");
  const { subject, message } = formatAlert(alert);
  return new SNSClient(options()).send(
    new PublishCommand({
      TopicArn: process.env.SNS_TOPIC_ARN,
      Subject: subject,
      Message: message,
      // Lets subscriptions filter by severity or status later without parsing the text.
      MessageAttributes: {
        severity: { DataType: "String", StringValue: String(alert.severity) },
        status: { DataType: "String", StringValue: String(alert.status) },
      },
    }),
    { abortSignal: AbortSignal.timeout(10000) },
  );
}
export async function archive(key, records) {
  if (!process.env.S3_LOG_BUCKET)
    throw Error("S3_LOG_BUCKET is not configured.");
  return new S3Client(options()).send(
    new PutObjectCommand({
      Bucket: process.env.S3_LOG_BUCKET,
      Key: key,
      Body: records.map((r) => JSON.stringify(r)).join("\n") + "\n",
      ContentType: "application/x-ndjson",
      ServerSideEncryption: "AES256",
    }),
    { abortSignal: AbortSignal.timeout(10000) },
  );
}
export async function cpuFor(service) {
  if (!service.instance_id) return null;
  const end = new Date(),
    start = new Date(end.getTime() - 5 * 60000);
  const data = await new CloudWatchClient({
    ...options(),
    region: service.region,
    maxAttempts: 2,
  }).send(
    new GetMetricStatisticsCommand({
      Namespace: "AWS/EC2",
      MetricName: "CPUUtilization",
      Dimensions: [{ Name: "InstanceId", Value: service.instance_id }],
      StartTime: start,
      EndTime: end,
      Period: 60,
      Statistics: ["Average"],
    }),
    { abortSignal: AbortSignal.timeout(8000) },
  );
  const latest = (data.Datapoints || []).sort(
    (a, b) => b.Timestamp - a.Timestamp,
  )[0];
  return latest
    ? { value: latest.Average, at: latest.Timestamp.toISOString() }
    : null;
}
export const integrationStatus = () => ({
  queue: process.env.SQS_QUEUE_URL ? "configured" : "local",
  alerts: process.env.SNS_TOPIC_ARN ? "configured" : "not configured",
  archives: process.env.S3_LOG_BUCKET ? "configured" : "not configured",
  cloudwatch: process.env.AWS_REGION ? "configured" : "not configured",
});
