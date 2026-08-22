# TAC-GRID

A web tool for tactical analysis of a mapped site from 360° panorama tours.
Upload a Pano2VR tour, place its nodes on a real map, measure walking routes
along real paths, and get an AI scene readout of what's around each point.

> **Sensitive-data note.** This tool is built around imagery and layout of a
> real site. This repository is a **PRIVATE transfer repo** and intentionally
> includes the site data (imagery, coordinates, tactical analysis, personnel
> records) so it runs as-is after cloning. **Keep it private — never make it
> public.** Only regenerable caches and credentials are excluded (see
> `.gitignore`); the server re-seeds default logins on first run.

## What it does

- **Tours** — upload a `.ggpkg` Pano2VR package; it's extracted, sanitised
  (raw source files stripped, a duplicate-player bug auto-fixed) and served.
- **Site map** — place each panorama node at its real lat/lon on an
  OpenStreetMap view (paste coordinates from Google Maps, decimal or DMS).
- **Routing** — real walking distance & turn-by-turn between any two placed
  points, via the Valhalla routing engine (OpenStreetMap paths).
- **Offline** — map tiles and routes can be pre-cached so the map works with
  no connection.
- **Scene analysis (AI)** — per-node object/scene understanding shown live in
  the 3D viewer, following the direction you look. Two engines exist:
  - **YOLOv8 (OpenCV DNN, CPU)** — general objects (people, furniture,
    vehicles), no external calls. See `detector.py` / `sceneDetect.js`.
  - **Vision-language model** — a tactical prose readout (doors, windows,
    huts, nallahs, cover, blind spots, routes). See `vlmAnalyze.js`. Runs
    **locally through Ollama by default**, so imagery never leaves the
    machine; cloud backends are opt-in via an API key.

## Running

Requires Node.js and Python 3 with `opencv-python`, `numpy`, `pillow`.

```
npm install
# optional env:
#   TACGRID_PYTHON        path to python.exe (for detection)
#   TACGRID_VLM_BACKEND   ollama | anthropic | openai | google | openrouter
#   TACGRID_OLLAMA_MODEL  defaults to qwen2.5vl:7b
#   OLLAMA_HOST             defaults to http://127.0.0.1:11434
#   ANTHROPIC_API_KEY       switches the VLM to the cloud instead
#   TACGRID_VLM_MODEL     Anthropic model, defaults to claude-sonnet-5
npm start                   # http://localhost:3000
```

### Scene analysis backend

With no API key present the VLM runs **locally on Ollama** — nothing is sent
off the machine. Setup:

```
ollama pull qwen2.5vl:7b
```

Ollama must be running (`ollama serve`). Cube faces are analysed **one at a
time** so a 7B vision model fits in ~8 GB of VRAM — do not parallelise this;
the model already occupies 6.7 GB and a concurrent request spills to system
RAM and runs slower. Expect ~28 s per node on a laptop GPU. Results are cached
in `vlmdata.json`, so each node is paid for once.

By default only the `front,right,back,left` faces are analysed: "up" is sky and
"down" is the tripod patch, so they cost a third of the runtime for no useful
output. Override with `TACGRID_VLM_FACES`.

`TACGRID_VLM_NUM_CTX` (default 8192) sets the context window. **Do not lower
it below ~6000.** A 1024px cube face is ~1800 tokens by itself, and on overflow
Ollama returns HTTP 200 with an empty body rather than an error — which caches a
blank analysis and looks like a bad model instead of a bad setting. The code now
raises an explicit error if the model returns nothing.

Set `TACGRID_VLM_BACKEND=ollama` to force local even when a cloud key is
configured.

To pre-analyse a whole structure (resumable — skips what is already done):

```
node analyzeAll.js "CTW" "Main Gate"           # ~50 min for 108 nodes
node analyzeAll.js "CTW" "Main Gate" --limit 5 # try a few first
```

Analysis is far too slow to run live in a demo — pre-analyse, then it is
instant from cache. See `BRIEFING.md` for presenting this to a senior audience.

Default logins are seeded on first run (`admin` / `user`); **change them**:

```
node setPassword.js admin <new-password>
```

The YOLO model isn't committed (see `.gitignore`); fetch `yolov8n.onnx` into
`models/` to enable YOLO detection.

## Layout

`server.js` is the Express app. Supporting modules:
`auth.js`, `panoParser.js`, `positionEstimator.js`, `tourCache.js`,
`escapeRoutes.js`, `geoDistance.js`, `geoStore.js`, `namedLocations.js`,
`nodeSheet.js`, `patchTour.js`, `valhalla.js`, `tileCache.js`,
`sceneDetect.js` + `detector.py`, `vlmAnalyze.js` + `stitch_faces.py`.
Frontend is in `public/`. See `CONTEXT.md` for the full picture and history.
