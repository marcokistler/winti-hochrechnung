// Stadtkreis-Swing-Hochrechnung Stadtpräsidium Winterthur 2. Wahlgang.
//
// Inputs:
//   baseline = parseStadtpraesidium(...) der 1.-WG-Daten (alle Stadtkreise ausgezählt)
//   current  = parseStadtpraesidium(...) der 2.-WG-Daten (gemischt, einige offen)
//
// Output: siehe project()

const Z_95 = 1.96;

/**
 * Standard Normal CDF, Abramowitz & Stegun 7.1.26 Approximation.
 * Genau genug fürs Dashboard.
 */
function normCdf(x) {
  // Approximation nach Abramowitz/Stegun 26.2.17
  const b1 = 0.319381530;
  const b2 = -0.356563782;
  const b3 = 1.781477937;
  const b4 = -1.821255978;
  const b5 = 1.330274429;
  const p = 0.2316419;
  const c = 0.39894228;
  if (x >= 0) {
    const t = 1 / (1 + p * x);
    return (
      1 -
      c *
        Math.exp((-x * x) / 2) *
        (t * (b1 + t * (b2 + t * (b3 + t * (b4 + t * b5)))))
    );
  }
  return 1 - normCdf(-x);
}

/**
 * Hauptfunktion. Liefert Hochrechnungs-Objekt.
 */
