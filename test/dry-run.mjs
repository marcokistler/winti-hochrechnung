// Dry-run gegen die echten 1.- und 2.-WG-JSONs.
// Nutzt die lokal gespeicherten Dateien wg1.json und wg2.json (im Repo-Root).
// Verifiziert: parseStadtpraesidium parst korrekt, project() läuft sauber durch.

import fs from "node:fs";
import { parseStadtpraesidium } from "../netlify/lib/source.mjs";
import { project } from "../netlify/lib/projection.mjs";

const wg1 = JSON.parse(fs.readFileSync("wg1.json", "utf8"));
const wg2 = JSON.parse(fs.readFileSync("wg2.json", "utf8"));

const baseline = parseStadtpraesidium(wg1);
const current = parseStadtpraesidium(wg2);

console.log("=== Baseline (1. WG, 08.03.2026) ===");
console.log("Titel:", baseline.titel);
console.log("Bopp gesamt:", baseline.total.stimmenBopp);
console.log("Fritschi gesamt:", baseline.total.stimmenFritschi);
console.log("Anteil Bopp:", (baseline.total.anteilBopp * 100).toFixed(2) + "%");
console.log("Beteiligung:", baseline.total.beteiligung?.toFixed(2) + "%");
console.log("Stadtkreise (n):", baseline.stadtkreise.length);
for (const k of baseline.stadtkreise) {
  console.log(
    `  ${k.name.padEnd(15)} Bopp=${k.stimmenBopp} Fritschi=${k.stimmenFritschi} ` +
      `(Bopp ${(k.anteilBopp * 100).toFixed(1)}%)  WB=${k.wahlberechtigte}  Bet=${k.beteiligung?.toFixed(1)}%`,
  );
}

console.log("\n=== Aktuell (2. WG, 10.05.2026) ===");
console.log("Titel:", current.titel);
console.log("Timestamp:", current.timestamp);
console.log("gebietAusgezaehlt:", current.gebietAusgezaehlt);
console.log("Stadtkreise (n):", current.stadtkreise.length);
console.log(
  "Ausgezaehlt:",
  current.stadtkreise.filter((k) => k.ausgezaehlt).length,
  "/",
  current.stadtkreise.length,
);

console.log("\n=== Projection (echte Daten, 2. WG noch leer) ===");
const p = project(baseline, current);
console.log("status:", p.status, "| message:", p.message);
console.log("aktuell:", p.aktuell);
if (p.hochrechnung) {
  console.log(
    "Hochrechnung Bopp:",
    (p.hochrechnung.anteilBopp * 100).toFixed(2) + "%",
    `[${(p.hochrechnung.anteilBoppLower * 100).toFixed(2)}-${(p.hochrechnung.anteilBoppUpper * 100).toFixed(2)}]`,
  );
  console.log("p(Sieg Bopp):", p.pSiegBopp?.toFixed(3));
}

console.log("\n=== Self-Test: Baseline gegen sich selbst projizieren ===");
// Wenn wir die 1.-WG-Daten als Baseline UND als 'current' nutzen,
// muss die Hochrechnung dem 1.-WG-Resultat exakt entsprechen.
const self = project(baseline, baseline);
console.log("status:", self.status);
console.log(
  "self anteilBopp:",
  (self.hochrechnung.anteilBopp * 100).toFixed(4) + "%",
);
console.log(
  "baseline anteilBopp:",
  (baseline.total.anteilBopp * 100).toFixed(4) + "%",
);
const diff = Math.abs(self.hochrechnung.anteilBopp - baseline.total.anteilBopp);
console.log("Differenz:", diff.toExponential(3));
if (diff > 1e-9) {
  console.error("✘ Self-Test FEHLGESCHLAGEN — Hochrechnung weicht vom Endresultat ab.");
  process.exit(1);
}
console.log("✓ Self-Test ok");

console.log("\n=== Simulation: 3 Stadtkreise ausgezählt mit +5pp Swing ===");
const sim = JSON.parse(JSON.stringify(baseline));
sim.timestamp = "2026-05-10T15:30:00";
sim.abstimmtag = "2026-05-10";
sim.stadtkreise = sim.stadtkreise.map((k, i) => {
  if (i < 3) {
    const denom = k.stimmenBopp + k.stimmenFritschi;
    const pNew = Math.min(1, k.anteilBopp + 0.05);
    const newBopp = Math.round(denom * pNew);
    return {
      ...k,
      ausgezaehlt: true,
      stimmenBopp: newBopp,
      stimmenFritschi: denom - newBopp,
      anteilBopp: pNew,
    };
  }
  return {
    ...k,
    ausgezaehlt: false,
    stimmenBopp: null,
    stimmenFritschi: null,
    anteilBopp: null,
    eingelegte: null,
    gueltig: null,
    beteiligung: null,
  };
});
const ps = project(baseline, sim);
console.log("status:", ps.status);
console.log(
  "Hochrechnung Bopp:",
  (ps.hochrechnung.anteilBopp * 100).toFixed(2) + "%",
  `[${(ps.hochrechnung.anteilBoppLower * 100).toFixed(2)}-${(ps.hochrechnung.anteilBoppUpper * 100).toFixed(2)}]`,
);
console.log("Erwartung: ≈ 51.1% (1.WG-Anteil 51.06% + 5pp Swing approximiert)");
console.log("p(Sieg Bopp):", ps.pSiegBopp.toFixed(3));
console.log("swingAvg:", ps.swingAvg?.toFixed(4), "swingSd:", ps.swingSd?.toFixed(4));
