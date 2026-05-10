// In-Process-Integration: ruft results-Handler direkt auf,
// um zu prüfen, dass der gesamte Pfad (CKAN -> Fetch -> Parse -> Project -> Cache) läuft.
// Erfordert Internet-Zugang zu opendata.swiss und ogd-static.voteinfo-app.ch.

import { handler } from "../netlify/functions/results.mjs";

const event = { queryStringParameters: { force: "1" } };
const res = await handler(event);
const data = JSON.parse(res.body);

console.log("HTTP", res.statusCode);
console.log("sourceUrl:", data.sourceUrl);
console.log("sourceTimestamp:", data.sourceTimestamp);
console.log("titel:", data.titel);
console.log("baseline:", {
  abstimmtag: data.baseline?.abstimmtag,
  total: data.baseline?.total,
  anteilBopp: data.baseline?.anteilBopp,
});
console.log("projection.status:", data.projection?.status);
console.log("projection.aktuell:", data.projection?.aktuell);
console.log("projection.hochrechnung:", data.projection?.hochrechnung);
console.log("ausgezaehlt:", data.projection?.ausgezaehlteKreise, "/", 7);
console.log("stadtkreise (Anzahl):", data.projection?.stadtkreise?.length);

if (res.statusCode !== 200) {
  console.error("FAIL");
  process.exit(1);
}
if (data.projection?.stadtkreise?.length !== 7) {
  console.error("FAIL: erwartete 7 Stadtkreise");
  process.exit(1);
}
if (data.baseline?.total?.stimmenBopp !== 15843) {
  console.error("FAIL: Bopp 1.WG erwartet 15843, ist", data.baseline?.total?.stimmenBopp);
  process.exit(1);
}
if (data.baseline?.total?.stimmenFritschi !== 15172) {
  console.error("FAIL: Fritschi 1.WG erwartet 15172, ist", data.baseline?.total?.stimmenFritschi);
  process.exit(1);
}
console.log("\n✓ Integration ok");
