// Frontend: pollt /api/results alle 30s, rendert Dashboard.

const POLL_INTERVAL = 30_000;
const TS_INTERVAL = 60_000;

const state = {
  lastFetchAt: null,
  consecutiveErrors: 0,
  countdownTimer: null,
  pollTimer: null,
  tsTimer: null,
};

const $ = (id) => document.getElementById(id);

const fmtNum = (n) =>
  n == null ? "—" : Math.round(n).toLocaleString("de-CH").replace(/,/g, "’");
const fmtPct = (n, digits = 1) =>
  n == null || isNaN(n) ? "—" : (n * 100).toFixed(digits) + " %";
const fmtSignedPP = (n, digits = 1) =>
  n == null || isNaN(n)
    ? "—"
    : (n >= 0 ? "+" : "") + (n * 100).toFixed(digits) + " pp";

// Signierte Differenz mit Farbe (positiv → bopp-Farbe, negativ → fritschi-Farbe).
// Für Beteiligungs-Diffs neutral coden (nur Plus/Minus, keine Partei-Konnotation).
function signedDiffHtml(n, unit = "pp", neutral = false) {
  if (n == null || isNaN(n)) return "—";
  const text = (n >= 0 ? "+" : "") + (n * 100).toFixed(1) + " " + unit;
  if (neutral) return `<span class="diff">${text}</span>`;
  return `<span class="${n >= 0 ? "swing-up" : "swing-down"}">${text}</span>`;
}
const fmtTime = (ts) => {
  if (!ts) return "—";
  const d = typeof ts === "number" ? new Date(ts) : new Date(ts);
  return d.toLocaleTimeString("de-CH", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
};

// Browser-URL-Parameter (z.B. ?mock=3&swing=4&noise=1.5) werden an die API weitergereicht.
// Das ist v.a. für lokale Tests gedacht — in Produktion einfach ohne Params aufrufen.
const passthroughParams = new URLSearchParams(window.location.search).toString();
const apiSuffix = passthroughParams ? "?" + passthroughParams : "";

async function fetchResults() {
  try {
    const res = await fetch("/api/results" + apiSuffix, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    state.lastFetchAt = Date.now();
    state.consecutiveErrors = 0;
    render(data);
    setStatus("ok", data.cache === "hit" ? "Cache" : "Live");
  } catch (err) {
    state.consecutiveErrors++;
    console.error("[poll] fetch error", err);
    if (state.consecutiveErrors >= 3) {
      setStatus("error", `Verbindung verloren (${state.consecutiveErrors})`);
    } else {
      setStatus("warn", `Wiederhole… (${state.consecutiveErrors})`);
    }
  }
}

async function fetchTimeseries() {
  try {
    const res = await fetch("/api/timeseries", { cache: "no-store" });
    if (!res.ok) return;
    const data = await res.json();
    renderTimeseries(data.points || []);
  } catch (err) {
    console.warn("[ts] fetch error", err);
  }
}

function setStatus(kind, label) {
  const pill = $("status-pill");
  pill.className = "pill " + (
    kind === "ok" ? "pill-good" :
    kind === "warn" ? "pill-warn" :
    kind === "error" ? "pill-error" : "pill-loading"
  );
  pill.textContent = label;
  const dot = document.querySelector(".dot");
  if (dot) dot.classList.toggle("dot-error", kind === "error");
}

function render(data) {
  const p = data.projection;
  const cur = p.aktuell;
  const hr = p.hochrechnung;

  // Aktueller Stand
  $("bopp-stimmen").textContent = fmtNum(cur?.stimmenBopp);
  $("fritschi-stimmen").textContent = fmtNum(cur?.stimmenFritschi);
  $("bopp-anteil").textContent = fmtPct(cur?.anteilBopp);
  $("fritschi-anteil").textContent = fmtPct(cur?.anteilFritschi);

  const lead = (cur?.stimmenBopp ?? 0) - (cur?.stimmenFritschi ?? 0);
  if (cur?.stimmenBopp != null && (cur.stimmenBopp + cur.stimmenFritschi) > 0) {
    $("vorsprung").innerHTML =
      lead === 0
        ? `Gleichstand`
        : lead > 0
          ? `Bopp führt mit <strong>${fmtNum(lead)}</strong> Stimmen`
          : `Fritschi führt mit <strong>${fmtNum(-lead)}</strong> Stimmen`;
  } else {
    $("vorsprung").textContent = "Noch keine Stimmen ausgezählt";
  }

  // Bar
  const totalCur = (cur?.stimmenBopp ?? 0) + (cur?.stimmenFritschi ?? 0);
  if (totalCur > 0) {
    $("bar-bopp").style.width = ((cur.stimmenBopp / totalCur) * 100).toFixed(2) + "%";
    $("bar-fritschi").style.width = ((cur.stimmenFritschi / totalCur) * 100).toFixed(2) + "%";
  } else {
    $("bar-bopp").style.width = "50%";
    $("bar-fritschi").style.width = "50%";
  }

  // Leading
  document.getElementById("card-bopp").classList.toggle("leading", lead > 0);
  document.getElementById("card-fritschi").classList.toggle("leading", lead < 0);

  // Hochrechnung
  const hrStatusEl = $("hr-status");
  if (p.status === "warten") {
    hrStatusEl.className = "pill pill-info";
    hrStatusEl.textContent = "Warten auf Auszählung";
  } else if (p.status === "vorlaeufig") {
    hrStatusEl.className = "pill pill-warn";
    hrStatusEl.textContent = "Vorläufig — sehr unsicher";
  } else if (p.status === "hochgerechnet") {
    hrStatusEl.className = "pill pill-good";
    hrStatusEl.textContent = "Hochgerechnet";
  } else if (p.status === "final") {
    hrStatusEl.className = "pill pill-good";
    hrStatusEl.textContent = "Endresultat";
  } else {
    hrStatusEl.className = "pill pill-error";
    hrStatusEl.textContent = "Fehler";
  }

  if (hr) {
    $("hr-anteil").textContent = fmtPct(hr.anteilBopp);
    if (hr.anteilBoppLower === hr.anteilBoppUpper) {
      $("hr-interval").textContent = "exakt";
      $("hr-interval-99").textContent = "";
    } else {
      $("hr-interval").textContent =
        `95 %-KI: ${fmtPct(hr.anteilBoppLower)} – ${fmtPct(hr.anteilBoppUpper)}`;
      $("hr-interval-99").textContent =
        `99 %-KI: ${fmtPct(hr.anteilBoppLower99)} – ${fmtPct(hr.anteilBoppUpper99)}`;
    }
    if (p.pSiegBopp == null) {
      $("hr-psieg").textContent = "—";
    } else {
      $("hr-psieg").textContent = (p.pSiegBopp * 100).toFixed(0) + " %";
    }

    // KI-Bar visuell — Achsen-Range 0.40–0.60
    renderKiBar(hr);

    // Absolute Zahlen
    $("hr-bopp-stimmen").textContent = fmtNum(hr.stimmenBopp);
    $("hr-fritschi-stimmen").textContent = fmtNum(hr.stimmenFritschi);
    const lead = hr.vorsprung;
    if (lead != null) {
      const sign = lead >= 0 ? "+" : "−";
      $("hr-vorsprung").textContent = `${sign}${fmtNum(Math.abs(lead))}`;
      $("hr-vorsprung").style.color = lead >= 0 ? "var(--bopp)" : "var(--fritschi)";
    }
    if (hr.vorsprungLower != null && hr.vorsprungUpper != null && hr.vorsprungLower !== hr.vorsprungUpper) {
      const sgn = (n) => (n >= 0 ? "+" : "−") + fmtNum(Math.abs(n));
      $("hr-vorsprung-ki").textContent =
        `95 %-KI: ${sgn(Math.round(hr.vorsprungLower))} bis ${sgn(Math.round(hr.vorsprungUpper))}`;
      if (hr.vorsprungLower99 != null && hr.vorsprungUpper99 != null) {
        $("hr-vorsprung-ki-99").textContent =
          `99 %-KI: ${sgn(Math.round(hr.vorsprungLower99))} bis ${sgn(Math.round(hr.vorsprungUpper99))}`;
      } else {
        $("hr-vorsprung-ki-99").textContent = "";
      }
    } else {
      $("hr-vorsprung-ki").textContent = "exakt";
      $("hr-vorsprung-ki-99").textContent = "";
    }

    // Beteiligung
    if (hr.beteiligung != null) {
      $("hr-beteiligung").textContent = hr.beteiligung.toFixed(1) + " %";
      const baseBet = data.baseline?.total?.beteiligung;
      if (baseBet != null) {
        const diff = hr.beteiligung - baseBet;
        const arrow = diff > 0.1 ? "↑" : diff < -0.1 ? "↓" : "≈";
        $("hr-beteiligung-vgl").textContent =
          `1. WG: ${baseBet.toFixed(1)} % ${arrow} ${diff >= 0 ? "+" : ""}${diff.toFixed(1)} pp`;
      } else {
        $("hr-beteiligung-vgl").textContent = "";
      }
    } else {
      $("hr-beteiligung").textContent = "—";
      $("hr-beteiligung-vgl").textContent = "";
    }

    $("hr-eingelegte").textContent = fmtNum(hr.eingelegte);
    $("hr-wahlberechtigte").textContent = fmtNum(hr.wahlberechtigte);

    // Vereinzelte / leere / ungültig (mit %-Anteil zu eingelegt)
    const eAbs = hr.eingelegte || 1;
    $("hr-vereinzelte").textContent = fmtNum(hr.stimmenVereinzelte);
    $("hr-vereinzelte-anteil").textContent =
      hr.stimmenVereinzelte != null ? `${((hr.stimmenVereinzelte / eAbs) * 100).toFixed(1)} % der eingelegten` : "";
    $("hr-leere").textContent = fmtNum(hr.leere);
    $("hr-leere-anteil").textContent =
      hr.leere != null ? `${((hr.leere / eAbs) * 100).toFixed(1)} % der eingelegten` : "";
    $("hr-ungueltig").textContent = fmtNum(hr.ungueltige);
    $("hr-ungueltig-anteil").textContent =
      hr.ungueltige != null ? `${((hr.ungueltige / eAbs) * 100).toFixed(1)} % der eingelegten` : "";
  } else {
    $("hr-anteil").textContent = "—";
    $("hr-interval").textContent = "—";
    $("hr-interval-99").textContent = "";
    $("hr-psieg").textContent = "—";
    for (const id of ["hr-bopp-stimmen","hr-fritschi-stimmen","hr-vorsprung","hr-beteiligung","hr-eingelegte","hr-wahlberechtigte","hr-vereinzelte","hr-leere","hr-ungueltig"]) $(id).textContent = "—";
    $("hr-vorsprung-ki").textContent = "—";
    $("hr-vorsprung-ki-99").textContent = "";
    $("hr-beteiligung-vgl").textContent = "";
    for (const id of ["hr-vereinzelte-anteil","hr-leere-anteil","hr-ungueltig-anteil"]) $(id).textContent = "";
    // KI-Bar zurücksetzen
    $("hr-ki-band-95").style.width = "0%";
    $("hr-ki-band-99").style.width = "0%";
    $("hr-ki-point").style.left = "50%";
  }

  $("ausg-kreise").textContent = p.ausgezaehlteKreise ?? 0;
  $("ausg-stimmen").textContent = fmtNum(p.ausgezaehlteStimmen ?? 0);
  const totalEst = p.totalStimmen ?? 0;
  const ausgPct =
    totalEst > 0 ? ((p.ausgezaehlteStimmen ?? 0) / totalEst) * 100 : 0;
  $("fortschritt-fill").style.width = Math.min(100, ausgPct).toFixed(1) + "%";

  $("hr-swing").textContent =
    p.swingAvg != null
      ? `Mittlerer Swing zum 1. WG: ${fmtSignedPP(p.swingAvg)}` +
        (p.swingSd != null ? ` (Streuung: ${fmtSignedPP(p.swingSd, 2)})` : "")
      : "";

  $("hr-message").textContent = p.message || "";

  // Stadtkreise
  renderKreise(p.stadtkreise);

  // Timeseries: Sichtbarkeit wird in renderTimeseries() basierend auf Punktanzahl gesetzt

  // Footer/meta
  $("last-update").textContent = "Quelle: " + fmtTime(data.sourceTimestamp);
  $("src-url").textContent = data.sourceUrl || "—";

  // Mock-Modus visuell kennzeichnen
  if (data.cache === "mock" || data.mock) {
    document.body.classList.add("mock-mode");
    let banner = document.getElementById("mock-banner");
    if (!banner) {
      banner = document.createElement("div");
      banner.id = "mock-banner";
      banner.className = "mock-banner";
      document.body.insertBefore(banner, document.body.firstChild);
    }
    const m = data.mock || {};
    banner.textContent =
      `🧪 SIMULATION — ausgezählt: ${m.ausgezaehlt}/7 · Swing: ${m.swingPp >= 0 ? "+" : ""}${m.swingPp}pp · Rauschen: ±${m.noisePp}pp`;
  } else {
    document.body.classList.remove("mock-mode");
    document.getElementById("mock-banner")?.remove();
  }
}

function renderKiBar(hr) {
  // X-Achse: 40%-60%, also 20pp Spannweite
  const X_MIN = 0.4;
  const X_MAX = 0.6;
  const range = X_MAX - X_MIN;
  const pct = (v) => Math.max(0, Math.min(100, ((v - X_MIN) / range) * 100));
  const lo95 = pct(hr.anteilBoppLower);
  const hi95 = pct(hr.anteilBoppUpper);
  const lo99 = pct(hr.anteilBoppLower99 ?? hr.anteilBoppLower);
  const hi99 = pct(hr.anteilBoppUpper99 ?? hr.anteilBoppUpper);
  const point = pct(hr.anteilBopp);

  $("hr-ki-band-95").style.left = lo95 + "%";
  $("hr-ki-band-95").style.width = Math.max(0.5, hi95 - lo95) + "%";
  $("hr-ki-band-99").style.left = lo99 + "%";
  $("hr-ki-band-99").style.width = Math.max(0.5, hi99 - lo99) + "%";
  $("hr-ki-point").style.left = `calc(${point}% - 1.5px)`;
}

function renderKreise(kreise) {
  const grid = $("stadtkreise-grid");
  grid.innerHTML = "";
  for (const k of kreise || []) {
    const div = document.createElement("div");
    div.className = "kreis";
    const status = k.ausgezaehlt
      ? `<span class="kreis-status ausgezaehlt">ausgezählt</span>`
      : `<span class="kreis-status">offen</span>`;
    let body = "";
    if (k.ausgezaehlt && k.anteilBopp != null) {
      const totalK = (k.stimmenBopp ?? 0) + (k.stimmenFritschi ?? 0);
      const bbW = totalK > 0 ? (k.stimmenBopp / totalK) * 100 : 0;
      const bfW = totalK > 0 ? (k.stimmenFritschi / totalK) * 100 : 0;
      const swingHtml = signedDiffHtml(k.swing, "pp");
      const betDiffHtml = signedDiffHtml(
        k.beteiligungDiff != null ? k.beteiligungDiff / 100 : null, "pp",
      );
      body = `
        <div class="kreis-anteil">${fmtPct(k.anteilBopp)}</div>
        <div class="kreis-bar">
          <div class="bb" style="width:${bbW}%"></div>
          <div class="bf" style="width:${bfW}%"></div>
        </div>
        <div class="kreis-meta">
          <span>${fmtNum(k.stimmenBopp)} : ${fmtNum(k.stimmenFritschi)}</span>
          <span>Swing ${swingHtml}</span>
        </div>
        <div class="kreis-meta">
          <span>1. WG: ${fmtPct(k.baselineAnteilBopp)}</span>
          <span>Bet: ${k.beteiligung != null ? k.beteiligung.toFixed(1) + " %" : "—"} ${betDiffHtml}</span>
        </div>
      `;
    } else if (k.geschaetzt && k.geschaetzterAnteilBopp != null) {
      // Offen, aber mit Schätzwerten
      const totalKEst = k.geschaetzteStimmenBopp + k.geschaetzteStimmenFritschi;
      const bbW = totalKEst > 0 ? (k.geschaetzteStimmenBopp / totalKEst) * 100 : 0;
      const bfW = totalKEst > 0 ? (k.geschaetzteStimmenFritschi / totalKEst) * 100 : 0;
      const swingHtml = signedDiffHtml(k.geschaetzterSwing, "pp");
      const betDiffHtml = signedDiffHtml(
        k.geschaetzteBeteiligungDiff != null ? k.geschaetzteBeteiligungDiff / 100 : null, "pp",
      );
      body = `
        <div class="kreis-anteil estimate">
          ~${fmtPct(k.geschaetzterAnteilBopp)}
          <span class="estimate-tag">geschätzt</span>
        </div>
        <div class="kreis-bar estimate-bar">
          <div class="bb" style="width:${bbW}%"></div>
          <div class="bf" style="width:${bfW}%"></div>
        </div>
        <div class="kreis-meta">
          <span>~${fmtNum(k.geschaetzteStimmenBopp)} : ${fmtNum(k.geschaetzteStimmenFritschi)}</span>
          <span>~Swing ${swingHtml}</span>
        </div>
        <div class="kreis-meta">
          <span>1. WG: ${fmtPct(k.baselineAnteilBopp)}</span>
          <span>~Bet ${k.geschaetzteBeteiligung != null ? k.geschaetzteBeteiligung.toFixed(1) + " %" : "—"} ${betDiffHtml}</span>
        </div>
      `;
    } else {
      body = `
        <div class="kreis-anteil" style="color:var(--text-muted);font-size:1rem">noch offen</div>
        <div class="kreis-meta">
          <span>1. WG Bopp: ${fmtPct(k.baselineAnteilBopp)}</span>
          <span>WB: ${fmtNum(k.baselineWahlberechtigte)}</span>
        </div>
      `;
    }
    div.innerHTML = `
      <div class="kreis-head">
        <span>${k.name}</span>
        ${status}
      </div>
      ${body}
    `;
    grid.appendChild(div);
  }
}

function renderTimeseries(points) {
  const svg = $("ts-svg");
  svg.innerHTML = "";
  const tsCard = document.getElementById("ts-card");
  if (points.length < 2) {
    if (tsCard) tsCard.hidden = true;
    return;
  }
  if (tsCard) tsCard.hidden = false;
  const W = 600,
    H = 200,
    pad = { l: 40, r: 10, t: 10, b: 24 };

  const xs = points.map((p) => p.ts);
  const minX = xs[0],
    maxX = xs[xs.length - 1];
  const xRange = Math.max(1, maxX - minX);

  // y range: 0.40-0.60, mit Auto-Erweiterung wenn Daten ausserhalb
  let yMin = 0.4,
    yMax = 0.6;
  for (const p of points) {
    for (const v of [p.anteilBopp, p.anteilBoppLower, p.anteilBoppUpper, p.anteilBoppLower99, p.anteilBoppUpper99, p.aktuellAnteilBopp]) {
      if (v == null) continue;
      if (v < yMin) yMin = v - 0.02;
      if (v > yMax) yMax = v + 0.02;
    }
  }
  yMin = Math.max(0, Math.min(yMin, 0.4));
  yMax = Math.min(1, Math.max(yMax, 0.6));

  const px = (t) => pad.l + ((t - minX) / xRange) * (W - pad.l - pad.r);
  const py = (v) => pad.t + (1 - (v - yMin) / (yMax - yMin)) * (H - pad.t - pad.b);

  // 50%-Linie
  const y50 = py(0.5);
  const line50 = svgEl("line", {
    x1: pad.l, x2: W - pad.r, y1: y50, y2: y50,
    stroke: "currentColor", "stroke-dasharray": "3 3", "stroke-opacity": "0.4",
  });
  svg.appendChild(line50);

  // Y-Achsen-Beschriftung
  for (const v of [yMin, 0.5, yMax]) {
    const t = svgEl("text", {
      x: 4, y: py(v) + 4, "font-size": "10", fill: "currentColor", "fill-opacity": "0.6",
    });
    t.textContent = (v * 100).toFixed(0) + "%";
    svg.appendChild(t);
  }

  // Konfidenzbänder (zuerst 99%-Band, darüber 95%-Band, dann Punktschätzung)
  const filtered = points.filter((p) => p.anteilBopp != null);
  if (filtered.length >= 2) {
    function bandPath(loKey, hiKey) {
      let dUp = "", dLo = "";
      filtered.forEach((p, i) => {
        const x = px(p.ts);
        dUp += (i === 0 ? "M" : "L") + x + " " + py(p[hiKey] ?? p.anteilBopp);
      });
      [...filtered].reverse().forEach((p) => {
        const x = px(p.ts);
        dLo += "L" + x + " " + py(p[loKey] ?? p.anteilBopp);
      });
      return dUp + dLo + "Z";
    }
    // 99%-Band (heller)
    const has99 = filtered.some((p) => p.anteilBoppLower99 != null);
    if (has99) {
      const band99 = svgEl("path", {
        d: bandPath("anteilBoppLower99", "anteilBoppUpper99"),
        fill: "#fbbf24",
        "fill-opacity": "0.18",
        stroke: "none",
      });
      svg.appendChild(band99);
    }
    // 95%-Band (kräftiger)
    const band95 = svgEl("path", {
      d: bandPath("anteilBoppLower", "anteilBoppUpper"),
      fill: "#fbbf24",
      "fill-opacity": "0.45",
      stroke: "none",
    });
    svg.appendChild(band95);

    // Punktschätzung
    let dP = "";
    filtered.forEach((p, i) => {
      dP += (i === 0 ? "M" : "L") + px(p.ts) + " " + py(p.anteilBopp);
    });
    const lineP = svgEl("path", {
      d: dP,
      stroke: "var(--bopp)",
      "stroke-width": "2.5",
      fill: "none",
    });
    svg.appendChild(lineP);
  }

  // Aktueller Stand (bekannte Stimmen)
  const filteredCur = points.filter((p) => p.aktuellAnteilBopp != null);
  if (filteredCur.length >= 2) {
    let dC = "";
    filteredCur.forEach((p, i) => {
      dC += (i === 0 ? "M" : "L") + px(p.ts) + " " + py(p.aktuellAnteilBopp);
    });
    const lineC = svgEl("path", {
      d: dC,
      stroke: "var(--accent)",
      "stroke-width": "1.5",
      "stroke-dasharray": "4 3",
      fill: "none",
    });
    svg.appendChild(lineC);
  }
}

function svgEl(tag, attrs) {
  const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

function startCountdown() {
  if (state.countdownTimer) clearInterval(state.countdownTimer);
  state.countdownTimer = setInterval(() => {
    if (!state.lastFetchAt) {
      $("countdown").textContent = "—";
      return;
    }
    const left = Math.max(
      0,
      Math.ceil((state.lastFetchAt + POLL_INTERVAL - Date.now()) / 1000),
    );
    $("countdown").textContent = left;
  }, 500);
}

function startPolling() {
  if (state.pollTimer) clearInterval(state.pollTimer);
  if (state.tsTimer) clearInterval(state.tsTimer);
  state.pollTimer = setInterval(fetchResults, POLL_INTERVAL);
  state.tsTimer = setInterval(fetchTimeseries, TS_INTERVAL);
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    fetchResults();
    fetchTimeseries();
    startPolling();
  } else {
    if (state.pollTimer) clearInterval(state.pollTimer);
    if (state.tsTimer) clearInterval(state.tsTimer);
  }
});

// Initial
fetchResults();
fetchTimeseries();
startCountdown();
startPolling();
