// Lokaler Dev-Server. Kein netlify-cli nötig.
// Startet auf http://localhost:8888
//   /                 -> public/index.html
//   /style.css, /app.js -> public/
//   /api/results      -> netlify/functions/results.mjs (handler)
//   /api/timeseries   -> netlify/functions/timeseries.mjs (handler)

import http from "node:http";
import fs from "node:fs/promises";
import { watch } from "node:fs";
import path from "node:path";
import { handler as resultsHandler } from "../netlify/functions/results.mjs";
import { handler as timeseriesHandler } from "../netlify/functions/timeseries.mjs";
import { handler as simulateTimeseriesHandler } from "../netlify/functions/simulate-timeseries.mjs";

const PORT = process.env.PORT ? Number(process.env.PORT) : 8888;
const ROOT = path.resolve("public");

// --- Live-Reload via SSE ----------------------------------------------------
const sseClients = new Set();
function sseBroadcast(event, data = "") {
  const payload = `event: ${event}\ndata: ${data}\n\n`;
  for (const c of sseClients) {
    try {
      c.write(payload);
    } catch {
      sseClients.delete(c);
    }
  }
}

// Watcher für public/ — bei Änderung Browser-Reload triggern
let lastReload = 0;
watch(ROOT, { recursive: true }, (_evt, filename) => {
  const now = Date.now();
  if (now - lastReload < 100) return; // debounce
  lastReload = now;
  console.log(`[reload] ${filename} changed → browser reload`);
  sseBroadcast("reload", filename || "");
});

// Snippet, das in HTML-Responses injiziert wird:
const LIVERELOAD_SNIPPET = `
<script>
(() => {
  let connectedOnce = false;
  function connect() {
    const es = new EventSource("/__livereload");
    es.addEventListener("hello", () => {
      if (connectedOnce) location.reload();
      connectedOnce = true;
    });
    es.addEventListener("reload", () => location.reload());
    es.onerror = () => { es.close(); setTimeout(connect, 500); };
  }
  connect();
})();
</script>`;
// ----------------------------------------------------------------------------

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
};

async function serveStatic(req, res) {
  let urlPath = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (urlPath === "/") urlPath = "/index.html";
  const filePath = path.join(ROOT, urlPath);
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    return res.end("Forbidden");
  }
  try {
    let data = await fs.readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    // Live-Reload-Snippet in HTML einfügen (vor </body>)
    if (ext === ".html") {
      const html = data.toString("utf8").replace(/<\/body>/i, LIVERELOAD_SNIPPET + "</body>");
      data = Buffer.from(html, "utf8");
    }
    res.writeHead(200, {
      "content-type": MIME[ext] || "application/octet-stream",
      "cache-control": "no-store",
    });
    res.end(data);
  } catch {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("Not found: " + urlPath);
  }
}

function buildEvent(req, body) {
  const u = new URL(req.url, "http://x");
  const queryStringParameters = Object.fromEntries(u.searchParams.entries());
  return {
    httpMethod: req.method,
    path: u.pathname,
    headers: req.headers,
    queryStringParameters,
    body,
  };
}

async function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

async function callHandler(handler, req, res) {
  try {
    const body = req.method === "GET" || req.method === "HEAD" ? null : await readBody(req);
    const event = buildEvent(req, body);
    const result = await handler(event, {});
    res.writeHead(result.statusCode || 200, result.headers || {});
    res.end(result.body || "");
  } catch (err) {
    console.error("[handler]", err);
    res.writeHead(500, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: String(err?.message || err) }));
  }
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://x");
  if (u.pathname === "/__livereload") {
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-store",
      connection: "keep-alive",
    });
    res.write("event: hello\ndata: ok\n\n");
    sseClients.add(res);
    req.on("close", () => sseClients.delete(res));
    return;
  }
  if (u.pathname === "/api/results") return callHandler(resultsHandler, req, res);
  if (u.pathname === "/api/timeseries") return callHandler(timeseriesHandler, req, res);
  if (u.pathname === "/api/simulate-timeseries") return callHandler(simulateTimeseriesHandler, req, res);
  return serveStatic(req, res);
});

server.listen(PORT, () => {
  console.log(`\n🟢 Local dev server: http://localhost:${PORT}`);
  console.log(`   Frontend:  http://localhost:${PORT}/`);
  console.log(`   API:       http://localhost:${PORT}/api/results`);
  console.log(`   Timeseries: http://localhost:${PORT}/api/timeseries`);
  console.log(`\n   Auto-Reload aktiv:`);
  console.log(`   - public/* Änderungen → Browser lädt automatisch neu`);
  console.log(`   - netlify/*  Änderungen → Server-Restart (via 'node --watch')`);
  console.log(`\n   Hinweis: Netlify Blobs sind lokal nicht verfügbar — Cache und`);
  console.log(`   Zeitreihe leben im RAM (gehen verloren wenn Server stoppt).`);
  console.log(`   Ctrl+C zum Beenden.\n`);
});
