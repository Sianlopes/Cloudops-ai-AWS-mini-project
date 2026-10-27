import { openDatabase } from "./db.js";
import { processSignal } from "./domain.js";
import { loadParameters } from "./integrations.js";
let db;
export function createHandler(database, processor = processSignal) {
  return async (event) => {
    const failures = [];
    const blockedGroups = new Set();
    for (const record of event.Records || []) {
      const group = record.attributes?.MessageGroupId;
      if (group && blockedGroups.has(group)) {
        failures.push({ itemIdentifier: record.messageId });
        continue;
      }
      try {
        await processor(database, JSON.parse(record.body));
      } catch {
        failures.push({ itemIdentifier: record.messageId });
        if (group) blockedGroups.add(group);
      }
    }
    return { batchItemFailures: failures };
  };
}
export async function handler(event) {
  if (!db) {
    await loadParameters();
    db = await openDatabase();
  }
  return createHandler(db)(event);
}
