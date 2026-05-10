// GET /api/results — Hauptendpoint fürs Dashboard.
// Cache 20s in Netlify Blobs, refetcht den Kanton-ZH-Datensatz und rechnet hoch.

import { resolveResourceUrl, fetchDayResults, parseStadtpraesidium } from "../lib/source.mjs";
import { project } from "../lib/projection.mjs";
import { getBaseline } from "../lib/baseline.mjs";
import { readJson, writeJson, KEYS } from "../lib/store.mjs";

const WG2_DATE = "2026-05-10";
const CACHE_TTL_MS = 20_000;
const TIMESERIES_MIN_GAP_MS = 60_000; // mind. 1 min zwischen Zeitreihen-Punkten

export async function handler(event) {
  try {
    const force = event?.queryStringParameters?.force === "1";
    const cached = await readJson(KEYS.latest);
    if (
      !force &&
      cached &&
      cached.fetchedAt &&
      Date.now() - cached.fetchedAt < CACHE_TTL_MS
    ) {
      return ok({ ...cached, cache: "hit" });
    }

    const baseline = await getBaseline();
    const url = await resolveResourceUrl(WG2_DATE);
    const dayJson = await fetchDayResults(url);
    const current = parseStadtpraesidium(dayJson);
    if (!current) {
      return error("Stadtpräsidiumsvorlage 2.WG nicht gefunden", 502);
    }

    const projection = project(baseline, current);

    const payload = {
      fetchedAt: Date.now(),
      sourceUrl: url,
      sourceTimestamp: current.timestamp,
      abstimmtag: current.abstimmtag,
      titel: current.titel,
      candidates: current.candidates,
      baseline: {
        abstimmtag: baseline.abstimmtag,
        total: baseline.total,
        anteilBopp:
          baseline.total &&
          baseline.total.stimmenBopp /
            (baseline.total.stimmenBopp + baseline.total.stimmenFritschi),
      },
      projection,
      cache: "miss",
    };

    await writeJson(KEYS.latest, payload);

    // Zeitreihe nur dann aktualisieren, wenn neue Auszählungs-Info da ist
    // ODER mind. 1 min seit letztem Punkt vergangen ist.
    await maybeAppendTimeseries(projection);

    return ok(payload);
  } catch (err) {
    console.error("[results]", err);
    return error(String(err?.message || err), 500);
  }
}

async function maybeAppendTimeseries(projection) {
  const ts = (await readJson(KEYS.timeseries)) || { points: [] };
  const last = ts.points[ts.points.length - 1];
  const now = Date.now();
  const newPoint = {
    ts: now,
    sourceTs: projection.timestamp,
    ausgezaehlteKreise: projection.ausgezaehlteKreise ?? 0,
    ausgezaehlteStimmen: projection.ausgezaehlteStimmen ?? 0,
    anteilBopp: projection.hochrechnung?.anteilBopp ?? null,
    anteilBoppLower: projection.hochrechnung?.anteilBoppLower ?? null,
    anteilBoppUpper: projection.hochrechnung?.anteilBoppUpper ?? null,
    pSiegBopp: projection.pSiegBopp ?? null,
    aktuellAnteilBopp: projection.aktuell?.anteilBopp ?? null,
  };
  if (last) {
    const sameSource = last.sourceTs === newPoint.sourceTs;
    const tooSoon = now - last.ts < TIMESERIES_MIN_GAP_MS;
    if (sameSource && tooSoon) return;
  }
  ts.points.push(newPoint);
  // Begrenzen, damit Blob nicht explodiert (1 Punkt/Min für 12h = 720)
  if (ts.points.length > 1000) ts.points = ts.points.slice(-1000);
  await writeJson(KEYS.timeseries, ts);
}

function ok(body) {
  return {
    statusCode: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store, max-age=0",
    },
    body: JSON.stringify(body),
  };
}
function error(msg, status = 500) {
  return {
    statusCode: status,
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify({ error: msg }),
  };
}
