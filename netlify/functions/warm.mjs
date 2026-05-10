// Scheduled Function — warmt jede Minute den Results-Cache.
// Damit auch ohne Frontend-Last die Zeitreihe regelmässig wächst.

import { handler as resultsHandler } from "./results.mjs";

export const config = {
  schedule: "* * * * *",
};

export async function handler() {
  try {
    await resultsHandler({ queryStringParameters: { force: "1" } });
  } catch (err) {
    console.error("[warm] failed:", err);
  }
  return { statusCode: 200, body: "ok" };
}