export function project(baseline, current) {
  if (!baseline || !current) {
    return emptyProjection("Daten fehlen");
  }
  const baselineByName = indexByName(baseline.stadtkreise);
  const ausgezaehlt = (current.stadtkreise || []).filter((s) => s.ausgezaehlt);
  const offen = (current.stadtkreise || []).filter((s) => !s.ausgezaehlt);

  // Aktueller Stand (nur ausgezählte)
  const aktuell = sumActual(ausgezaehlt);
  const baselineTotal = sumBaseline(baseline.stadtkreise);

  // Sonderfall: 0 ausgezählt
  if (ausgezaehlt.length === 0) {
    return {
      status: "warten",
      message: "Noch keine Stadtkreise ausgezählt.",
      aktuell,
      hochrechnung: null,
      pSiegBopp: null,
      swingAvg: null,
      swingSd: null,
      ausgezaehlteKreise: 0,
      offeneKreise: offen.length,
      ausgezaehlteStimmen: 0,
      geschaetzteStimmen: null,
      totalStimmen: null,
      baselineTotal,
      stadtkreise: enrichStadtkreise(current.stadtkreise, baselineByName, null),
      timestamp: current.timestamp,
    };
  }

  // Sonderfall: alles ausgezählt
  if (offen.length === 0) {
    const stimmenTotal = aktuell.stimmenBopp + aktuell.stimmenFritschi;
    const p = stimmenTotal > 0 ? aktuell.stimmenBopp / stimmenTotal : null;
    return {
      status: "final",
      message: "Alle Stadtkreise ausgezählt.",
      aktuell,
      hochrechnung: {
        anteilBopp: p,
        anteilBoppLower: p,
        anteilBoppUpper: p,
        stimmenBopp: aktuell.stimmenBopp,
        stimmenFritschi: aktuell.stimmenFritschi,
        beteiligung: aktuell.beteiligung,
      },
      pSiegBopp: p == null ? null : p > 0.5 ? 1 : p < 0.5 ? 0 : 0.5,
      swingAvg: computeSwing(ausgezaehlt, baselineByName).swingAvg,
      swingSd: computeSwing(ausgezaehlt, baselineByName).swingSd,
      ausgezaehlteKreise: ausgezaehlt.length,
      offeneKreise: 0,
      ausgezaehlteStimmen: stimmenTotal,
      geschaetzteStimmen: 0,
      totalStimmen: stimmenTotal,
      baselineTotal,
      stadtkreise: enrichStadtkreise(
        current.stadtkreise,
        baselineByName,
        computeSwing(ausgezaehlt, baselineByName).swingAvg,
      ),
      timestamp: current.timestamp,
    };
  }

  // Hauptfall: Mix
  const { swingAvg, swingSd, swings } = computeSwing(ausgezaehlt, baselineByName);
  const beteiligungAvg = computeAvgBeteiligung(ausgezaehlt, baseline);
  const baselineByNameMap = baselineByName;

  // Schätze offene Kreise
  let geschaetzteStimmenBopp = 0;
  let geschaetzteStimmenFritschi = 0;
  let geschaetzteStimmenTotal = 0;
  for (const k of offen) {
    const base = baselineByNameMap.get(k.name);
    if (!base) continue;
    const baseDenom = (base.stimmenBopp || 0) + (base.stimmenFritschi || 0);
    const p1 = baseDenom > 0 ? base.stimmenBopp / baseDenom : 0.5;
    const pHat = clamp(p1 + swingAvg, 0, 1);
    // Erwartete Stimmen: Wahlberechtigte * Beteiligung
    // (Beteiligung 1.WG hat sich bisher nicht stark unterschieden)
    const wb = base.wahlberechtigte || 0;
    const beteiligung = beteiligungAvg ?? (base.beteiligung || 0) / 100;
    // Erwartete (Bopp+Fritschi)-Stimmen im Stadtkreis:
    // Verhältnis (Bopp+Fritschi)/Wahlberechtigte aus 1. WG, skaliert mit Beteiligungs-Quotient.
    const baselineRatio = base.wahlberechtigte
      ? (base.stimmenBopp + base.stimmenFritschi) / base.wahlberechtigte
      : 0.45;
    const beteiligungRatio = base.beteiligung
      ? beteiligung / (base.beteiligung / 100)
      : 1;
    const stimmen = wb * baselineRatio * beteiligungRatio;

    geschaetzteStimmenBopp += stimmen * pHat;
    geschaetzteStimmenFritschi += stimmen * (1 - pHat);
    geschaetzteStimmenTotal += stimmen;
  }

  const stimmenBoppHR = aktuell.stimmenBopp + geschaetzteStimmenBopp;
  const stimmenFritschiHR = aktuell.stimmenFritschi + geschaetzteStimmenFritschi;
  const total = stimmenBoppHR + stimmenFritschiHR;
  const p = total > 0 ? stimmenBoppHR / total : null;

  // SE: Swing-SD * (Anteil noch nicht ausgezählter Stimmen).
  // Konservative Approximation. Bei nur 1 ausgezähltem Kreis: swingSd=null → wir
  // setzen ein Fallback-SD von 0.025 (≈±2.5pp).
  const offenAnteilStimmen = total > 0 ? geschaetzteStimmenTotal / total : 0;
  const sdEff = (swingSd ?? 0.025) * offenAnteilStimmen;
  const lower = p == null ? null : clamp(p - Z_95 * sdEff, 0, 1);
  const upper = p == null ? null : clamp(p + Z_95 * sdEff, 0, 1);
  const pSiegBopp =
    p == null ? null : sdEff < 1e-9 ? (p > 0.5 ? 1 : 0) : 1 - normCdf((0.5 - p) / sdEff);

  return {
    status: ausgezaehlt.length === 1 ? "vorlaeufig" : "hochgerechnet",
    message:
      ausgezaehlt.length === 1
        ? "Nur 1 Stadtkreis ausgezählt — Hochrechnung sehr unsicher."
        : null,
    aktuell,
    hochrechnung: {
      anteilBopp: p,
      anteilBoppLower: lower,
      anteilBoppUpper: upper,
      stimmenBopp: stimmenBoppHR,
      stimmenFritschi: stimmenFritschiHR,
      beteiligung: beteiligungAvg != null ? beteiligungAvg * 100 : null,
    },
    pSiegBopp,
    swingAvg,
    swingSd,
    swings,
    ausgezaehlteKreise: ausgezaehlt.length,
    offeneKreise: offen.length,
    ausgezaehlteStimmen: aktuell.stimmenBopp + aktuell.stimmenFritschi,
    geschaetzteStimmen: geschaetzteStimmenTotal,
    totalStimmen: total,
    baselineTotal,
    stadtkreise: enrichStadtkreise(current.stadtkreise, baselineByName, swingAvg),
    timestamp: current.timestamp,
  };
}

function emptyProjection(msg) {
  return {
    status: "fehler",
    message: msg,
    aktuell: null,
    hochrechnung: null,
    stadtkreise: [],
    timestamp: null,
  };
}

function indexByName(stadtkreise) {
  const m = new Map();
  for (const k of stadtkreise || []) m.set(k.name, k);
  return m;
}

