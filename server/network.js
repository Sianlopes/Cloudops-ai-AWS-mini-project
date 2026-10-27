import dns from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import ipaddr from "ipaddr.js";
export function publicAddress(address) {
  try {
    let ip = ipaddr.parse(address);
    if (ip.kind() === "ipv6" && ip.isIPv4MappedAddress())
      ip = ip.toIPv4Address();
    return ip.range() === "unicast";
  } catch {
    return false;
  }
}
export function validateEndpoint(endpoint) {
  let url;
  try {
    url = new URL(endpoint);
  } catch {
    throw Object.assign(Error("Enter a valid HTTP or HTTPS endpoint."), {
      status: 400,
    });
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.hash ||
    endpoint.length > 2048
  )
    throw Object.assign(
      Error("Use an HTTP(S) URL without credentials or a fragment."),
      { status: 400 },
    );
  return url;
}
export async function checkedAddress(
  url,
  {
    lookup = dns.lookup,
    allowLocalTest = process.env.ALLOW_LOCAL_TEST_TARGET === "true" &&
      process.env.NODE_ENV !== "production",
    privateHosts = (process.env.MONITOR_PRIVATE_HOSTS || "")
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean),
  } = {},
) {
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const localAllowed =
    allowLocalTest && hostname === "127.0.0.1" && url.port === "4100";
  const addresses = ipaddr.isValid(hostname)
    ? [
        {
          address: hostname,
          family: ipaddr.parse(hostname).kind() === "ipv4" ? 4 : 6,
        },
      ]
    : await lookup(hostname, { all: true, verbatim: true });
  const privateAllowed =
    privateHosts.includes(hostname) &&
    addresses.every((a) => {
      try {
        return ["private", "uniqueLocal"].includes(
          ipaddr.process(a.address).range(),
        );
      } catch {
        return false;
      }
    });
  if (
    !addresses.length ||
    (!localAllowed &&
      !privateAllowed &&
      addresses.some((a) => !publicAddress(a.address)))
  )
    throw Error(
      "Target resolves to a private, reserved, or metadata address. Monitoring is blocked.",
    );
  return addresses[0];
}
export async function probe(
  endpoint,
  { timeoutMs = 5000, expectedStatus = 200, lookup, allowLocalTest } = {},
) {
  const started = performance.now();
  let address, dnsTimer;
  try {
    const url = validateEndpoint(endpoint);
    const timeout = new Promise((_, reject) => {
      dnsTimer = setTimeout(
        () => reject(Error("DNS resolution timed out")),
        Math.min(timeoutMs, 5000),
      );
      dnsTimer.unref();
    });
    address = await Promise.race([
      checkedAddress(url, { lookup, allowLocalTest }),
      timeout,
    ]);
    clearTimeout(dnsTimer);
    return await new Promise((resolve) => {
      let finished = false,
        request;
      const finish = (success, statusCode, error) => {
        if (finished) return;
        finished = true;
        clearTimeout(deadline);
        request?.destroy();
        resolve({
          success,
          statusCode,
          latency: Math.round(performance.now() - started),
          error: error || null,
        });
      };
      const deadline = setTimeout(
        () => finish(false, null, "Health check timed out"),
        Math.max(1, timeoutMs - (performance.now() - started)),
      );
      request = (url.protocol === "https:" ? https : http).request(
        url,
        {
          method: "GET",
          agent: false,
          headers: {
            "User-Agent": "CloudOps-AI/1.0",
            Accept: "application/json",
          },
          lookup: (hostname, opts, cb) =>
            opts.all
              ? cb(null, [address])
              : cb(null, address.address, address.family),
        },
        (response) => {
          finish(
            response.statusCode === expectedStatus,
            response.statusCode,
            response.statusCode === expectedStatus
              ? null
              : `Expected HTTP ${expectedStatus}; received HTTP ${response.statusCode}`,
          );
        },
      );
      request.on("error", () =>
        finish(false, null, "Connection or TLS verification failed"),
      );
      request.end();
    });
  } catch (error) {
    clearTimeout(dnsTimer);
    return {
      success: false,
      statusCode: null,
      latency: Math.round(performance.now() - started),
      error: error.message,
    };
  }
}
