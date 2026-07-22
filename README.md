# Tactigrid

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
    huts, nallahs, cover, blind spots, routes). See `vlmAnalyze.js`.

## Running

Requires Node.js and Python 3 with `opencv-python`, `numpy`, `pillow`.

```
npm install
# optional env:
#   TACTIGRID_PYTHON        path to python.exe (for detection)
#   ANTHROPIC_API_KEY       enables the VLM tactical analysis
#   TACTIGRID_VLM_MODEL     defaults to claude-sonnet-5
npm start                   # http://localhost:3000
```

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
