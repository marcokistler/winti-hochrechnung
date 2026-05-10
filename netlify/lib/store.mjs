// Netlify Blobs Wrapper.
// Lokal (netlify dev) wird ein In-Memory-Fallback genutzt, falls Blobs nicht verfügbar sind.

import { getStore } from "@netlify/blobs";

const STORE_NAME = "winti-hochrechnung";

let memoryStore = null;
function getMemoryStore() {
  if (!memoryStore) memoryStore = new Map();
  return memoryStore;
}

function tryGetStore() {
  try {
    return getStore({ name: STORE_NAME, consistency: "strong" });
  } catch (err) {
    console.warn("[store] Netlify Blobs nicht verfügbar, fallback in-memory:", err.message);
    return null;
  }
}

export async function readJson(key) {
  const store = tryGetStore();
  if (store) {
    try {
      const v = await store.get(key, { type: "json" });
      return v ?? null;
    } catch (err) {
      console.warn(`[store] read ${key} fehlgeschlagen:`, err.message);
      return null;
    }
  }
  const m = getMemoryStore();
  return m.get(key) ?? null;
}

export async function writeJson(key, value) {
  const store = tryGetStore();
  if (store) {
    try {
      await store.setJSON(key, value);
      return;
    } catch (err) {
      console.warn(`[store] write ${key} fehlgeschlagen:`, err.message);
      return;
    }
  }
  const m = getMemoryStore();
  m.set(key, value);
}

export const KEYS = {
  baseline: "baseline-2026-03-08.json",
  resourceUrls: "resource-urls.json",
  latest: "latest-results.json",
  timeseries: "timeseries.json",
};
