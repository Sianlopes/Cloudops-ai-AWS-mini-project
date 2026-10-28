// Regenerates examples/acme-shop/cloudops.cjs from the code shown in the CloudOps
// "Connect your application" guide, so the demo shop runs exactly what customers copy.
import { writeFileSync } from "node:fs";
import { integrationSnippets } from "../src/lib/snippets.js";
export const SHOP_CLIENT_URL = "http://127.0.0.1:4000";
export const shopClientSource = () =>
  integrationSnippets({ url: SHOP_CLIENT_URL, token: "" }).node.file + "\n";
if (import.meta.url === new URL(process.argv[1], "file:").href || process.argv[1]?.endsWith("sync-shop-client.mjs")) {
  writeFileSync(new URL("../examples/acme-shop/cloudops.cjs", import.meta.url), shopClientSource());
  console.log("examples/acme-shop/cloudops.cjs updated from the integration guide snippet.");
}
