# TAC-GRID — Runbook

How to start it, and where every demonstrable feature lives. Written to be
followed literally, in order.

---

## 1. Start it

Two things must be running: **Ollama** (only for *generating* new scene
analysis — cached analysis displays without it) and the **TAC-GRID server**.

```
ollama serve
```

Then, in a second terminal:

```
cd C:\tactigrid\Tactigridv2
node server.js
```

Expect exactly one line: `Server running at http://localhost:3000`.

Open **http://localhost:3000** and sign in.

| Field | Value |
|---|---|
| Username | `admin` |
| Password | `admin123` — **change this before any demo** |

```
node setPassword.js admin <new-password>
```

**Notes for this machine.** Node is a portable install at
`%LOCALAPPDATA%\Programs\nodejs` and is already on your PATH — there is no
entry in Add/Remove Programs, so don't be alarmed if you go looking. If `node`
is ever not found, run:

```
$env:Path += ";$env:LOCALAPPDATA\Programs\nodejs"
```

---

## 2. Where each feature is

**Read this first — the dashboard looks emptier than it is.** After login you
see stat tiles, an upload box, one project card with an **EXPLORE** button, and
**REACTION ANALYSIS →** in the top bar. That is only two doors, and almost
everything lives behind the first one:

```
Login
 └─ Command Deck ─────────── stat tiles, upload, project card
     ├─ TOP BAR: REACTION ANALYSIS →   ... incident response planning
     └─ EXPLORE (on the CTW card)      ... opens the working panel:
         ├─ structure picker + RENAME / RE-UPLOAD / DELETE
         ├─ the site MAP with all placed positions
         ├─ FROM / TO + FIND ROUTE     ... walking distance + turn-by-turn
         ├─ SET LOCATION COORDS        ... place a position by pasting lat/lon
         ├─ ADD CUSTOM PIN             ... note / hazard / asset marker
         ├─ SAVE MAP FOR OFFLINE       ... cache tiles + routes
         └─ OPEN TOUR →                ... the 360° viewer, which itself has:
             ├─ drag to look, click hotspots to walk
             ├─ drawing tools (bottom left)
             └─ TACTICAL SCENE panel (right) - the AI readout
```

If you remember one thing: **EXPLORE is the door to the map and the tour;
the top-bar link is the door to reaction analysis.**

### A. Command Deck — the landing page
`http://localhost:3000/admin_dashboard.html` (you land here after login)

- Live counts: projects, structures, **108 nodes mapped**, named locations.
- The **CTW** card, with an **EXPLORE** button.
- Upload panel for adding another Pano2VR tour (`.ggpkg`).

### B. Site map + route measurement — the credibility demo
Click **EXPLORE** on the CTW card, then choose **Main Gate**.

- The OpenStreetMap view shows the site with placed nodes.
- **FROM / TO** dropdowns → **FIND ROUTE**.
  Returns **real walking distance in metres and turn-by-turn directions**,
  following actual paths — not a straight line.
  Known-good example: **Main Gate → Rear Gate = 402 m**.
- **SET LOCATION COORDS** — paste coordinates from Google Maps (decimal or
  DMS) to place a node.
- **ADD CUSTOM PIN** — note / hazard / asset markers.
- **SAVE MAP FOR OFFLINE** — caches tiles and routes (see §4).

### C. The 360° tour viewer — the emotional demo
In the Explore panel, pick a starting location and click **OPEN TOUR →**.

- Full Pano2VR 360° viewer: drag to look, scroll to zoom, click hotspots to
  walk between positions.
- **Drawing tools** (bottom left): rectangle, circle, arrow shapes over the
  panorama for briefing.
- **TACTICAL SCENE panel** (right): the AI readout for wherever you are, with
  tabs for **front / right / back / left**. It follows your view direction as
  you pan. Shows structures and their doors/openings, cover, concealment,
  hidden ground, approach routes and hazards.

> **Important, and the one thing not to get wrong in front of an audience:**
> the Main Gate (node56) readout is **hand-written**, not model output, and it
> is the best content in the system. Do not present it as what the AI produced.
> See `BRIEFING.md` §6a.

### D. Reaction analysis — the standout feature
**Click "REACTION ANALYSIS →" in the top bar** (green, top right, on every
dashboard). Direct URL: `http://localhost:3000/tactical.html`

This is the answer to "how is this different from Google Maps" (see §3).

- Pick an **incident position** and a **pace** (walk / brisk / double time).
- Get every surveyed position ranked by **real walking time along the site's
  own paths**, grouped into reaction bands: ≤30 s, ≤1 min, ≤2 min, beyond.
- The map draws each route colour-coded by band. Click any row to fly to it.
- **SITE STATUS** panel: how much of the site is surveyed, analysed, and how
  many positions report hidden ground or hazards.

Worked example — incident at the **Main Gate**, walking pace:

| Position | Distance | Reaction |
|---|---|---|
| Eklavya Mess | 32 m | 24 s |
| Charlie Block | 75 m | 56 s |
| Central Anteroom | 95 m | 1m 10s |
| Wing Office | 131 m | 1m 37s |
| Kote | 250 m | 3m 05s |
| Rear Gate | 402 m | 4m 58s |

The finding states itself: the Rear Gate cannot reinforce the Main Gate inside
five minutes at walking pace. Switch to **DOUBLE** and watch the bands change —
that is a siting decision being made on evidence.

