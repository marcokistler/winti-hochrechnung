# Hochrechnung Stadtpräsidium Winterthur — 2. Wahlgang

Live-Dashboard für den 2. Wahlgang der Stadtpräsidiumswahl Winterthur am 10.05.2026 (Bopp SP vs. Fritschi FDP). Holt alle 30 s die offiziellen Echtzeitdaten vom Kanton Zürich (openZH Datensatz 734) und rechnet auf Basis der 1.-Wahlgang-Daten pro Stadtkreis hoch.

## Architektur

```
Browser ──30 s──▶ /api/results (Netlify Function) ──▶ Netlify Blobs (20 s Cache)
                                                  └─▶ openZH JSON (Kanton Zürich)
```

- **Frontend** (`public/`): statische HTML/CSS/JS, kein Build-Step. Mobile-first, responsiv.
- **API** (`netlify/functions/`):
  - `results.mjs` — orchestriert Cache → Resolve → Fetch → Hochrechnung → Persist.
  - `timeseries.mjs` — gibt persistierte Zeitreihe zurück.
  - `warm.mjs` — scheduled (`* * * * *`), warmt Cache auch ohne Frontend-Last.
- **Library** (`netlify/lib/`):
  - `source.mjs` — CKAN-Resource-Auflösung + JSON-Parsing.
  - `projection.mjs` — Stadtkreis-Swing-Hochrechnung (pure, getestet).
  - `baseline.mjs` — 1.-WG-Daten laden + cachen.
  - `store.mjs` — Netlify-Blobs-Wrapper mit In-Memory-Fallback.

## Hochrechnungs-Methodik

Stadtkreis-Swing-Modell:

1. Pro ausgezähltem Stadtkreis: Swing zum 1. Wahlgang (`p2 − p1`).
2. Gewichteter Mittel-Swing über alle ausgezählten Kreise.
3. Für jeden noch offenen Kreis: erwarteter Bopp-Anteil = `p1 + s_avg`, erwartete Stimmenzahl aus Wahlberechtigten × extrapolierter Beteiligung.
4. Punktschätzung = (bekannte Bopp-Stimmen + geschätzte Bopp-Stimmen) / (bekannte + geschätzte gültige Stimmen).
5. 95 %-Konfidenzintervall via gewichtete Standardabweichung der Swings, skaliert mit Anteil noch nicht ausgezählter Stimmen. Fallback ±2.5 pp bei nur einem ausgezählten Kreis.
6. Siegwahrscheinlichkeit Bopp = 1 − Φ((0.5 − p̂) / SE).

Sonderfälle (0 / 1 / alle ausgezählt) werden explizit behandelt.

## Datenquellen

- 1. Wahlgang (Baseline): `https://ogd-static.voteinfo-app.ch/v4/ogd/kommunale_resultate_2026_03_08.json` — Vorlage `325174` ("Erneuerungswahl des Stadtpräsidiums").
- 2. Wahlgang (live): `https://ogd-static.voteinfo-app.ch/v4/ogd/kommunale_resultate_2026_05_10.json` — Vorlage `537145` ("Zweiter Wahlgang …").

URLs werden zur Laufzeit über die opendata.swiss-CKAN-API aufgelöst, mit den oben genannten Werten als Fallback. Die kombinierte Stadtrats-/Stadtpräsidiums-Vorlage `325173` wird im Filter explizit ausgeschlossen, sonst werden die falschen Stimmenzahlen geladen.

## Lokal ausführen

```bash
npm install

# Unit-Tests (Hochrechnungs-Mathematik)
npm test

# End-to-End-Test gegen die echten Daten
node test/integration.mjs

# Lokal entwickeln
npm install -g netlify-cli
netlify dev
# → http://localhost:8888
```

## Deploy zu Netlify

```bash
# Erstmaliger Deploy:
netlify init        # Site verknüpfen / erstellen
netlify deploy --prod
```

Die Scheduled Function (`warm.mjs`) und Blobs werden automatisch konfiguriert. Falls Blobs nicht gewünscht: der `store.mjs`-Wrapper fällt auf In-Memory zurück, dann gehen Cache und Zeitreihe pro Function-Cold-Start verloren — funktioniert aber.

## Endpunkte

- `GET /api/results` — aktuelle Resultate + Hochrechnung. Cache 20 s.
- `GET /api/timeseries` — Verlaufs-Punkte (1 Punkt pro Min).
- `GET /api/results?force=1` — Cache umgehen, Refetch erzwingen.

## Disclaimer

Inoffizielle Hochrechnung. Konfidenzintervall ist eine konservative Approximation. Bei stark unterschiedlichen Swings zwischen Stadtkreisen oder grossen Beteiligungs-Verschiebungen kann die Punktschätzung zu Beginn der Auszählung deutlich vom Endresultat abweichen — das Intervall sollte das aber abdecken.
