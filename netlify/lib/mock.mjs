// Simulator: erzeugt synthetische 2.-WG-Daten basierend auf der 1.-WG-Baseline.
// Wird im /api/results-Endpoint via Query-Params getriggert (?mock=N&swing=X).

/**
 * @param {object} baseline - parseStadtpraesidium-Output der 1.WG (alle 7 Stadtkreise ausgezählt)
 * @param {object} opts
 * @param {number} opts.ausgezaehlt - 0..7, wie viele Stadtkreise ausgezählt sein sollen
 * @param {number} opts.swingPp - Mittlerer Swing zugunsten Bopp in Prozentpunkten (z.B. +3 = +0.03)
 * @param {number} opts.noisePp - Streuung des Swings pro Stadtkreis in pp (deterministisch via Seed)
 * @param {number} opts.beteiligungFactor - Multiplikator zur Beteiligung 1.WG (1.0 = gleich)
 * @returns {object} current — gleicher Shape wie parseStadtpraesidium-Output
 */
export function mockCurrent(baseline, opts = {}) {
  const ausgezaehlt = clamp(Number.isFinite(opts.ausgezaehlt) ? opts.ausgezaehlt : 0, 0, 7);
  const swingPp = Number.isFinite(opts.swingPp) ? opts.swingPp : 0;
  const noisePp = Number.isFinite(opts.noisePp) ? opts.noisePp : 0;
  const beteiligungFactor = Number.isFinite(opts.beteiligungFactor) ? opts.beteiligungFactor : 1.0;
  const swing = swingPp / 100;
  const noise = noisePp / 100;

  // Stadtkreise in der gleichen Reihenfolge — die ersten N werden als ausgezählt markiert,
  // die restlichen leer. (Reihenfolge entspricht der Baseline-Reihenfolge.)
  const stadtkreise = baseline.stadtkreise.map((k, i) => {
    const isOpen = i >= ausgezaehlt;
    if (isOpen) {
      return {
        geoLevelnummer: k.geoLevelnummer,
        name: k.name,
        fullName: k.fullName,
        ausgezaehlt: false,
        wahlberechtigte: null,
        eingelegte: null,
        gueltig: null,
        beteiligung: null,
        stimmenBopp: null,
        stimmenFritschi: null,
        anteilBopp: null,
      };
    }
    // Deterministisches "Rauschen" pro Stadtkreis-Name (für reproduzierbare Sims)
    const seedNoise = noise === 0 ? 0 : noise * (hashStr(k.name) - 0.5) * 2;
    const baseDenom = k.stimmenBopp + k.stimmenFritschi;
    const p1 = baseDenom > 0 ? k.stimmenBopp / baseDenom : 0.5;
    const p2 = clamp(p1 + swing + seedNoise, 0.001, 0.999);
    const newDenom = Math.round(baseDenom * beteiligungFactor);
    const newBopp = Math.round(newDenom * p2);
    const newFritschi = newDenom - newBopp;
    const newBet = clamp((k.beteiligung || 50) * beteiligungFactor, 1, 99);
    const wb = k.wahlberechtigte;
    // Skaliere ungueltig/leer/Vereinzelte aus 1.WG-Verhältnissen
    const baseEingelegte = k.eingelegte || wb * (k.beteiligung / 100 || 0.5);
    const eingelegteEst = wb * (newBet / 100);
    const skalierung = baseEingelegte > 0 ? eingelegteEst / baseEingelegte : 1;
    const ungueltigeEst = Math.round((k.ungueltige || 0) * skalierung);
    const leereEst = Math.round((k.leere || 0) * skalierung);
    const vereinzelteEst = Math.round((k.stimmenVereinzelte || 0) * skalierung);
    const gueltigEst = newDenom + leereEst + vereinzelteEst;
    return {
      geoLevelnummer: k.geoLevelnummer,
      name: k.name,
      fullName: k.fullName,
      ausgezaehlt: true,
      wahlberechtigte: wb,
      eingelegte: Math.round(eingelegteEst),
      gueltig: gueltigEst,
      ungueltige: ungueltigeEst,
      leere: leereEst,
      kandidatenStimmenTotal: newDenom + vereinzelteEst,
      beteiligung: newBet,
      stimmenBopp: newBopp,
      stimmenFritschi: newFritschi,
      stimmenVereinzelte: vereinzelteEst,
      anteilBopp: newBopp / newDenom,
    };
  });

  // Aggregat-Felder (nur über ausgezählte)
  const ausg = stadtkreise.filter((k) => k.ausgezaehlt);
  const sumBopp = ausg.reduce((s, k) => s + k.stimmenBopp, 0);
  const sumFritschi = ausg.reduce((s, k) => s + k.stimmenFritschi, 0);
  const sumV = ausg.reduce((s, k) => s + (k.stimmenVereinzelte || 0), 0);
  const sumU = ausg.reduce((s, k) => s + (k.ungueltige || 0), 0);
  const sumL = ausg.reduce((s, k) => s + (k.leere || 0), 0);
  const sumWb = ausg.reduce((s, k) => s + (k.wahlberechtigte || 0), 0);
  const sumE = ausg.reduce((s, k) => s + (k.eingelegte || 0), 0);
  const sumG = ausg.reduce((s, k) => s + (k.gueltig || 0), 0);

  return {
    abstimmtag: "2026-05-10",
    timestamp: new Date().toISOString().slice(0, 19),
    vorlagenId: 537145,
    titel: "[MOCK] Zweiter Wahlgang Stadtpräsidium Winterthur — simulierte Daten",
    gebietAusgezaehlt: ausgezaehlt === 7,
    candidates: baseline.candidates,
    total: {
      wahlberechtigte: ausgezaehlt === 7 ? sumWb : null,
      eingelegte: ausgezaehlt === 7 ? sumE : null,
      gueltig: ausgezaehlt === 7 ? sumG : null,
      ungueltige: ausgezaehlt === 7 ? sumU : null,
      leere: ausgezaehlt === 7 ? sumL : null,
      stimmenVereinzelte: ausgezaehlt === 7 ? sumV : null,
      beteiligung: ausgezaehlt === 7 && sumWb > 0 ? (sumE / sumWb) * 100 : null,
      stimmenBopp: ausgezaehlt === 7 ? sumBopp : null,
      stimmenFritschi: ausgezaehlt === 7 ? sumFritschi : null,
      anteilBopp:
        ausgezaehlt === 7 && sumBopp + sumFritschi > 0
          ? sumBopp / (sumBopp + sumFritschi)
          : null,
      anteilFritschi:
        ausgezaehlt === 7 && sumBopp + sumFritschi > 0
          ? sumFritschi / (sumBopp + sumFritschi)
          : null,
    },
    stadtkreise,
    _mock: { ausgezaehlt, swingPp, noisePp, beteiligungFactor },
  };
}

function clamp(x, lo, hi) {
  return Math.max(lo, Math.min(hi, x));
}

// Stabile Hash-Funktion -> [0,1)
function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10000) / 10000;
}
