// Stadtkreis-Swing-Hochrechnung Stadtpräsidium Winterthur 2. Wahlgang.
//
// Inputs:
//   baseline = parseStadtpraesidium(...) der 1.-WG-Daten (alle Stadtkreise ausgezählt)
//   current  = parseStadtpraesidium(...) der 2.-WG-Daten (gemischt, einige offen)

const Z_95 = 1.96;
const Z_99 = 2.576;

/** Standard Normal CDF — Abramowitz/Stegun 26.2.17 */
function normCdf(x) {
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

/** Schätzung für einen einzelnen offenen Stadtkreis. */
function estimateOpenKreis(base, swingAvg, beteiligungAvg) {
  const wb = base.wahlberechtigte || 0;
  const baseDenom = (base.stimmenBopp || 0) + (base.stimmenFritschi || 0);
  const p1 = baseDenom > 0 ? base.stimmenBopp / baseDenom : 0.5;
  const pHat = clamp(p1 + swingAvg, 0, 1);

  const beteiligung = beteiligungAvg ?? (base.beteiligung || 0) / 100;
  // (Bopp+Fritschi)-Stimmen-Verhältnis zu Wahlberechtigten im 1. WG, skaliert mit Beteiligungs-Quotient
  const baselineRatio = wb > 0 ? baseDenom / wb : 0.45;
  const beteiligungRatio = base.beteiligung ? beteiligung / (base.beteiligung / 100) : 1;
  const stimmenBF = wb * baselineRatio * beteiligungRatio;

  // Verhältnisse aus 1. WG übernehmen — eingelegt/gueltig/ungueltig/leer/vereinzelte
  // skalieren proportional zu eingelegten Stimmen.
  const eingelegteEst = wb * beteiligung;
  const baseEingelegte = base.eingelegte || wb * (base.beteiligung / 100 || 0.5);
  const skalierung = baseEingelegte > 0 ? eingelegteEst / baseEingelegte : 1;

  const ungueltigEst = (base.ungueltige || 0) * skalierung;
  const leereEst = (base.leere || 0) * skalierung;
  const vereinzelteEst = (base.stimmenVereinzelte || 0) * skalierung;
  // gueltig = bopp + fritschi + vereinzelte + leer (konsistent mit Komponenten)
  const gueltigEst = stimmenBF + vereinzelteEst + leereEst;

  return {
    geschaetzteStimmenBopp: stimmenBF * pHat,
    geschaetzteStimmenFritschi: stimmenBF * (1 - pHat),
    geschaetzteStimmenBF: stimmenBF,
    geschaetzteStimmenVereinzelte: vereinzelteEst,
    geschaetzteGueltig: gueltigEst,
    geschaetzteEingelegte: eingelegteEst,
    geschaetzteUngueltige: ungueltigEst,
    geschaetzteLeere: leereEst,
    geschaetzteBeteiligung: beteiligung * 100,
    geschaetzterAnteilBopp: pHat,
    wahlberechtigte: wb,
  };
}

/** Hauptfunktion — liefert komplettes Hochrechnungs-Objekt. */
export function project(baseline, current) {
  if (!baseline || !current) return emptyProjection("Daten fehlen");

  const baselineByName = indexByName(baseline.stadtkreise);
  const ausgezaehlt = (current.stadtkreise || []).filter((s) => s.ausgezaehlt);
  const offen = (current.stadtkreise || []).filter((s) => !s.ausgezaehlt);

  const aktuell = sumActual(ausgezaehlt);
  const baselineTotal = sumBaseline(baseline.stadtkreise);
  const { swingAvg, swingSd, swings } = computeSwing(ausgezaehlt, baselineByName);
  const beteiligungAvg = computeAvgBeteiligung(ausgezaehlt, baseline);

  // === Sonderfall: 0 ausgezählt =====================================
  if (ausgezaehlt.length === 0) {
    const stadtkreise = enrichStadtkreise(current.stadtkreise, baselineByName, null, null, null);
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
      stadtkreise,
      timestamp: current.timestamp,
    };
  }

  // === Sonderfall: alles ausgezählt =================================
  if (offen.length === 0) {
    const stimmenTotal = aktuell.stimmenBopp + aktuell.stimmenFritschi;
    const p = stimmenTotal > 0 ? aktuell.stimmenBopp / stimmenTotal : null;
    const stadtkreise = enrichStadtkreise(
      current.stadtkreise, baselineByName, swingAvg, null, null,
    );
    return {
      status: "final",
      message: "Alle Stadtkreise ausgezählt.",
      aktuell,
      hochrechnung: {
        anteilBopp: p,
        anteilBoppLower: p,
        anteilBoppUpper: p,
        anteilBoppLower99: p,
        anteilBoppUpper99: p,
        stimmenBopp: aktuell.stimmenBopp,
        stimmenFritschi: aktuell.stimmenFritschi,
        vorsprung: aktuell.stimmenBopp - aktuell.stimmenFritschi,
        vorsprungLower: aktuell.stimmenBopp - aktuell.stimmenFritschi,
        vorsprungUpper: aktuell.stimmenBopp - aktuell.stimmenFritschi,
        vorsprungLower99: aktuell.stimmenBopp - aktuell.stimmenFritschi,
        vorsprungUpper99: aktuell.stimmenBopp - aktuell.stimmenFritschi,
        beteiligung: aktuell.beteiligung,
        gueltig: aktuell.gueltig,
        ungueltige: aktuell.ungueltige,
        leere: aktuell.leere,
        stimmenVereinzelte: aktuell.stimmenVereinzelte,
        eingelegte: aktuell.eingelegte,
        wahlberechtigte: aktuell.wahlberechtigte,
      },
      pSiegBopp: p == null ? null : p > 0.5 ? 1 : p < 0.5 ? 0 : 0.5,
      swingAvg,
      swingSd,
      swings,
      ausgezaehlteKreise: ausgezaehlt.length,
      offeneKreise: 0,
      ausgezaehlteStimmen: stimmenTotal,
      geschaetzteStimmen: 0,
      totalStimmen: stimmenTotal,
      baselineTotal,
      stadtkreise,
      timestamp: current.timestamp,
    };
  }

  // === Hauptfall: Mix aus ausgezählt + offen ========================
  // Schätzungen pro offenen Kreis sammeln
  const schaetzungen = new Map(); // name -> estimate
  let geschaetzteStimmenBopp = 0;
  let geschaetzteStimmenFritschi = 0;
  let geschaetzteStimmenBF = 0;
  let geschaetzteStimmenVereinzelte = 0;
  let geschaetzteEingelegte = 0;
  let geschaetzteGueltig = 0;
  let geschaetzteUngueltige = 0;
  let geschaetzteLeere = 0;
  let geschaetzteWahlberechtigte = 0;
  for (const k of offen) {
    const base = baselineByName.get(k.name);
    if (!base) continue;
    const e = estimateOpenKreis(base, swingAvg, beteiligungAvg);
    schaetzungen.set(k.name, e);
    geschaetzteStimmenBopp += e.geschaetzteStimmenBopp;
    geschaetzteStimmenFritschi += e.geschaetzteStimmenFritschi;
    geschaetzteStimmenBF += e.geschaetzteStimmenBF;
    geschaetzteStimmenVereinzelte += e.geschaetzteStimmenVereinzelte;
    geschaetzteEingelegte += e.geschaetzteEingelegte;
    geschaetzteGueltig += e.geschaetzteGueltig;
    geschaetzteUngueltige += e.geschaetzteUngueltige;
    geschaetzteLeere += e.geschaetzteLeere;
    geschaetzteWahlberechtigte += e.wahlberechtigte;
  }

  const stimmenBoppHR = aktuell.stimmenBopp + geschaetzteStimmenBopp;
  const stimmenFritschiHR = aktuell.stimmenFritschi + geschaetzteStimmenFritschi;
  const totalBF = stimmenBoppHR + stimmenFritschiHR;
  const p = totalBF > 0 ? stimmenBoppHR / totalBF : null;

  const totalEingelegteHR = aktuell.eingelegte + geschaetzteEingelegte;
  const totalGueltigHR = aktuell.gueltig + geschaetzteGueltig;
  const totalUngueltigHR = aktuell.ungueltige + geschaetzteUngueltige;
  const totalLeereHR = aktuell.leere + geschaetzteLeere;
  const totalVereinzelteHR = aktuell.stimmenVereinzelte + geschaetzteStimmenVereinzelte;
  const totalWahlberechtigteHR = aktuell.wahlberechtigte + geschaetzteWahlberechtigte;
  const totalBeteiligungHR =
    totalWahlberechtigteHR > 0 ? (totalEingelegteHR / totalWahlberechtigteHR) * 100 : null;

  // Konfidenzintervall: Swing-SD * Anteil noch nicht ausgezählter Stimmen.
  // Fallback ±2.5pp wenn nur 1 ausgezählter Kreis (swingSd=null).
  const offenAnteilStimmen = totalBF > 0 ? geschaetzteStimmenBF / totalBF : 0;
  const sdEff = (swingSd ?? 0.025) * offenAnteilStimmen;
  const lower95 = p == null ? null : clamp(p - Z_95 * sdEff, 0, 1);
  const upper95 = p == null ? null : clamp(p + Z_95 * sdEff, 0, 1);
  const lower99 = p == null ? null : clamp(p - Z_99 * sdEff, 0, 1);
  const upper99 = p == null ? null : clamp(p + Z_99 * sdEff, 0, 1);
  const pSiegBopp =
    p == null
      ? null
      : sdEff < 1e-9
        ? p > 0.5 ? 1 : 0
        : 1 - normCdf((0.5 - p) / sdEff);

  const stadtkreise = enrichStadtkreise(
    current.stadtkreise, baselineByName, swingAvg, schaetzungen, beteiligungAvg,
  );

  return {
    status: ausgezaehlt.length === 1 ? "vorlaeufig" : "hochgerechnet",
    message:
      ausgezaehlt.length === 1
        ? "Nur 1 Stadtkreis ausgezählt — Hochrechnung sehr unsicher."
        : null,
    aktuell,
    hochrechnung: {
      anteilBopp: p,
      anteilBoppLower: lower95,
      anteilBoppUpper: upper95,
      anteilBoppLower99: lower99,
      anteilBoppUpper99: upper99,
      stimmenBopp: stimmenBoppHR,
      stimmenFritschi: stimmenFritschiHR,
      vorsprung: stimmenBoppHR - stimmenFritschiHR,
      vorsprungLower: lower95 != null ? totalBF * (2 * lower95 - 1) : null,
      vorsprungUpper: upper95 != null ? totalBF * (2 * upper95 - 1) : null,
      vorsprungLower99: lower99 != null ? totalBF * (2 * lower99 - 1) : null,
      vorsprungUpper99: upper99 != null ? totalBF * (2 * upper99 - 1) : null,
      beteiligung: totalBeteiligungHR,
      gueltig: totalGueltigHR,
      ungueltige: totalUngueltigHR,
      leere: totalLeereHR,
      stimmenVereinzelte: totalVereinzelteHR,
      eingelegte: totalEingelegteHR,
      wahlberechtigte: totalWahlberechtigteHR,
    },
    pSiegBopp,
    swingAvg,
    swingSd,
    swings,
    ausgezaehlteKreise: ausgezaehlt.length,
    offeneKreise: offen.length,
    ausgezaehlteStimmen: aktuell.stimmenBopp + aktuell.stimmenFritschi,
    geschaetzteStimmen: geschaetzteStimmenBF,
    totalStimmen: totalBF,
    baselineTotal,
    stadtkreise,
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
  let b = 0, f = 0, v = 0, g = 0, u = 0, l = 0, e = 0, wb = 0;
  for (const k of ausgezaehlt) {
    b += k.stimmenBopp || 0;
    f += k.stimmenFritschi || 0;
    v += k.stimmenVereinzelte || 0;
    g += k.gueltig || 0;
    u += k.ungueltige || 0;
    l += k.leere || 0;
    e += k.eingelegte || 0;
    wb += k.wahlberechtigte || 0;
  }
  const total = b + f;
  return {
    stimmenBopp: b,
    stimmenFritschi: f,
    stimmenVereinzelte: v,
    gueltig: g,
    ungueltige: u,
    leere: l,
    eingelegte: e,
    wahlberechtigte: wb,
    vorsprung: b - f,
    anteilBopp: total > 0 ? b / total : null,
    anteilFritschi: total > 0 ? f / total : null,
    beteiligung: wb > 0 ? (e / wb) * 100 : null,
  };
}

function sumBaseline(stadtkreise) {
  let b = 0, f = 0, wb = 0, g = 0;
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
  if (swings.length === 0) return { swingAvg: 0, swingSd: null, swings };
  const totalW = swings.reduce((s, x) => s + x.weight, 0);
  const swingAvg = swings.reduce((s, x) => s + x.swing * x.weight, 0) / totalW;
  let swingSd = null;
  if (swings.length >= 2) {
    const variance =
      swings.reduce((s, x) => s + x.weight * (x.swing - swingAvg) ** 2, 0) / totalW;
    swingSd = Math.sqrt(variance);
  }
  return { swingAvg, swingSd, swings };
}

function computeAvgBeteiligung(ausgezaehlt, baseline) {
  let weight = 0, weighted = 0;
  for (const k of ausgezaehlt) {
    if (k.beteiligung == null || k.wahlberechtigte == null) continue;
    weight += k.wahlberechtigte;
    weighted += (k.beteiligung / 100) * k.wahlberechtigte;
  }
  if (weight > 0) return weighted / weight;
  const b = baseline?.total?.beteiligung;
  return b != null ? b / 100 : null;
}

/**
 * Reichert jeden Stadtkreis an. Bei offenen Kreisen wird die Schätzung
 * eingebettet, sodass das Frontend dieselben Felder rendern kann wie bei
 * ausgezählten Kreisen.
 */
function enrichStadtkreise(stadtkreise, baselineByName, swingAvg, schaetzungen, beteiligungAvg) {
  return (stadtkreise || []).map((k) => {
    const base = baselineByName.get(k.name);
    let baselineAnteilBopp = null;
    let swing = null;
    if (base) {
      const denom = base.stimmenBopp + base.stimmenFritschi;
      if (denom > 0) baselineAnteilBopp = base.stimmenBopp / denom;
    }
    if (k.ausgezaehlt && k.anteilBopp != null && baselineAnteilBopp != null) {
      swing = k.anteilBopp - baselineAnteilBopp;
    }
    // Beteiligungs-Diff zur 1.WG (in Prozentpunkten)
    let beteiligungDiff = null;
    if (k.ausgezaehlt && k.beteiligung != null && base?.beteiligung != null) {
      beteiligungDiff = k.beteiligung - base.beteiligung;
    }
    const enriched = {
      ...k,
      baselineAnteilBopp,
      baselineWahlberechtigte: base?.wahlberechtigte ?? null,
      baselineBeteiligung: base?.beteiligung ?? null,
      baselineStimmenBopp: base?.stimmenBopp ?? null,
      baselineStimmenFritschi: base?.stimmenFritschi ?? null,
      swing,
      beteiligungDiff,
    };
    if (!k.ausgezaehlt && schaetzungen?.has(k.name) && base) {
      const e = schaetzungen.get(k.name);
      enriched.geschaetzt = true;
      enriched.geschaetzteStimmenBopp = e.geschaetzteStimmenBopp;
      enriched.geschaetzteStimmenFritschi = e.geschaetzteStimmenFritschi;
      enriched.geschaetzterAnteilBopp = e.geschaetzterAnteilBopp;
      enriched.geschaetzteBeteiligung = e.geschaetzteBeteiligung;
      enriched.geschaetzteEingelegte = e.geschaetzteEingelegte;
      enriched.geschaetzteGueltig = e.geschaetzteGueltig;
      enriched.geschaetzterSwing = swingAvg;
      // Geschätzte Beteiligungs-Differenz zur 1.WG
      enriched.geschaetzteBeteiligungDiff =
        base.beteiligung != null ? e.geschaetzteBeteiligung - base.beteiligung : null;
    } else if (!k.ausgezaehlt) {
      enriched.geschaetzt = false;
    }
    return enriched;
  });
}

function clamp(x, lo, hi) {
  return Math.max(lo, Math.min(hi, x));
}

export const _internal = {
  normCdf,
  computeSwing,
  computeAvgBeteiligung,
  sumActual,
  estimateOpenKreis,
  clamp,
};
