// Pre-cache everything the app fetches from the internet, so it runs fully
// offline afterwards.
//
// Two external dependencies exist at runtime and both cache to disk:
//   * OpenStreetMap raster tiles  -> tilecache/
//   * Valhalla walking routes     -> routecache/
// Once both are warm the app never needs a connection. Run this before any
// demo or field use:
//
//   node precacheOffline.js "CTW" "Main Gate"
//
// Safe to re-run: already-cached tiles and routes are skipped.

const path = require("path");
const tileCache = require("./tileCache");
const valhalla = require("./valhalla");
const geoStore = require("./geoStore");
const { getTourAnalysis } = require("./tourCache");

const uploadsRoot = path.join(__dirname, "uploads");
const project = process.argv[2];
const folder = process.argv[3];

if (!project || !folder) {
    console.error('Usage: node precacheOffline.js <project> <folder>');
    process.exit(1);
}
if (!getTourAnalysis(uploadsRoot, project, folder)) {
    console.error(`Structure not found: ${project}/${folder}`);
    process.exit(1);
}

const geo = geoStore.getGeo(project, folder);
const ids = Object.keys(geo.nodes);
if (!ids.length) {
    console.error("No nodes are placed on the map yet - nothing to cache.");
    process.exit(1);
}

// Bounding box of every placed node and pin, padded so panning around during a
// demo stays inside cached territory.
const lats = ids.map((i) => geo.nodes[i].lat).concat(geo.pins.map((p) => p.lat));
const lons = ids.map((i) => geo.nodes[i].lon).concat(geo.pins.map((p) => p.lon));
const PAD = 0.0025; // ~275 m
const bounds = {
    north: Math.max(...lats) + PAD,
    south: Math.min(...lats) - PAD,
    east: Math.max(...lons) + PAD,
    west: Math.min(...lons) - PAD
};

const MIN_Z = Number(process.env.TACGRID_PRECACHE_MIN_ZOOM) || 14;
const MAX_Z = Number(process.env.TACGRID_PRECACHE_MAX_ZOOM) || 19;

(async () => {
    console.log(`Structure : ${project}/${folder}`);
    console.log(`Placed    : ${ids.length} node(s), ${geo.pins.length} pin(s)`);
    console.log(`Bounds    : N${bounds.north.toFixed(5)} S${bounds.south.toFixed(5)} E${bounds.east.toFixed(5)} W${bounds.west.toFixed(5)}`);

    const planned = tileCache.countPrefetch(bounds, MIN_Z, MAX_Z);
    console.log(`\n[1/2] Map tiles, zoom ${MIN_Z}-${MAX_Z}: ${planned} tile(s) to consider`);
    if (planned > tileCache.MAX_TILES_PER_PREFETCH) {
        console.log(`      Too many for one pass (limit ${tileCache.MAX_TILES_PER_PREFETCH}); lower TACGRID_PRECACHE_MAX_ZOOM.`);
    } else {
        let lastLogged = 0;
        const tiles = await tileCache.prefetchArea(bounds, MIN_Z, MAX_Z, (p) => {
            const done = p.downloaded + p.alreadyCached + p.failed;
            if (done - lastLogged >= 25 || done === p.total) {
                lastLogged = done;
                console.log(`      ${done}/${p.total} (new ${p.downloaded}, cached ${p.alreadyCached}, failed ${p.failed})`);
            }
        });
        console.log(`      Done: ${tiles.downloaded} downloaded, ${tiles.alreadyCached} already cached, ${tiles.failed} failed`);
    }

    // Every ordered pair, because a route is cached per direction and the demo
    // may ask for either.
    const pairs = ids.length * (ids.length - 1);
    console.log(`\n[2/2] Walking routes between placed nodes: ${pairs} pair(s)`);
    let cached = 0, failed = 0, fromDisk = 0;
    for (const a of ids) {
        for (const b of ids) {
            if (a === b) continue;
            try {
                const r = await valhalla.route(geo.nodes[a], geo.nodes[b], "pedestrian");
                if (r.cached) fromDisk++; else cached++;
            } catch {
                failed++;
            }
        }
        console.log(`      from ${a}: ok`);
    }
    console.log(`      Done: ${cached} newly cached, ${fromDisk} already cached, ${failed} failed`);

    const t = tileCache.cacheStats();
    const v = valhalla.cacheStats();
    console.log(`\nOFFLINE READY`);
    console.log(`  tiles : ${t.tiles} (${(t.bytes / 1048576).toFixed(1)} MB)`);
    console.log(`  routes: ${v.routes}`);
    if (failed) console.log(`  WARNING: ${failed} route(s) failed - re-run when connected.`);
})().catch((e) => {
    console.error("Pre-cache failed:", e.message);
    process.exit(1);
});
