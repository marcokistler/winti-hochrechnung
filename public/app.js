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
const fmtTime = (ts) => {
  if (!ts) return "—";
  const d = typeof ts === "number" ? new Date(ts) : new Date(ts);
  return d.toLocaleTimeString("de-CH", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
};

async function fetchResults() {
  try {
    const res = await fetch("/api/results", { cache: "no-store" });
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
    } else {
      $("hr-interval").textContent =
        `95 %-KI: ${fmtPct(hr.anteilBoppLower)} – ${fmtPct(hr.anteilBoppUpper)}`;
    }
    if (p.pSiegBopp == null) {
      $("hr-psieg").textContent = "—";
    } else {
      $("hr-psieg").textContent = (p.pSiegBopp * 100).toFixed(0) + " %";
    }
  } else {
    $("hr-anteil").textContent = "—";
    $("hr-interval").textContent = "—";
    $("hr-psieg").textContent = "—";
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

  // Timeseries lazy-show
  $("ts-card").hidden = (p.status === "warten");

  // Footer/meta
  $("last-update").textContent = "Quelle: " + fmtTime(data.sourceTimestamp);
  $("src-url").textContent = data.sourceUrl || "—";
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
      const swingHtml =
        k.swing != null
          ? `<span class="${k.swing >= 0 ? "swing-up" : "swing-down"}">${fmtSignedPP(k.swing)}</span>`
          : "—";
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
          <span>Beteiligung: ${k.beteiligung != null ? k.beteiligung.toFixed(1) + " %" : "—"}</span>
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
  if (points.length < 2) return;
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
    for (const v of [p.anteilBopp, p.anteilBoppLower, p.anteilBoppUpper, p.aktuellAnteilBopp]) {
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

  // Konfidenzband
  const filtered = points.filter((p) => p.anteilBopp != null);
  if (filtered.length >= 2) {
    let dUp = "", dLo = "";
    filtered.forEach((p, i) => {
      const x = px(p.ts);
      dUp += (i === 0 ? "M" : "L") + x + " " + py(p.anteilBoppUpper ?? p.anteilBopp);
      dLo += (i === 0 ? "L" : "L") + x + " " + py(p.anteilBoppLower ?? p.anteilBopp);
    });
    // Reverse lower
    let dLoRev = "";
    [...filtered].reverse().forEach((p, i) => {
      const x = px(p.ts);
      dLoRev += "L" + x + " " + py(p.anteilBoppLower ?? p.anteilBopp);
    });
    const band = svgEl("path", {
      d: dUp + dLoRev + "Z",
      fill: "var(--bopp)",
      "fill-opacity": "0.15",
      stroke: "none",
    });
    svg.appendChild(band);

    // Punktschätzung
    let dP = "";
    filtered.forEach((p, i) => {
      dP += (i === 0 ? "M" : "L") + px(p.ts) + " " + py(p.anteilBopp);
    });
    const lineP = svgEl("path", {
      d: dP,
      stroke: "var(--bopp)",
      "stroke-width": "2",
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
