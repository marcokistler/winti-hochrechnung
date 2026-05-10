// Lädt die 1.-WG-Baseline (Resultate pro Stadtkreis) und cached sie in Blobs.

import { resolveResourceUrl, fetchDayResults, parseStadtpraesidium } from "./source.mjs";
import { readJson, writeJson, KEYS } from "./store.mjs";

const WG1_DATE = "2026-03-08";

export async function getBaseline({ forceRefresh = false } = {}) {
  if (!forceRefresh) {
    const cached = await readJson(KEYS.baseline);
    if (cached && cached.stadtkreise?.length === 7) return cached;
  }
  const url = await resolveResourceUrl(WG1_DATE);
  const dayJson = await fetchDayResults(url);
  const parsed = parseStadtpraesidium(dayJson);
  if (!parsed) throw new Error("Stadtpräsidium 1.WG nicht in Daten gefunden.");
  if (parsed.stadtkreise.length !== 7) {
    console.warn("[baseline] erwartete 7 Stadtkreise, gefunden:", parsed.stadtkreise.length);
  }
  await writeJson(KEYS.baseline, parsed);
  return parsed;
}
