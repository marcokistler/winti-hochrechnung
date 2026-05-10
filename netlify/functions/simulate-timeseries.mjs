// GET /api/simulate-timeseries?steps=8&swing=4&noise=1.5&intervalMin=20
// Erzeugt eine simulierte Auszählungs-Sequenz und schreibt sie in die Zeitreihe.
// Für Testen der Verlaufsgrafik.
//
// Verlauf:
//   step 0: 0 ausgezählt (Auszählung beginnt)
//   step 1: 1 ausgezählt
//   ...
//   step 7: 7 ausgezählt (final)
// Optional: weitere Schritte zwischen Updates beim gleichen Zählstand
// (simuliert mehrere Refresh-Punkte zwischen tatsächlichen Auszählungs-Updates).

import { project } from "../lib/projection.mjs";
import { getBaseline } from "../lib/baseline.mjs";
import { mockCurrent } from "../lib/mock.mjs";
import { writeJson, KEYS } from "../lib/store.mjs";

export async function handler(event) {
  try {
    const qs = event?.queryStringParameters || {};
    const steps = clamp(parseInt(qs.steps, 10) || 8, 1, 30);
    const swing = parseFloat(qs.swing) || 3;
    const noise = parseFloat(qs.noise) || 1.0;
    const intervalMin = parseFloat(qs.intervalMin) || 15;
    const beteiligung = parseFloat(qs.beteiligung) || 1.0;

    const baseline = await getBaseline();

    const points = [];
    const startTs = Date.now() - steps * intervalMin * 60_000;
    for (let i = 0; i < steps; i++) {
      const ts = startTs + i * intervalMin * 60_000;
      // Map step to ausgezaehlt: 8 steps → 0,1,2,3,4,5,6,7
      const ausgezaehlt = Math.min(7, Math.floor((i / Math.max(1, steps - 1)) * 7));
      const current = mockCurrent(baseline, {
        ausgezaehlt,
        swingPp: swing,
        noisePp: noise,
        beteiligungFactor: beteiligung,
      });
      const p = project(baseline, current);
      points.push({
        ts,
        sourceTs: new Date(ts).toISOString().slice(0, 19),
        ausgezaehlteKreise: p.ausgezaehlteKreise ?? 0,
        ausgezaehlteStimmen: p.ausgezaehlteStimmen ?? 0,
        anteilBopp: p.hochrechnung?.anteilBopp ?? null,
        anteilBoppLower: p.hochrechnung?.anteilBoppLower ?? null,
        anteilBoppUpper: p.hochrechnung?.anteilBoppUpper ?? null,
        anteilBoppLower99: p.hochrechnung?.anteilBoppLower99 ?? null,
        anteilBoppUpper99: p.hochrechnung?.anteilBoppUpper99 ?? null,
        pSiegBopp: p.pSiegBopp ?? null,
        aktuellAnteilBopp: p.aktuell?.anteilBopp ?? null,
      });
    }

    await writeJson(KEYS.timeseries, { points, simulated: true, params: { steps, swing, noise, intervalMin, beteiligung } });

    return {
      statusCode: 200,
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        ok: true,
        message: `${points.length} Zeitreihen-Punkte simuliert`,
        params: { steps, swing, noise, intervalMin, beteiligung },
        firstPoint: points[0],
        lastPoint: points[points.length - 1],
      }),
    };
  } catch (err) {
    console.error("[simulate]", err);
    return {
      statusCode: 500,
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({ error: String(err?.message || err) }),
    };
  }
}

function clamp(x, lo, hi) {
  return Math.max(lo, Math.min(hi, x));
}
