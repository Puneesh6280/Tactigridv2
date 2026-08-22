// Turn-by-turn walking directions from Valhalla (FOSSGIS public instance),
// the same engine openstreetmap.org uses for its Directions panel.
//
// This complements - it does not replace - the hotspot-graph routing:
//   * Valhalla follows real mapped paths and gives turn-by-turn instructions,
//     but only knows what OpenStreetMap contains (outdoor ways, no indoor).
//   * The hotspot graph knows every walkable link inside the tour, including
//     indoor ones, because it was built by walking the site.
// Both are offered so a route can be cross-checked against the other.
//
// PRIVACY: every request sends real coordinates to a third-party server.
// For a sensitive site that is a disclosure of layout. Point VALHALLA_URL at
// a self-hosted instance to keep queries in-house.

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const VALHALLA_URL = process.env.VALHALLA_URL || "https://valhalla1.openstreetmap.de/route";
const USER_AGENT = "TAC-GRID/0.1 (self-hosted site-survey tool)";
const CACHE_DIR = path.join(__dirname, "routecache");
const MIN_INTERVAL_MS = 600; // be a polite client of a free public service

let lastCall = 0;

// Valhalla encodes shapes with the Google polyline algorithm at precision 6.
function decodePolyline(str, precision = 6) {
  const factor = 10 ** precision;
  const coords = [];
  let index = 0;
  let lat = 0;
  let lon = 0;

  while (index < str.length) {
    let result = 0;
    let shift = 0;
    let byte;
    do {
      byte = str.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;

    result = 0;
    shift = 0;
    do {
      byte = str.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lon += result & 1 ? ~(result >> 1) : result >> 1;

    coords.push([lat / factor, lon / factor]);
  }
  return coords;
}

// Coordinates are rounded to ~1 m before hashing so tiny differences in a
// click still reuse a cached route rather than hitting the network again.
function cacheKey(from, to, costing) {
  const r = (n) => n.toFixed(5);
  const raw = `${r(from.lat)},${r(from.lon)}|${r(to.lat)},${r(to.lon)}|${costing}`;
  return crypto.createHash("sha1").update(raw).digest("hex");
}

function readCache(key) {
  const file = path.join(CACHE_DIR, `${key}.json`);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function writeCache(key, value) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(path.join(CACHE_DIR, `${key}.json`), JSON.stringify(value));
}

async function route(from, to, costing = "pedestrian") {
  const key = cacheKey(from, to, costing);

  // Served from disk when available, so a route walked once keeps working
  // with no connection - and repeat queries cost the public service nothing.
  const cached = readCache(key);
  if (cached) return { ...cached, cached: true };

  const wait = MIN_INTERVAL_MS - (Date.now() - lastCall);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCall = Date.now();

  const body = {
    locations: [
      { lat: from.lat, lon: from.lon },
      { lat: to.lat, lon: to.lon }
    ],
    costing,
    directions_options: { units: "kilometers" }
  };

  const res = await fetch(`${VALHALLA_URL}?json=${encodeURIComponent(JSON.stringify(body))}`, {
    headers: { "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(15000)
  });

  if (!res.ok) {
    throw new Error(`Routing service returned ${res.status}.`);
  }

  const data = await res.json();
  if (!data.trip || !data.trip.legs || !data.trip.legs.length) {
    throw new Error("No walking route found between those points.");
  }

  const leg = data.trip.legs[0];
  const result = {
    metres: Math.round(data.trip.summary.length * 1000),
    seconds: Math.round(data.trip.summary.time),
    shape: decodePolyline(leg.shape),
    steps: leg.maneuvers.map((m) => ({
      instruction: m.instruction,
      metres: Math.round((m.length || 0) * 1000),
      seconds: Math.round(m.time || 0),
      type: m.type
    }))
  };

  writeCache(key, result);
  return { ...result, cached: false };
}

function cacheStats() {
  if (!fs.existsSync(CACHE_DIR)) return { routes: 0 };
  return { routes: fs.readdirSync(CACHE_DIR).filter((f) => f.endsWith(".json")).length };
}

// Cached routes are keyed by coordinates, so when a node moves its old routes
// can never be served again - they just sit orphaned on disk. Wiping the
// cache keeps it clean; "Save map for offline" repopulates it on demand.
function clearRouteCache() {
  if (!fs.existsSync(CACHE_DIR)) return 0;
  const files = fs.readdirSync(CACHE_DIR).filter((f) => f.endsWith(".json"));
  for (const f of files) fs.rmSync(path.join(CACHE_DIR, f), { force: true });
  return files.length;
}

module.exports = { route, decodePolyline, cacheStats, clearRouteCache, VALHALLA_URL };
