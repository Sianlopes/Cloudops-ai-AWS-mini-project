import express from "express";
import { randomUUID } from "node:crypto";
const app = express();
app.use(express.json());
let scenario = "healthy";
app.get("/health", async (req, res) => {
  if (scenario === "slow") await new Promise((r) => setTimeout(r, 1500));
  res.status(scenario === "outage" ? 503 : 200).json({ status: scenario });
});
app.post("/scenario", (req, res) => {
  if (!["healthy", "slow", "outage"].includes(req.body.scenario))
    return res.status(400).json({ error: "Use healthy, slow, or outage." });
  scenario = req.body.scenario;
  res.json({ scenario });
});
app.post("/emit", async (req, res) => {
  if (!process.env.CLOUDOPS_INGESTION_TOKEN)
    return res
      .status(400)
      .json({ error: "Configure CLOUDOPS_INGESTION_TOKEN first." });
  const result = await fetch(
    `${process.env.CLOUDOPS_URL || "http://127.0.0.1:4000"}/api/events`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.CLOUDOPS_INGESTION_TOKEN}`,
      },
      body: JSON.stringify({
        id: randomUUID(),
        type: "request",
        statusCode: scenario === "outage" ? 503 : 200,
        duration: scenario === "slow" ? 1500 : 25,
        level: "info",
        message: "Example application request",
        ...req.body,
      }),
      signal: AbortSignal.timeout(5000),
    },
  );
  res.status(result.status).json(await result.json());
});
app.listen(4100, "127.0.0.1", () =>
  console.log(
    'Test application: http://127.0.0.1:4100/health. POST /scenario with {"scenario":"outage"} to create real HTTP failures.',
  ),
);
