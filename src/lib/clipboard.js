// Copy text to the clipboard. The modern API only exists on secure pages (HTTPS or
// localhost), so fall back to a hidden textarea on plain-HTTP deployments.
export async function copyText(text) {
  if (window.isSecureContext && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  // Keep the textarea inside an open dialog so its focus trap doesn't steal the selection.
  const host = document.querySelector("[role=dialog]") || document.body;
  const el = document.createElement("textarea");
  el.value = text;
  el.setAttribute("readonly", "");
  el.style.cssText = "position:fixed;top:0;left:0;opacity:0;pointer-events:none";
  host.appendChild(el);
  el.focus();
  el.select();
  const ok = document.execCommand("copy");
  el.remove();
  if (!ok) throw Error("Copying is not supported in this browser.");
}

// A unique id for an event. crypto.randomUUID() is also secure-context only.
export function eventId(prefix = "evt") {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return `${prefix}-${[...bytes].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}