### E. Object detection
In the Explore panel, choose a starting location and click
**DETECT OBJECTS AT THIS POSITION** (under OPEN TOUR). Results appear inline,
broken down by direction. If a position has been detected before, the result
loads automatically when you select it — no need to press the button.

Runs YOLOv8 on the CPU, entirely locally. **Main Gate is the one to demo**:
2 people, a car, a bench, 2 potted plants. A fresh detection takes a few
seconds.

Frame it honestly as a *narrower, different* capability from the scene readout:
it recognises about 80 everyday object types and nothing more. Charlie Block
correctly returns **no objects** — a building exterior with no people or
vehicles in shot — and the panel says so rather than showing a blank.

---

## 3. "How is this different from Google Maps?"

Answer it head-on — it will be asked, and a weak answer is worse than none.

**Concede what is true.** For a public street, Google does this better. It has
Street View, walking directions and vastly better imagery. Pretending otherwise
loses the room.

**Then give the four things it cannot do:**

1. **It does not have the inside of your camp.** No Street View car has driven
   this site and none will. The imagery here is 108 surveyed positions of
   ground that simply does not exist in any public dataset.

2. **It cannot work disconnected.** Google Maps without a connection is a blank
   grid. This runs air-gapped — tiles, routes, imagery and AI analysis all
   served from the machine. Demonstrate it: switch on flight mode and keep going.

3. **It cannot answer a tactical question.** Google answers "how do I get from
   A to B". It has no concept of cover, concealment, hidden ground, or an
   approach route. The scene panel does.

4. **It cannot do reaction analysis at all — this is the sharpest one.** Google
   is point-to-point navigation. It cannot answer *"an incident just happened
   here — who can reach it, in what order, and how long does each take?"* That
   question is the whole of response planning, and §2D answers it in one click
   for the site's own paths.

The one-line version: **Google Maps tells you how to get somewhere. This tells
you who can get there in time, on ground Google has never seen, with no
connection.**

**And the honest limit**, which you should volunteer: 11 of 108 positions carry
real coordinates. Routing between surveyed positions is metre-accurate; covering
the whole cantonment is a surveying effort, not a software one.

---

## 4. Making it work with no connection

Only two things ever touch the internet, and both cache to disk permanently:
map tiles and walking routes. Warm them once and the app is self-contained.

```
node precacheOffline.js "CTW" "Main Gate"
```

This caches every map tile over the site (zoom 14–19, padded ~275 m) and every
walking route between placed positions. Safe to re-run; it skips what it
already has. There is also a **SAVE MAP FOR OFFLINE** button in the map panel
that does the same job for the current view.

**Everything else is already local**: the panorama imagery, Leaflet, the fonts
(self-hosted in `public/vendor/fonts/`), the AI model in Ollama, and all cached
analysis. The frontend has **zero external URLs** — verified by grep across
every HTML, JS and CSS file.

**Already verified by request capture.** Loading the login page, Command Deck
and reaction page produced **zero requests to any external host** — everything
went to `localhost:3000` or a `data:` URI, with tiles served 200 from disk
cache and the self-hosted fonts loading locally. Nothing is *asked for* off the
machine.

*Caveat:* tiles cover the site plus ~275 m. Panning well outside that would try
to reach OSM. Widen the bounds in `precacheOffline.js` and re-run if you need
more.

**Still worth doing once yourself:** flight mode, hard-reload (`Ctrl+Shift+R`),
and walk the whole demo, so you have seen it with your own eyes before the room
does.

---

## 5. Pre-demo checklist

- [ ] `node setPassword.js admin <new-password>` — do not demo `admin123`.
- [ ] `node precacheOffline.js "CTW" "Main Gate"` — offline safety net.
- [ ] `node analyzeAll.js "CTW" "Main Gate"` — pre-analyse every node
      (~30 min/40 nodes). Analysis takes ~1 minute per node, so it must never
      be run live in front of an audience.
- [ ] Warm the model: open one node's scene panel so Ollama loads it into the
      GPU (`ollama ps` should list `qwen2.5vl:7b`).
- [ ] Full dry run on battery, in flight mode.
- [ ] Browser zoom 125–150%, notifications off, other windows closed.
- [ ] Read `BRIEFING.md` — especially §6a, on what this does *not* do.

---

## 6. If something breaks

| Symptom | Cause and fix |
|---|---|
| `node` not recognised | `$env:Path += ";$env:LOCALAPPDATA\Programs\nodejs"` |
| `EADDRINUSE :::3000` | A server is already running. That's fine — use it, or stop it in Task Manager. |
| Map tiles grey/blank | Area not cached and no connection. Run `precacheOffline.js` while connected. |
| Scene panel empty on a node | That node hasn't been analysed. Run `analyzeAll.js`. |
| "Cannot reach Ollama" | `ollama serve` isn't running. Cached analyses still display. |
| "Model returned nothing", repeatedly | Ollama wedges under sustained batch load and then fails every node until the model is reloaded. `analyzeAll.js` now detects this and reloads automatically. If it happens outside a batch, restart `ollama serve`. Measured: it is **not** context size and **not** GPU contention — both were tested and ruled out. |
| Route says "no route found" | One endpoint isn't placed on the map yet. |
