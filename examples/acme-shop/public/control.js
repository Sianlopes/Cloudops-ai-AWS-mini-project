const $ = (id) => document.getElementById(id);
const options = [
  {
    id: "healthy",
    color: "#16a34a",
    title: "Healthy",
    text: "Everything works.",
    detect: "CloudOps: all checks green; open incidents close automatically.",
  },
  {
    id: "slow",
    color: "#d97706",
    title: "Slow",
    text: "Every response takes 1.5 seconds.",
    detect: "CloudOps: Response latency incident after 3 slow health checks.",
  },
  {
    id: "payments",
    color: "#d97706",
    title: "Payments failing",
    text: "Checkout fails, but the site and /health still answer 200.",
    detect: "CloudOps: health checks stay green. Run customer traffic and the API error rate incident opens (needs connection).",
  },
  {
    id: "outage",
    color: "#dc2626",
    title: "Shop down",
    text: "Every API call and /health return 503.",
    detect: "CloudOps: Service availability incident after 3 failed checks, plus an alert email.",
  },
];
let current = null;

function say(el, body, ok) {
  el.textContent = body.message || body.error || body.started || "";
  el.style.color = ok ? "var(--success)" : "var(--danger)";
}
function renderOptions() {
  $("options").innerHTML = options
    .map(
      (o) => `<button class="option${o.id === current ? " active" : ""}" data-s="${o.id}">
        <b><span class="dot" style="background:${o.color}"></span>${o.title}</b>
        <span>${o.text}</span><span class="detect">${o.detect}</span></button>`,
    )
    .join("");
  $("options").querySelectorAll("[data-s]").forEach(
    (b) =>
      (b.onclick = async () => {
        await fetch("scenario", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ scenario: b.dataset.s }),
        });
        refresh();
      }),
  );
}
async function refresh() {
  const s = await (await fetch("scenario")).json();
  if (s.scenario !== current) {
    current = s.scenario;
    renderOptions();
  }
  const t = s.telemetry;
  $("cdot").style.background = t ? "var(--success)" : "#a3a3a3";
  $("clabel").textContent = t ? "Connected — the shop reports to CloudOps" : "Not connected";
  $("cinfo").textContent = t
    ? `Token ${t.tokenHint} · ${t.url} · since ${new Date(t.connectedAt).toLocaleTimeString()}`
    : "The shop is not sending any data to CloudOps.";
  renderSims(s.simulations);
}
const simDefs = [
  {
    id: "traffic",
    title: "Customer traffic",
    text: "Customers browse products, open product pages and place orders, about three requests a second.",
  },
  {
    id: "attack",
    title: "Password-guessing attack",
    text: "Someone keeps guessing passwords for the account \"admin\".",
  },
];
const clock = (ms) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}`;
function renderSims(state = {}) {
  $("sims").innerHTML = simDefs
    .map((d) => {
      const s = state[d.id] || {};
      const stats = s.running
        ? `${s.stopping ? "Stopping" : "Running"} · ${clock(s.elapsedMs)} · ${s.sent} requests${s.failed ? ` · ${s.failed} failed` : ""}`
        : s.sent
          ? `Stopped · last run sent ${s.sent} requests${s.failed ? ` (${s.failed} failed)` : ""}`
          : "Stopped";
      return `<div class="sim${s.running ? " running" : ""}">
        <div class="grow"><b><span class="dot" style="background:${s.running ? "var(--success)" : "#a3a3a3"}"></span>${d.title}</b>
        <span>${d.text}</span><span class="stats">${stats}</span></div>
        <button class="btn ${s.running ? "stop" : "primary"}" data-sim="${d.id}" data-action="${s.running ? "stop" : "start"}" ${s.stopping ? "disabled" : ""}>${s.running ? (s.stopping ? "Stopping…" : "Stop") : "Start"}</button>
      </div>`;
    })
    .join("");
}
$("connectForm").onsubmit = async (e) => {
  e.preventDefault();
  $("cmsg").textContent = "Checking the token with CloudOps…";
  $("cmsg").style.color = "var(--muted)";
  const r = await fetch("api/connect", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(Object.fromEntries(new FormData(e.target))),
  });
  say($("cmsg"), await r.json(), r.ok);
  if (r.ok) e.target.token.value = "";
  refresh();
};
$("disconnect").onclick = async () => {
  const r = await fetch("api/connect", { method: "DELETE" });
  say($("cmsg"), await r.json(), r.ok);
  refresh();
};
async function simCall(path) {
  const r = await fetch(path, { method: "POST" });
  say($("smsg"), await r.json(), r.ok);
  refresh();
}
$("sims").onclick = (e) => {
  const b = e.target.closest("[data-sim]");
  if (b && !b.disabled) simCall(`api/simulate/${b.dataset.sim}/${b.dataset.action}`);
};
$("stopAll").onclick = () => simCall("api/simulate/stop-all");
fetch("api/control/defaults")
  .then((r) => r.json())
  .then((d) => ($("url").value = d.url));
refresh();
setInterval(refresh, 1000);
