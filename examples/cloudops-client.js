import { randomUUID } from "node:crypto";
// Use on your application server, never in a browser. Non-blocking bounded telemetry.
export function createCloudOpsClient({
  url,
  token,
  onError = () => {},
  maxQueue = 1000,
}) {
  let queue = [],
    sending = false,
    stopped = false;
  const emit = (event) => {
    if (queue.length >= maxQueue) {
      onError(Error("CloudOps telemetry buffer is full"));
      return false;
    }
    queue.push({ ...event, id: event.id || randomUUID(), attempts: 0 });
    return true;
  };
  const flush = async () => {
    if (sending || !queue.length || stopped) return;
    sending = true;
    try {
      const event = queue[0];
      const { attempts, ...body } = event;
      const response = await fetch(`${url}/api/events`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) throw Error(`Telemetry rejected (${response.status})`);
      queue.shift();
    } catch (error) {
      if (queue[0] && ++queue[0].attempts >= 5) queue.shift();
      onError(error);
    } finally {
      sending = false;
    }
  };
  const timer = setInterval(flush, 1000);
  timer.unref();
  const middleware = (req, res, next) => {
    const start = performance.now();
    res.once("finish", () =>
      emit({
        type: "request",
        statusCode: res.statusCode,
        duration: Math.round(performance.now() - start),
        message: `${req.method} ${req.route?.path || "unmatched route"}`,
        level: res.statusCode >= 500 ? "error" : "info",
      }),
    );
    next();
  };
  return {
    emit,
    middleware,
    async close() {
      clearInterval(timer);
      for (let n = 0; n < 5 && queue.length; n++) await flush();
      stopped = true;
    },
  };
}
