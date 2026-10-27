import { openDatabase } from "../server/db.js";
import { loadParameters } from "../server/integrations.js";
await loadParameters();
const db = await openDatabase();
console.log(`Schema migrations applied (${db.kind}).`);
await db.close();
