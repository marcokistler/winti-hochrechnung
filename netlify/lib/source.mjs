// Auflösung der Resource-URLs via opendata.swiss CKAN-API
// und Fetch + Parsing der Kanton-ZH Echtzeitdaten (Datensatz 734).

const CKAN_URL =
  "https://ckan.opendata.swiss/api/3/action/package_show?id=echtzeitdaten-am-abstimmungstag-des-kantons-zurich-kommunale-und-regionale-vorlagen";

// Bekannte Fallback-URLs (aus CKAN am 09.05.2026 verifiziert).
// Wenn die Live-Auflösung fehlschlägt, greifen diese.
const FALLBACK_URLS = {
  "2026-03-08":
    "https://ogd-static.voteinfo-app.ch/v4/ogd/kommunale_resultate_2026_03_08.json",
  "2026-05-10":
    "https://ogd-static.voteinfo-app.ch/v4/ogd/kommunale_resultate_2026_05_10.json",
};

const UA = "winti-hochrechnung/1.0 (+https://github.com/)";

/**
 * Findet die Download-URL des kommunalen Datensatzes für ein bestimmtes Wahldatum.
 * Format Datum: "YYYY-MM-DD".
 * Heuristik: Resource-Name enthält "DD.MM.YYYY" und "Abstimmungen und Majorzwahlen".
 */
export async function resolveResourceUrl(date) {
  try {
    const res = await fetch(CKAN_URL, {
      headers: { "User-Agent": UA, Accept: "application/json" },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`CKAN ${res.status}`);
    const data = await res.json();
    const resources = data?.result?.resources || [];
    const [y, m, d] = date.split("-");
    const dotted = `${d}.${m}.${y}`;
    const candidates = resources.filter((r) => {
      const name = (r.name?.de || r.title?.de || "") + " " + (r.url || "");
      return (
        name.includes(dotted) &&
        /Abstimmungen und Majorzwahlen|Majorzwahlen|kommunale_resultate/i.test(
          name,
        )
      );
    });
    // Bevorzuge URL die das Datum enthält
    const dashed = `${y}_${m}_${d}`;
    candidates.sort((a, b) => {
      const aMatch = (a.url || "").includes(dashed) ? 1 : 0;
      const bMatch = (b.url || "").includes(dashed) ? 1 : 0;
      return bMatch - aMatch;
    });
    if (candidates[0]?.url) return candidates[0].url;
  } catch (err) {
    console.warn("[source] CKAN-Auflösung fehlgeschlagen:", err.message);
  }
  if (FALLBACK_URLS[date]) return FALLBACK_URLS[date];
  throw new Error(`Keine Resource für ${date} gefunden.`);
}

/**
 * Holt das gesamte Tages-JSON.
 */
export async function fetchDayResults(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`Resource-Fetch ${res.status}`);
  return res.json();
}

/**
 * Findet die Stadtpräsidiums-Vorlage Winterthur in einem Tages-Dokument.
 * Wichtig: Ausschluss der kombinierten Stadtrats-/Stadtpräsidiums-Vorlage,
 * deren Titel "Stadtrats" enthält. Wir wollen nur die separate
 * Stadtpräsidiums-Wahl (1. WG) bzw. den 2. Wahlgang.
 */
function findStadtpraesidiumVorlage(dayJson) {
  const zh = (dayJson.kantone || []).find((k) => k.geoLevelname === "ZH");
  if (!zh) return null;
  return (zh.vorlagen || []).find((v) => {
    if (v.geoLevelname !== "Winterthur") return false;
    const title = (v.vorlagenTitel || []).map((t) => t.text || "").join(" ");
    if (!/Stadtpr[aä]sidium/i.test(title)) return false;
    // Schliesse die kombinierte Stadtrats-/Stadtpräsidiums-Vorlage aus
    if (/Stadtrats/i.test(title)) return false;
    return true;
  });
}

/**
 * Liefert die Kandidat-Mapping-Tabelle: kandidatNummer -> { name, vorname }
 * Greift auf vorlage.resultat.kandidaten zurück (dort sind nachname/vorname gefüllt).
 */
function buildCandidateLookup(vorlage) {
  const top = vorlage?.resultat?.kandidaten || [];
  const map = new Map();
  for (const k of top) {
    map.set(k.kandidatNummer, {
      kandidatNummer: k.kandidatNummer,
      nachname: k.nachname || "",
      vorname: k.vorname || "",
      partei:
        (k.partei || []).find((p) => p.langKey === "de")?.text || "",
      stimmenTotal: k.stimmen,
      stimmenProzent: k.stimmenProzent,
    });
  }
  return map;
}

/**
 * Identifiziert Bopp- und Fritschi-Kandidat-IDs (robust gegen UUID-Wechsel zwischen WG).
 */
function identifyCandidates(lookup) {
  let bopp = null,
    fritschi = null;
  for (const [, v] of lookup) {
    if (/Bopp/i.test(v.nachname)) bopp = v;
    else if (/Fritschi/i.test(v.nachname)) fritschi = v;
  }
  return { bopp, fritschi };
}

/**
 * Extrahiert ein normalisiertes Stadtpräsidiums-Resultat.
 *
 * Rückgabeform:
 * {
 *   abstimmtag, timestamp,
 *   vorlagenId, titel,
 *   gebietAusgezaehlt,
 *   candidates: { bopp: {kandidatNummer, nachname, partei}, fritschi: {...} },
 *   total: { wahlberechtigte, eingelegte, gueltig, beteiligung,
 *            stimmenBopp, stimmenFritschi, anteilBopp, anteilFritschi },
 *   stadtkreise: [
 *     { geoLevelnummer, name, ausgezaehlt,
 *       wahlberechtigte, eingelegte, gueltig, beteiligung,
 *       stimmenBopp, stimmenFritschi, anteilBopp }
 *   ]
 * }
 */
