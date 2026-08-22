// Disk-backed OpenStreetMap tile cache.
//
// Two jobs:
//   1. Proxy tile requests through the server so every tile the app has ever
//      shown is kept on disk and still renders with no internet connection.
//   2. Pre-fetch a chosen area so a site can be taken offline deliberately
//      rather than hoping the right tiles were viewed earlier.
//
// OSM's tile usage policy forbids bulk downloading and asks for a genuine
// identifying User-Agent, so requests are serialised with a delay and each
// pre-fetch is capped. This is fine for one campus at close zoom; it is not a
// way to mirror a region.

const fs = require("fs");
const path = require("path");

const TILE_ROOT = path.join(__dirname, "tilecache");
const USER_AGENT = "TAC-GRID/0.1 (self-hosted site-survey tool)";
const FETCH_DELAY_MS = 550; // stay well under OSM's rate expectations
const MAX_TILES_PER_PREFETCH = 1500;

const tilePath = (z, x, y) => path.join(TILE_ROOT, String(z), String(x), `${y}.png`);

function isCached(z, x, y) {
  return fs.existsSync(tilePath(z, x, y));
}

function readTile(z, x, y) {
  return fs.readFileSync(tilePath(z, x, y));
}

function writeTile(z, x, y, buffer) {
  const file = tilePath(z, x, y);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, buffer);
}

function validTile(z, x, y) {
  if (![z, x, y].every(Number.isInteger)) return false;
  if (z < 0 || z > 19) return false;
  const max = 2 ** z;
  return x >= 0 && x < max && y >= 0 && y < max;
}

async function fetchTile(z, x, y) {
  const res = await fetch(`https://tile.openstreetmap.org/${z}/${x}/${y}.png`, {
    headers: { "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(10000)
  });
  if (!res.ok) throw new Error(`Tile server returned ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  writeTile(z, x, y, buf);
  return buf;
}

// Serves from disk when possible; only reaches out to OSM on a miss, so a
// cached area keeps working with no connection at all.
async function getTile(z, x, y) {
  if (!validTile(z, x, y)) throw new Error("Invalid tile coordinates.");
  if (isCached(z, x, y)) return { buffer: readTile(z, x, y), cached: true };
  const buffer = await fetchTile(z, x, y);
  return { buffer, cached: false };
}

const lonToX = (lon, z) => Math.floor(((lon + 180) / 360) * 2 ** z);
const latToY = (lat, z) => {
  const rad = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * 2 ** z);
};

function tileRange(bounds, z) {
  const x1 = lonToX(bounds.west, z);
  const x2 = lonToX(bounds.east, z);
  const y1 = latToY(bounds.north, z);
  const y2 = latToY(bounds.south, z);
  return {
    xMin: Math.min(x1, x2), xMax: Math.max(x1, x2),
    yMin: Math.min(y1, y2), yMax: Math.max(y1, y2)
  };
}

// Counts without allocating. A wide area at high zoom runs to hundreds of
// millions of tiles, so building the list first would exhaust memory before
// any limit check could reject it.
function countPrefetch(bounds, minZoom, maxZoom) {
  let total = 0;
  for (let z = minZoom; z <= maxZoom; z++) {
    const r = tileRange(bounds, z);
    total += (r.xMax - r.xMin + 1) * (r.yMax - r.yMin + 1);
    if (total > Number.MAX_SAFE_INTEGER) return Infinity;
  }
  return total;
}

function planPrefetch(bounds, minZoom, maxZoom) {
  // Refuse to materialise a list that could never be downloaded anyway.
  if (countPrefetch(bounds, minZoom, maxZoom) > MAX_TILES_PER_PREFETCH) return null;

  const tiles = [];
  for (let z = minZoom; z <= maxZoom; z++) {
    const r = tileRange(bounds, z);
    for (let x = r.xMin; x <= r.xMax; x++) {
      for (let y = r.yMin; y <= r.yMax; y++) {
        if (validTile(z, x, y)) tiles.push({ z, x, y });
      }
    }
  }
  return tiles;
}

async function prefetchArea(bounds, minZoom, maxZoom, onProgress) {
  const needed = countPrefetch(bounds, minZoom, maxZoom);
  if (needed > MAX_TILES_PER_PREFETCH) {
    throw new Error(
      `That area needs ${needed.toLocaleString()} tiles (limit ${MAX_TILES_PER_PREFETCH.toLocaleString()}). ` +
      `Zoom in, or lower the maximum detail level.`
    );
  }
  const tiles = planPrefetch(bounds, minZoom, maxZoom) || [];

  let downloaded = 0;
  let alreadyCached = 0;
  let failed = 0;

  for (const t of tiles) {
    if (isCached(t.z, t.x, t.y)) {
      alreadyCached++;
      continue;
    }
    try {
      await fetchTile(t.z, t.x, t.y);
      downloaded++;
    } catch {
      failed++;
    }
    // Deliberate pacing - see the policy note at the top of this file.
    await new Promise((r) => setTimeout(r, FETCH_DELAY_MS));
    if (onProgress) onProgress({ downloaded, alreadyCached, failed, total: tiles.length });
  }

  return { total: tiles.length, downloaded, alreadyCached, failed };
}

function cacheStats() {
  if (!fs.existsSync(TILE_ROOT)) return { tiles: 0, bytes: 0 };
  let tiles = 0;
  let bytes = 0;
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".png")) {
        tiles++;
        bytes += fs.statSync(full).size;
      }
    }
  };
  walk(TILE_ROOT);
  return { tiles, bytes };
}

function clearCache() {
  if (fs.existsSync(TILE_ROOT)) fs.rmSync(TILE_ROOT, { recursive: true, force: true });
}

module.exports = { getTile, prefetchArea, planPrefetch, countPrefetch, cacheStats, clearCache, MAX_TILES_PER_PREFETCH };