function sumActual(ausgezaehlt) {
  let b = 0,
    f = 0,
    g = 0,
    e = 0,
    wb = 0;
  for (const k of ausgezaehlt) {
    b += k.stimmenBopp || 0;
    f += k.stimmenFritschi || 0;
    g += k.gueltig || 0;
    e += k.eingelegte || 0;
    wb += k.wahlberechtigte || 0;
  }
  const total = b + f;
  return {
    stimmenBopp: b,
    stimmenFritschi: f,
    gueltig: g,
    eingelegte: e,
    wahlberechtigte: wb,
    vorsprung: b - f,
    anteilBopp: total > 0 ? b / total : null,
    anteilFritschi: total > 0 ? f / total : null,
    beteiligung: wb > 0 ? (e / wb) * 100 : null,
  };
}

function sumBaseline(stadtkreise) {
  let b = 0,
    f = 0,
    wb = 0,
    g = 0;
  for (const k of stadtkreise || []) {
    b += k.stimmenBopp || 0;
    f += k.stimmenFritschi || 0;
    wb += k.wahlberechtigte || 0;
    g += k.gueltig || 0;
  }
  const total = b + f;
  return {
    stimmenBopp: b,
    stimmenFritschi: f,
    wahlberechtigte: wb,
    gueltig: g,
    anteilBopp: total > 0 ? b / total : null,
  };
}

function computeSwing(ausgezaehlt, baselineByName) {
  const swings = [];
  for (const k of ausgezaehlt) {
    const denom = (k.stimmenBopp || 0) + (k.stimmenFritschi || 0);
    if (denom <= 0) continue;
    const p2 = k.stimmenBopp / denom;
    const base = baselineByName.get(k.name);
    if (!base) continue;
    const baseDenom = base.stimmenBopp + base.stimmenFritschi;
    if (baseDenom <= 0) continue;
    const p1 = base.stimmenBopp / baseDenom;
    swings.push({ name: k.name, p1, p2, swing: p2 - p1, weight: denom });
  }
  if (swings.length === 0) {
    return { swingAvg: 0, swingSd: null, swings };
  }
  const totalW = swings.reduce((s, x) => s + x.weight, 0);
  const swingAvg =
    swings.reduce((s, x) => s + x.swing * x.weight, 0) / totalW;
  let swingSd = null;
  if (swings.length >= 2) {
    const variance =
      swings.reduce(
        (s, x) => s + x.weight * (x.swing - swingAvg) ** 2,
        0,
      ) / totalW;
    swingSd = Math.sqrt(variance);
  }
  return { swingAvg, swingSd, swings };
}

function computeAvgBeteiligung(ausgezaehlt, baseline) {
  let weight = 0;
  let weighted = 0;
  for (const k of ausgezaehlt) {
    if (k.beteiligung == null || k.wahlberechtigte == null) continue;
    weight += k.wahlberechtigte;
    weighted += (k.beteiligung / 100) * k.wahlberechtigte;
  }
  if (weight > 0) return weighted / weight;
  // Fallback 1. Wahlgang
  const b = baseline?.total?.beteiligung;
  return b != null ? b / 100 : null;
}

function enrichStadtkreise(stadtkreise, baselineByName, swingAvg) {
  return (stadtkreise || []).map((k) => {
    const base = baselineByName.get(k.name);
    let baseAnteilBopp = null;
    let swing = null;
    if (base) {
      const denom = base.stimmenBopp + base.stimmenFritschi;
      if (denom > 0) baseAnteilBopp = base.stimmenBopp / denom;
    }
    if (k.ausgezaehlt && k.anteilBopp != null && baseAnteilBopp != null) {
      swing = k.anteilBopp - baseAnteilBopp;
    }
    return {
      ...k,
      baselineAnteilBopp: baseAnteilBopp,
      baselineWahlberechtigte: base?.wahlberechtigte ?? null,
      baselineBeteiligung: base?.beteiligung ?? null,
      swing,
    };
  });
}

function clamp(x, lo, hi) {
  return Math.max(lo, Math.min(hi, x));
}

// Für Tests:
export const _internal = {
  normCdf,
  computeSwing,
  computeAvgBeteiligung,
  sumActual,
  clamp,
};