export function parseStadtpraesidium(dayJson) {
  const v = findStadtpraesidiumVorlage(dayJson);
  if (!v) {
    return null;
  }
  const lookup = buildCandidateLookup(v);
  const { bopp, fritschi } = identifyCandidates(lookup);
  if (!bopp || !fritschi) {
    return {
      abstimmtag: dayJson.abstimmtag,
      timestamp: dayJson.timestamp,
      vorlagenId: v.vorlagenId,
      titel: (v.vorlagenTitel || []).map((t) => t.text).join(" / "),
      gebietAusgezaehlt: !!v?.resultat?.gebietAusgezaehlt,
      candidates: { bopp: null, fritschi: null },
      total: null,
      stadtkreise: [],
      warning:
        "Bopp/Fritschi nicht in Vorlage erkannt — eventuell falsche Vorlage.",
    };
  }
  const r = v.resultat || {};
  const totalBopp = r.kandidaten?.find(
    (k) => k.kandidatNummer === bopp.kandidatNummer,
  )?.stimmen;
  const totalFritschi = r.kandidaten?.find(
    (k) => k.kandidatNummer === fritschi.kandidatNummer,
  )?.stimmen;
  const sumTwo = (totalBopp || 0) + (totalFritschi || 0);

  // Vereinzelte = 3. Kandidatenposition (sonstige handgeschriebene Namen).
  // Im 1. WG existiert sie als Eintrag ohne nachname-Mapping; im 2. WG explizit
  // als kandidatNummer "999" mit nachname="Vereinzelte". Wir suchen sie nach
  // beiden Mustern.
  const vereinzelte = [...lookup.values()].find(
    (k) => /Vereinzelte/i.test(k.nachname) || k.kandidatNummer === "999",
  );
  const vereinzelteId = vereinzelte?.kandidatNummer ?? null;

  const stadtkreise = (v.zaehlkreise || []).map((z) => {
    const zr = z.resultat || {};
    const cBopp = (zr.kandidaten || []).find(
      (k) => k.kandidatNummer === bopp.kandidatNummer,
    );
    const cFr = (zr.kandidaten || []).find(
      (k) => k.kandidatNummer === fritschi.kandidatNummer,
    );
    const cV = vereinzelteId
      ? (zr.kandidaten || []).find((k) => k.kandidatNummer === vereinzelteId)
      : null;
    const sb = cBopp?.stimmen ?? null;
    const sf = cFr?.stimmen ?? null;
    const sv = cV?.stimmen ?? null;
    const denom = sb != null && sf != null ? sb + sf : null;
    return {
      geoLevelnummer: z.geoLevelnummer,
      name: shortenStadtkreisName(z.geoLevelname),
      fullName: z.geoLevelname,
      ausgezaehlt: !!zr.gebietAusgezaehlt,
      wahlberechtigte: zr.anzahlWahlberechtigte ?? null,
      eingelegte: zr.eingelegteWahlzettel ?? null,
      gueltig: zr.gueltigeWahlzettel ?? null,
      ungueltige: zr.ungueltigeWahlzettel ?? null,
      leere: zr.leereWahlzettel ?? null,
      kandidatenStimmenTotal: zr.kandidatenStimmenTotal ?? null,
      beteiligung: zr.wahlbeteiligungInProzent ?? null,
      stimmenBopp: sb,
      stimmenFritschi: sf,
      stimmenVereinzelte: sv,
      anteilBopp: denom && denom > 0 ? sb / denom : null,
    };
  });

  return {
    abstimmtag: dayJson.abstimmtag,
    timestamp: dayJson.timestamp,
    vorlagenId: v.vorlagenId,
    titel: (v.vorlagenTitel || []).map((t) => t.text).join(" / "),
    gebietAusgezaehlt: !!r.gebietAusgezaehlt,
    candidates: {
      bopp: {
        kandidatNummer: bopp.kandidatNummer,
        nachname: bopp.nachname,
        vorname: bopp.vorname,
        partei: bopp.partei,
      },
      fritschi: {
        kandidatNummer: fritschi.kandidatNummer,
        nachname: fritschi.nachname,
        vorname: fritschi.vorname,
        partei: fritschi.partei,
      },
    },
    total: {
      wahlberechtigte: r.anzahlWahlberechtigte ?? null,
      eingelegte: r.eingelegteWahlzettel ?? null,
      gueltig: r.gueltigeWahlzettel ?? null,
      ungueltige: r.ungueltigeWahlzettel ?? null,
      leere: r.leereWahlzettel ?? null,
      kandidatenStimmenTotal: r.kandidatenStimmenTotal ?? null,
      beteiligung: r.wahlbeteiligungInProzent ?? null,
      stimmenBopp: totalBopp ?? null,
      stimmenFritschi: totalFritschi ?? null,
      stimmenVereinzelte:
        vereinzelteId
          ? r.kandidaten?.find((k) => k.kandidatNummer === vereinzelteId)
              ?.stimmen ?? null
          : null,
      anteilBopp: sumTwo > 0 ? (totalBopp || 0) / sumTwo : null,
      anteilFritschi: sumTwo > 0 ? (totalFritschi || 0) / sumTwo : null,
    },
    stadtkreise,
  };
}

function shortenStadtkreisName(name) {
  return (name || "").replace(/^Winterthur\s+/i, "");
}
