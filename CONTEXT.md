# TAC-GRID — Project Context & Handoff

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
   direction. Shown live in the 3D viewer via `public/tacgrid-scene.js`,
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

- ~~**Local VLM on a GPU laptop (planned).**~~ **Done (2026-08-11).** Running on
  the target box (RTX 5060 Laptop 8 GB, 32 GB RAM, driver 581.80) with
  **Qwen2.5-VL 7B via Ollama**. `vlmAnalyze.js` is now backend-switchable via
  `TACGRID_VLM_BACKEND`; with no cloud key configured Ollama is the default,
  so imagery never leaves the machine. The six faces are sent **one per
  request** (`callOllama`) because a 7B vision model cannot hold six 1024px
  images in one context on 8 GB — the per-direction JSON is assembled
  server-side and a final text-only call writes the `overall` summary.
  `TACGRID_OLLAMA_MODEL` names the local model (kept separate from
  `TACGRID_VLM_MODEL`, which still names the Anthropic model).
  **Measured**: ~28 s/node (4 faces, warm model), 44 s for all six, 58 s cold.
  Local models follow the requested JSON shape only loosely — `overall` came
  back as `{description: "..."}` and `routes` as `{label, note}` — so
  `asText()`/`normalizeDirection()` coerce every field to the shape the viewer
  renders. Without that, a returned object silently threw and the summary fell
  back to concatenated per-direction text.
- **Prompt rewrite (the "none obvious" fix).** The first prompt ended each
  tactical field with `- or 'none obvious'` and asked for blind spots as "areas
  hidden from this viewpoint". The model answered "none obvious" for **97%** of
  fields (2 substantive of 66) while the hand-seeded node56 and the 26B cloud
  run both scored 67%. Two causes: an explicit opt-out is the cheapest token
  path, and *negative* inference ("what is NOT visible") is weak in a 7B model.
  Fix: remove every opt-out, and phrase each field as "name the objects
  that…" — blind spots became "every solid object hides the ground behind it,
  list them", turning an inference task into an object-listing one. All fields
  now populate. Cost: ~27 s → ~67 s per node, because it actually writes
  content now.
- **`num_ctx` must be 8192.** A 1024px face is ~1800 tokens; the richer prompt
  overflowed Ollama's 4096 default, and **overflow returns HTTP 200 with an
  empty body, no error and no token counts** — which silently cached blank
  analyses. `ollamaChat` now throws on an empty reply so this can never be
  silent again.
- **Empty replies in a batch: Ollama wedges under sustained load.** Two wrong
  guesses first, both recorded so they are not repeated. (1) *Context overflow*
  — disproved: a controlled test gave 0 empties at ctx 8192/pred 900, the exact
  "failing" settings, and 0 at 16384/2000, with replies of 400–604 tokens.
  (2) *GPU contention* — disproved: a clean run with nothing competing still
  failed 33/46. The actual signature is a state change, not randomness: 13 OK
  then **29 consecutive failures to the end of the run**, with a restart curing
  it instantly (4/4 immediately after, browser still open). `analyzeAll.js` now
  reloads the model automatically after two consecutive failures via
  `vlmAnalyze.resetModel()` (`keep_alive: 0`, the official unload API — no
  process killing) and retries the node.
- **A failing face used to kill the whole node.** Only the JSON parse was
  guarded, not the request, so one bad face threw out of `callOllama` and lost
  the other three — turning a ~20% per-face failure into 58% node failure via
  1−(1−p)⁴. Now each face is guarded independently and partial nodes record
  `incompleteViews` / `viewErrors`.
- **`analyzeAll.js` (new).** Batch pre-analysis for a whole structure,
  resumable (skips cached nodes), sequential by design. ~2 h for 108 nodes at
  the current prompt. `--force` deliberately will **not** overwrite an analysis
  produced by a different model, so node56 (hand-written) and node12 (cloud)
  survive a local re-run; `--force-all` overrides that.
  Analysis is too slow to run live, so a demo must run off warm cache.
- **`BRIEFING.md` (new).** Plan for presenting this to a senior Army officer:
  demo arc, pre-brief checklist, anticipated questions, efficiency numbers, and
  what not to claim.
- **Anthropic path still unexercised.** Written to spec but never run; it needs
  `ANTHROPIC_API_KEY`. The local Ollama path is the one now verified.
- **Dashboard "Analyze scene" button** — trigger VLM analysis per node from the
  Explore modal (endpoint exists: `POST /api/tours/:p/:f/analysis/:nodeId`).
- **Direction calibration** — the viewer panel maps pan-quadrant to face; if it
  reads rotated 90°, adjust the cf→pan offset in `tacgrid-scene.js`.
- **Doors/windows as boxes** — if box overlays (not prose) are wanted, an
  open-vocab detector (YOLO-World) is the route.

---

## 8. Running & gotchas

See `README.md`. Notes:
- Python path is set per-machine via `TACGRID_PYTHON` (in `.claude/launch.json`
  for this box). Detection/stitching need `opencv-python`, `numpy`, `pillow`.
- `.claude/launch.json` now uses bare `node`/`python` off PATH rather than
  absolute per-user paths, so it survives moving between machines.
- On the current box Node is a **portable zip install** at
  `%LOCALAPPDATA%\Programs\nodejs` (added to the user PATH) — there is no
  MSI/winget entry, so "Node isn't installed" checks that look at Programs and
  Features will come up empty. Python is the miniconda one on PATH.
- Ollama must be running for scene analysis (`ollama serve`); the model is
  `qwen2.5vl:7b`. A node takes minutes, not seconds, so the analysis route
  clears its socket timeout and logs progress per face as `[vlm]`.
- Tour viewer HTML is regenerated on every upload — anything needed in it
  (the scene panel script, the duplicate-player fix) is re-applied by
  `patchTour.js`, never hand-edited.
- API endpoints are under `/api/tours/:project/:folder/...`; all require a
  session, writes require admin.
