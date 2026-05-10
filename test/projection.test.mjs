import { test } from "node:test";
import assert from "node:assert/strict";
import { project, _internal } from "../netlify/lib/projection.mjs";

// Synthetische 7 Stadtkreise — alle gleich gross für einfache Mathematik.
function makeBaseline(boppShares) {
  return {
    abstimmtag: "2026-03-08",
    timestamp: "2026-03-08T18:00:00",
    candidates: { bopp: { nachname: "Bopp" }, fritschi: { nachname: "Fritschi" } },
    total: { beteiligung: 50 },
    stadtkreise: boppShares.map((p, i) => {
      const total = 10000;
      const bopp = Math.round(total * p);
      return {
        name: `K${i + 1}`,
        ausgezaehlt: true,
        wahlberechtigte: 20000,
        eingelegte: 10500,
        gueltig: 10000,
        beteiligung: 50,
        stimmenBopp: bopp,
        stimmenFritschi: total - bopp,
        anteilBopp: p,
      };
    }),
  };
}

function makeCurrent(boppSharesPlusSwing, ausgezaehltMask) {
  return {
    abstimmtag: "2026-05-10",
    timestamp: "2026-05-10T14:00:00",
    candidates: { bopp: { nachname: "Bopp" }, fritschi: { nachname: "Fritschi" } },
    stadtkreise: boppSharesPlusSwing.map((p, i) => {
      const ausg = ausgezaehltMask[i];
      const total = 10000;
      const bopp = Math.round(total * p);
      return {
        name: `K${i + 1}`,
        ausgezaehlt: ausg,
        wahlberechtigte: 20000,
        eingelegte: ausg ? 10500 : null,
        gueltig: ausg ? 10000 : null,
        beteiligung: ausg ? 50 : null,
        stimmenBopp: ausg ? bopp : null,
        stimmenFritschi: ausg ? total - bopp : null,
        anteilBopp: ausg ? p : null,
      };
    }),
  };
}

test("0 ausgezählte Kreise -> status warten, kein crash", () => {
  const baseline = makeBaseline([0.45, 0.5, 0.55, 0.5, 0.5, 0.5, 0.5]);
  const current = makeCurrent(
    [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5],
    [false, false, false, false, false, false, false],
  );
  const p = project(baseline, current);
  assert.equal(p.status, "warten");
  assert.equal(p.hochrechnung, null);
  assert.equal(p.ausgezaehlteKreise, 0);
  assert.equal(p.offeneKreise, 7);
});

test("alle ausgezählt -> status final, anteilBopp = exakt", () => {
  const baseline = makeBaseline([0.45, 0.5, 0.55, 0.5, 0.5, 0.5, 0.5]);
  // 2.WG: Bopp +5pp überall
  const shares = [0.5, 0.55, 0.6, 0.55, 0.55, 0.55, 0.55];
  const current = makeCurrent(shares, [true, true, true, true, true, true, true]);
  const p = project(baseline, current);
  assert.equal(p.status, "final");
  assert.ok(p.hochrechnung.anteilBopp > 0.54 && p.hochrechnung.anteilBopp < 0.56);
  assert.equal(p.hochrechnung.anteilBoppLower, p.hochrechnung.anteilBoppUpper);
  assert.equal(p.pSiegBopp, 1);
});

test("3 ausgezählt mit konsistentem Swing -> Hochrechnung in Plausibilitätsband", () => {
  const baseline = makeBaseline([0.45, 0.5, 0.55, 0.5, 0.5, 0.5, 0.5]);
  // 2.WG: Bopp +5pp in den 3 ausgezählten
  const shares = [0.5, 0.55, 0.6, 0.5, 0.5, 0.5, 0.5];
  const current = makeCurrent(shares, [true, true, true, false, false, false, false]);
  const p = project(baseline, current);
  assert.equal(p.status, "hochgerechnet");
  // Erwartung: Schätzung Bopp-Anteil ≈ 0.55 (alle Kreise +5pp Swing)
  assert.ok(p.hochrechnung.anteilBopp > 0.53 && p.hochrechnung.anteilBopp < 0.57,
    `anteilBopp out of range: ${p.hochrechnung.anteilBopp}`);
  // Konfidenzintervall sollte sehr eng sein, weil alle Swings identisch sind (sd=0)
  assert.ok(p.hochrechnung.anteilBoppUpper - p.hochrechnung.anteilBoppLower < 0.01,
    `KI zu breit: ${p.hochrechnung.anteilBoppLower}-${p.hochrechnung.anteilBoppUpper}`);
});

test("Konsistenter Swing -> KI schrumpft mit mehr Auszählung", () => {
  const baseline = makeBaseline([0.45, 0.5, 0.55, 0.5, 0.5, 0.5, 0.5]);
  const sharesAll = [0.47, 0.52, 0.57, 0.52, 0.52, 0.52, 0.52];
  const p2 = project(
    baseline,
    makeCurrent(sharesAll, [true, true, false, false, false, false, false]),
  );
  const p5 = project(
    baseline,
    makeCurrent(sharesAll, [true, true, true, true, true, false, false]),
  );
  // Mehr Auszählung -> KI schmaler (oder gleich, weil swingSd evtl. =0)
  const w2 = p2.hochrechnung.anteilBoppUpper - p2.hochrechnung.anteilBoppLower;
  const w5 = p5.hochrechnung.anteilBoppUpper - p5.hochrechnung.anteilBoppLower;
  assert.ok(w5 <= w2 + 1e-9, `KI sollte schmaler oder gleich werden: ${w2} vs ${w5}`);
});

test("1 Kreis ausgezählt -> status vorlaeufig, mit Fallback-SD", () => {
  const baseline = makeBaseline([0.45, 0.5, 0.55, 0.5, 0.5, 0.5, 0.5]);
  const shares = [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5];
  const p = project(
    baseline,
    makeCurrent(shares, [true, false, false, false, false, false, false]),
  );
  assert.equal(p.status, "vorlaeufig");
  assert.ok(p.hochrechnung.anteilBoppUpper > p.hochrechnung.anteilBoppLower);
});

test("normCdf monoton & Randwerte plausibel", () => {
  const { normCdf } = _internal;
  assert.ok(Math.abs(normCdf(0) - 0.5) < 1e-3);
  assert.ok(normCdf(1.96) > 0.97 && normCdf(1.96) < 0.98);
  assert.ok(normCdf(-1.96) > 0.024 && normCdf(-1.96) < 0.026);
  assert.ok(normCdf(3) > 0.998);
});

test("computeSwing — gewichteter Mittelwert", () => {
  const { computeSwing } = _internal;
  const baselineByName = new Map([
    ["A", { name: "A", stimmenBopp: 50, stimmenFritschi: 50, wahlberechtigte: 100 }],
    ["B", { name: "B", stimmenBopp: 40, stimmenFritschi: 60, wahlberechtigte: 100 }],
  ]);
  const r = computeSwing(
    [
      { name: "A", stimmenBopp: 60, stimmenFritschi: 40 }, // swing +0.10, weight 100
      { name: "B", stimmenBopp: 50, stimmenFritschi: 50 }, // swing +0.10, weight 100
    ],
    baselineByName,
  );
  assert.ok(Math.abs(r.swingAvg - 0.10) < 1e-9);
  assert.ok(Math.abs(r.swingSd - 0) < 1e-9);
});
