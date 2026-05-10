// GET /api/timeseries — gibt die in Blobs persistierte Zeitreihe zurück.

import { readJson, KEYS } from "../lib/store.mjs";

export async function handler() {
  const ts = (await readJson(KEYS.timeseries)) || { points: [] };
  return {
    statusCode: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
    body: JSON.stringify(ts),
  };
}
