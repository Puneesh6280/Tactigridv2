# Tactigrid — Project Context & Handoff

Context for anyone (or a future session) picking this up. Covers what exists,
why decisions were made, and what's pending. Last updated 2026-07-22.

---

## 1. What this is

A Node/Express + browser app that turns a **Pano2VR 360° tour** of a site into
a tactical analysis tool. The working dataset is **project "CTW", structure
"Main Gate"** — a cadet training wing, 108 panorama nodes.

The original goal: view a room/area and have AI identify doors, windows, blind
spots, escape routes, hiding spots. That split into two kinds of work — exact
geometry/routing (deterministic) and scene understanding (AI).

---

## 2. Data model & storage (all sidecar files, git-ignored)

A tour is `uploads/<project>/<structure>/` (extracted Pano2VR). Everything the
app adds lives OUTSIDE that folder, keyed by `project/folder/nodeId`, so a
**re-upload (which replaces the tour folder) never destroys added work**:

- `personnel.json` — structure records (sno, name, location, project, folder).
- `geodata.json` — real lat/lon per node + admin annotation pins.
- `scenedata.json` — cached YOLO detections per node.
- `vlmdata.json` — cached VLM tactical analysis per node (**real site intel**).
- `users.json` — accounts with scrypt password hashes.
- `tilecache/`, valhalla route cache — offline map/route caches.
- `models/yolov8n.onnx` — detection model (fetched separately).

All of the above are `.gitignore`d.

---

## 3. Pipeline (what was built, in order)

1. **Parse** (`panoParser.js`) — reads `pano.xml` into nodes, the hotspot
   connectivity graph (282 edges), POIs, and floorplan refs. Node IDs are
   stable across exports (important — sidecar data keys off them).
2. **Position estimate** (`positionEstimator.js`) — only 6/108 nodes had real
   floorplan coords, so SMACOF stress-majorisation estimated the rest from
   hop-counts. This was the *original* positioning; superseded by real GPS
   coords for routing, but still used for the floorplan-percent scale.
3. **Cache** (`tourCache.js`) — parse+estimate is ~200 ms; cached in memory,
   invalidated by `pano.xml` mtime. Was a per-request cost before.
4. **Routing** — `escapeRoutes.js` (multi-source Dijkstra on the hotspot
   graph). Later, real routing via `valhalla.js` (FOSSGIS Valhalla, real OSM
   paths) once nodes had GPS coords. `geoDistance.js` does haversine along the
   graph as a fallback.
5. **Named locations** (`namedLocations.js`) — extracts human place names from
   info-hotspots. Note: several names share one node (node26 = Motivation Hall
   / T-55 Tank / Technodrome; node56 = Main Gate / Sentry Post), which drove a
   few UI bugs — locations are keyed by index, not nodeId, in the frontend.
6. **Geo** (`geoStore.js`, `geoDistance.js`) — real coordinates + pins, the
   basis for metre-accurate routing.
7. **Offline** (`tileCache.js`) — server proxies OSM tiles to disk; a
   "Save map for offline" also pre-caches all routes between placed nodes.
8. **Scene detection** — YOLOv8 via OpenCV DNN on the six cube faces
   (`detector.py`, `sceneDetect.js`). Cube faces are undistorted 90° views, so
   a normal detector works with no panorama warping. COCO classes only.
9. **VLM tactical analysis** — `stitch_faces.py` stitches faces to base64,
   `vlmAnalyze.js` sends them to a vision model with a tactical prompt, per
   direction. Shown live in the 3D viewer via `public/tactigrid-scene.js`,
   injected into every tour by `patchTour.js`.

---

## 4. Key decisions (and why)

- **Kept Dijkstra/hotspot-graph over generic routing initially** — the 282
  hotspot links were created by walking the site, so they're ground truth for
  connectivity. Later added Valhalla for real-path *distances* once GPS coords
  existed. The graph says what connects; coords say how far.
- **Valhalla, not the graph, for final routing** — OSM actually has the campus
  paths (verified), so Valhalla gives real turn-by-turn metres. (Earlier
  assumption that OSM wouldn't have a closed campus was wrong.)
- **Floorplan view removed** — the Pano2VR floorplan is a schematic rotated
  252° from north and not to scale, so it could never align with OSM. With
  real coords, OSM is the single map.
- **Coordinates entered by pasting, not map-clicking** — accepts Google Maps
  decimal or DMS (`parseCoords` in `public/script.js`).
- **Scene analysis on cube faces, not equirectangular** — avoids pole/seam
  distortion; each face also maps to a direction (front/right/back/left/up/down).
- **VLM over fixed-class detection for the tactical readout** — doors, windows,
  huts, nallahs, signage are not COCO classes; scene *understanding* catches
  them. Validated by direct inspection of the real faces.

---

## 5. Security / correctness work already done

A full audit fixed 19 issues (see `BUGS.md`), including: real session auth
(scrypt + cookies, admin vs operator), removing hardcoded/plaintext passwords,
blocking raw `.ggpkg`/`.p2vr`/stray files from the public `uploads/` mount,
making re-upload actually replace (it used to silently no-op), per-structure
delete, upload validation, and caching. Two automated suites (API + flow) plus
browser testing back these.

---

## 6. Current data state (CTW / Main Gate)

- 11 of 108 nodes have real GPS coordinates (the named locations). Routing in
  metres works between placed nodes.
- Remaining ~14 junction nodes (node15, node85, node59, node60, node100,
  node90, node24, node109, node80, node69, node68, node118, node81, node101)
  would connect all named locations for graph-distance if placed — but with
  Valhalla you only need the two endpoints placed, so surveying more *named*
  places is higher value than junctions.
- node56 (Main Gate) has a full seeded VLM tactical analysis (real analysis of
  the actual imagery), visible in the 3D viewer.

---

## 7. Pending / next steps

- **Local VLM on a GPU laptop (planned).** Target: RTX 5060 8 GB, 32 GB RAM.
  Plan: run **Qwen2.5-VL 7B (4-bit) via Ollama**, process the 6 faces one at a
  time (~15–25 s/node). Make `vlmAnalyze.js` backend env-switchable
  (`TACTIGRID_VLM_BACKEND=ollama` vs `anthropic`) — a contained ~30-line change,
  not yet written. Motivation: privacy (imagery never leaves the machine) for a
  defence site. Needs recent CUDA 12.x drivers for the new Blackwell GPU.
- **Live VLM call not yet exercised.** The Anthropic path is written to spec but
  needs `ANTHROPIC_API_KEY` to run; only the seeded node56 analysis exists.
- **Dashboard "Analyze scene" button** — trigger VLM analysis per node from the
  Explore modal (endpoint exists: `POST /api/tours/:p/:f/analysis/:nodeId`).
- **Direction calibration** — the viewer panel maps pan-quadrant to face; if it
  reads rotated 90°, adjust the cf→pan offset in `tactigrid-scene.js`.
- **Doors/windows as boxes** — if box overlays (not prose) are wanted, an
  open-vocab detector (YOLO-World) is the route.

---

## 8. Running & gotchas

See `README.md`. Notes:
- Python path is set per-machine via `TACTIGRID_PYTHON` (in `.claude/launch.json`
  for this box). Detection/stitching need `opencv-python`, `numpy`, `pillow`.
- The server was launched here via a bundled Node binary; `npm start` is the
  normal entry.
- Tour viewer HTML is regenerated on every upload — anything needed in it
  (the scene panel script, the duplicate-player fix) is re-applied by
  `patchTour.js`, never hand-edited.
- API endpoints are under `/api/tours/:project/:folder/...`; all require a
  session, writes require admin.
