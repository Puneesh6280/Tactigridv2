const express = require("express");
const cors = require("cors");
const multer = require("multer");
const fs = require("fs");
const os = require("os");
const path = require("path");
const extract = require("extract-zip");
const { computeEscapeRoutes } = require("./escapeRoutes");
const { extractNamedLocations } = require("./namedLocations");
const { patchExtractedTour } = require("./patchTour");
const { getTourAnalysis, invalidateTour } = require("./tourCache");
const geoStore = require("./geoStore");
const { routeMetres, haversineMetres, coverage, reachFrom, PACE } = require("./geoDistance");
const { buildSheet, toCsv, parseSheet } = require("./nodeSheet");
const sceneDetect = require("./sceneDetect");
const vlmAnalyze = require("./vlmAnalyze");
const tileCache = require("./tileCache");
const valhalla = require("./valhalla");
const auth = require("./auth");

const app = express();
const PORT = 3000;
const MAX_UPLOAD_BYTES = 500 * 1024 * 1024; // 500 MB

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(auth.attachUser);

const personnelFilePath = path.join(__dirname, "personnel.json");
const uploadsRoot = path.join(__dirname, "uploads");

if (!fs.existsSync(uploadsRoot)) fs.mkdirSync(uploadsRoot);
if (!fs.existsSync(personnelFilePath)) fs.writeFileSync(personnelFilePath, "[]");

const readPersonnel = () => JSON.parse(fs.readFileSync(personnelFilePath, "utf8"));
const writePersonnel = (data) => fs.writeFileSync(personnelFilePath, JSON.stringify(data, null, 2));

// ---------------------------------------------------------------- static

// The dashboards must not render for signed-out visitors, so they are served
// explicitly behind requireAuth rather than by the static middleware below.
const protectedPages = ["/admin_dashboard.html", "/user_dashboard.html", "/tactical.html"];
protectedPages.forEach((page) => {
    app.get(page, auth.requireAuth, (req, res) => res.sendFile(path.join(__dirname, "public", page)));
});

// The tour viewer loads this panel script by a fixed URL; serve it with
// no-cache so panel updates aren't stuck behind the browser cache.
// The old name is kept as an alias: tours patched before the rename still
// carry <script src="/tactigrid-scene.js"> in their HTML, and a re-upload is
// not something to require just to rename the product.
app.get(["/tacgrid-scene.js", "/tactigrid-scene.js"], (req, res) => {
    res.set("Cache-Control", "no-cache");
    res.sendFile(path.join(__dirname, "public", "tacgrid-scene.js"));
});

app.use(express.static("public"));

// uploads/ is public so tours can load their own tiles/scripts, but it must
// not hand out raw survey packages, editable project files, or stray data
// files that happen to sit in the folder.
const BLOCKED_UPLOAD_FILES = /(\.(ggpkg|p2vr)$)|(^\/?personnel\.json$)/i;
app.use("/uploads", (req, res, next) => {
    if (BLOCKED_UPLOAD_FILES.test(req.path) || BLOCKED_UPLOAD_FILES.test(path.basename(req.path))) {
        return res.status(404).send("Not found");
    }
    next();
});
app.use("/uploads", auth.requireAuth, express.static(uploadsRoot));

// ------------------------------------------------------------------ auth

app.post("/login", (req, res) => {
    const { username, password, role } = req.body || {};
    const user = auth.authenticate(String(username || ""), String(password || ""));

    if (!user) {
        return res.status(401).json({ success: false, message: "Invalid credentials!" });
    }

    // The login screen's OPERATOR/ADMIN switch is a real constraint, not
    // decoration: signing in as the wrong role for the account is refused.
    if (role && role !== user.role) {
        return res.status(403).json({
            success: false,
            message: `That account is not ${role === "admin" ? "an admin" : "an operator"} account.`
        });
    }

    const token = auth.createSession(user);
    res.cookie(auth.SESSION_COOKIE, token, {
        httpOnly: true,
        sameSite: "strict",
        maxAge: auth.SESSION_TTL_MS
    });
    res.json({ success: true, role: user.role });
});

app.post("/logout", (req, res) => {
    if (req.user) auth.destroySession(req.user.token);
    res.clearCookie(auth.SESSION_COOKIE);
    res.json({ success: true });
});

app.get("/me", (req, res) => {
    if (!req.user) return res.status(401).json({ success: false });
    res.json({ success: true, username: req.user.username, role: req.user.role });
});

// ---------------------------------------------------------------- uploads

// Files land in the OS temp dir first and are only moved into uploads/ once
// every form field has been read and validated. Resolving the destination
// mid-stream from req.body would make the upload depend on field ordering.
const upload = multer({
    dest: path.join(os.tmpdir(), "TAC-GRID-uploads"),
    limits: { fileSize: MAX_UPLOAD_BYTES },
    fileFilter: (req, file, cb) => {
        if (!/\.ggpkg$/i.test(file.originalname)) {
            return cb(new Error("Only .ggpkg tour packages are accepted."));
        }
        cb(null, true);
    }
});

const safeUnlink = (p) => { try { fs.rmSync(p, { force: true }); } catch { /* already gone */ } };

// Extracts into a staging folder and only swaps it into place once the
// contents look like a real tour, so a bad package can never leave a
// half-written or invalid folder behind.
async function extractTour(tempFilePath, destPath) {
    const staging = `${destPath}.incoming-${Date.now()}`;
    try {
        await extract(tempFilePath, { dir: staging });

        if (!fs.existsSync(path.join(staging, "pano.xml"))) {
            throw new Error("That package does not contain a pano.xml - it is not a Pano2VR tour.");
        }

        patchExtractedTour(staging);

        if (fs.existsSync(destPath)) fs.rmSync(destPath, { recursive: true, force: true });
        fs.renameSync(staging, destPath);
    } finally {
        fs.rmSync(staging, { recursive: true, force: true });
        safeUnlink(tempFilePath);
    }
}

app.post("/upload", auth.requireAdmin, upload.single("file"), async (req, res) => {
    if (!req.file) return res.status(400).json({ success: false, message: "No file uploaded." });

    const project = path.basename(String(req.body.project || ""));
    if (!project) {
        safeUnlink(req.file.path);
        return res.status(400).json({ success: false, message: "Missing project name." });
    }

    const structureName = req.file.originalname.replace(/\.ggpkg$/i, "");
    const destPath = path.join(uploadsRoot, project, structureName);

    // Previously this silently skipped extraction and still reported success,
    // so re-uploading a scan appeared to work while leaving the old data.
    if (fs.existsSync(destPath)) {
        safeUnlink(req.file.path);
        return res.status(409).json({
            success: false,
            message: `"${structureName}" already exists in ${project}. Use Re-upload Scan to replace it.`
        });
    }

    const projectDir = path.join(uploadsRoot, project);
    try {
        fs.mkdirSync(projectDir, { recursive: true });
        await extractTour(req.file.path, destPath);
        invalidateTour(project, structureName);
        res.json({ success: true, project, folderName: structureName, url: `/uploads/${project}/${structureName}/index.html` });
    } catch (error) {
        // A rejected package must not leave an empty project folder behind,
        // or it shows up as a phantom project in the picker.
        try {
            if (fs.existsSync(projectDir) && fs.readdirSync(projectDir).length === 0) {
                fs.rmSync(projectDir, { recursive: true, force: true });
            }
        } catch { /* best effort */ }
        res.status(500).json({ success: false, message: error.message || "Extraction failed." });
    }
});

// Replaces the tour files for an existing structure, keeping its record,
// folder name and URLs intact.
app.post("/reupload", auth.requireAdmin, upload.single("file"), async (req, res) => {
    if (!req.file) return res.status(400).json({ success: false, message: "No file uploaded." });

    const project = path.basename(String(req.body.project || ""));
    const folderName = path.basename(String(req.body.folderName || ""));

    if (!project || !folderName) {
        safeUnlink(req.file.path);
        return res.status(400).json({ success: false, message: "Missing project or structure name." });
    }

    const destPath = path.join(uploadsRoot, project, folderName);
    if (!fs.existsSync(destPath)) {
        safeUnlink(req.file.path);
        return res.status(404).json({ success: false, message: "That structure does not exist." });
    }

    try {
        await extractTour(req.file.path, destPath);
        invalidateTour(project, folderName);
        // New imagery -> old detections no longer describe it.
        sceneDetect.clearTour(project, folderName);
        vlmAnalyze.clearTour(project, folderName);
        res.json({ success: true, project, folderName, url: `/uploads/${project}/${folderName}/index.html` });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message || "Re-upload failed." });
    }
});

// Surfaces multer's own failures (size limit, wrong extension) as clean JSON
// instead of an HTML stack trace.
app.use((err, req, res, next) => {
    if (!err) return next();
    if (req.file) safeUnlink(req.file.path);
    const tooBig = err.code === "LIMIT_FILE_SIZE";
    res.status(400).json({
        success: false,
        message: tooBig ? `File is too large (max ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB).` : err.message
    });
});

app.get("/projects", auth.requireAuth, (req, res) => {
    fs.readdir(uploadsRoot, { withFileTypes: true }, (err, entries) => {
        if (err) return res.status(500).json({ success: false, message: "Error reading uploads directory." });
        res.json({ success: true, projects: entries.filter((e) => e.isDirectory()).map((e) => e.name) });
    });
});

// -------------------------------------------------------------- tour APIs

// Loads the cached graph/layout for a tour, or sends a 404. Returns null when
// it has already responded.
function loadTour(req, res) {
    const project = path.basename(req.params.project);
    const folder = path.basename(req.params.folder);
    const analysis = getTourAnalysis(uploadsRoot, project, folder);
    if (!analysis) {
        res.status(404).json({ success: false, message: "Structure not found." });
        return null;
    }
    return { project, folder, ...analysis };
}

app.get("/api/tours/:project/:folder/graph", auth.requireAuth, (req, res) => {
    try {
        const tour = loadTour(req, res);
        if (!tour) return;
        res.json({ success: true, project: tour.project, folder: tour.folder, graph: tour.graph, layout: tour.layout });
    } catch (error) {
        res.status(500).json({ success: false, message: "Failed to parse tour.", error: error.message });
    }
});

// Shortest path from every node to the nearest given exit (multi-source
// Dijkstra). Exits are comma-separated, e.g. ?exits=node56,node51
app.get("/api/tours/:project/:folder/escape-routes", auth.requireAuth, (req, res) => {
    if (!req.query.exits) {
        return res.status(400).json({ success: false, message: "Provide at least one exit node id via ?exits=nodeA,nodeB" });
    }
    const exitNodeIds = req.query.exits.split(",").map((s) => s.trim()).filter(Boolean);

    try {
        const tour = loadTour(req, res);
        if (!tour) return;
        const escapeRoutes = computeEscapeRoutes(tour.graph, tour.layout.positions, exitNodeIds);

        // An unknown exit is bad input, not a successful empty result.
        if (escapeRoutes.exitNodeIds.length === 0) {
            return res.status(400).json({
                success: false,
                message: `None of those exit nodes exist: ${escapeRoutes.invalidExits.join(", ")}`
            });
        }
        res.json({ success: true, project: tour.project, folder: tour.folder, escapeRoutes });
    } catch (error) {
        res.status(500).json({ success: false, message: "Failed to compute escape routes.", error: error.message });
    }
});

app.get("/api/tours/:project/:folder/locations", auth.requireAuth, (req, res) => {
    try {
        const tour = loadTour(req, res);
        if (!tour) return;

        const locations = extractNamedLocations(tour.graph, tour.layout.positions);
        const floorplan = tour.graph.floorplans[0];
        const originPos = tour.layout.positions[tour.graph.startNode] || {};

        res.json({
            success: true,
            project: tour.project,
            folder: tour.folder,
            nodeCount: Object.keys(tour.graph.nodes).length,
            origin: {
                nodeId: tour.graph.startNode,
                xPercent: originPos.xPercent ?? null,
                yPercent: originPos.yPercent ?? null
            },
            floorplan: floorplan
                ? {
                      image: `/uploads/${tour.project}/${tour.folder}/images/maptiles/${floorplan.id}_1.jpg`,
                      width: floorplan.width,
                      height: floorplan.height
                  }
                : null,
            locations
        });
    } catch (error) {
        res.status(500).json({ success: false, message: "Failed to load locations.", error: error.message });
    }
});

app.get("/api/tours/:project/:folder/distance", auth.requireAuth, (req, res) => {
    const to = req.query.to;
    if (!to) {
        return res.status(400).json({ success: false, message: "Provide a destination node id via ?to=nodeId" });
    }

    try {
        const tour = loadTour(req, res);
        if (!tour) return;

        const from = req.query.from || tour.graph.startNode;
        const escapeRoutes = computeEscapeRoutes(tour.graph, tour.layout.positions, [to]);

        if (escapeRoutes.invalidExits.includes(to)) {
            return res.status(400).json({ success: false, message: `Unknown destination node: ${to}` });
        }
        const route = escapeRoutes.routes[from];
        if (!route) {
            return res.status(400).json({ success: false, message: `Unknown origin node: ${from}` });
        }

        res.json({
            success: true,
            project: tour.project,
            folder: tour.folder,
            from,
            to,
            distance: route.distance,
            path: route.path,
            unreachable: !!route.unreachable
        });
    } catch (error) {
        res.status(500).json({ success: false, message: "Failed to compute distance.", error: error.message });
    }
});

// ----------------------------------------------------------------- scene

// Cached object-detection result for one node (what/where is around you),
// or { analyzed: false } if it hasn't been run yet.
app.get("/api/tours/:project/:folder/scene/:nodeId", auth.requireAuth, (req, res) => {
    const tour = loadTour(req, res);
    if (!tour) return;

    const nodeId = req.params.nodeId;
    if (!tour.graph.nodes[nodeId]) {
        return res.status(404).json({ success: false, message: "Unknown node id." });
    }

    const scene = sceneDetect.getScene(tour.project, tour.folder, nodeId);
    res.json({
        success: true,
        nodeId,
        analyzed: !!scene,
        modelAvailable: sceneDetect.modelAvailable(),
        scene: scene || null
    });
});

// Run detection for a node (admin, slow — spawns the Python detector) and
// cache the result.
app.post("/api/tours/:project/:folder/scene/:nodeId", auth.requireAdmin, async (req, res) => {
    const tour = loadTour(req, res);
    if (!tour) return;

    const nodeId = req.params.nodeId;
    if (!tour.graph.nodes[nodeId]) {
        return res.status(404).json({ success: false, message: "Unknown node id." });
    }

    try {
        const scene = await sceneDetect.analyzeNode(tour.project, tour.folder, nodeId);
        res.json({ success: true, nodeId, scene });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// -------------------------------------------------------- tactical analysis

// Cached VLM tactical analysis for a node (per-direction readout), or
// { analyzed: false }. Read by the 3D pano viewer's live panel.
app.get("/api/tours/:project/:folder/analysis/:nodeId", auth.requireAuth, (req, res) => {
    const tour = loadTour(req, res);
    if (!tour) return;
    const nodeId = req.params.nodeId;
    if (!tour.graph.nodes[nodeId]) {
        return res.status(404).json({ success: false, message: "Unknown node id." });
    }
    const analysis = vlmAnalyze.getAnalysis(tour.project, tour.folder, nodeId);
    res.json({
        success: true,
        nodeId,
        analyzed: !!analysis,
        apiConfigured: vlmAnalyze.keyConfigured(),
        engine: vlmAnalyze.backend().name,
        analysis: analysis || null
    });
});

// Run VLM analysis for a node (admin; calls the vision API). Slow.
app.post("/api/tours/:project/:folder/analysis/:nodeId", auth.requireAdmin, async (req, res) => {
    const tour = loadTour(req, res);
    if (!tour) return;
    const nodeId = req.params.nodeId;
    if (!tour.graph.nodes[nodeId]) {
        return res.status(404).json({ success: false, message: "Unknown node id." });
    }
    // A local model works one cube face at a time and takes minutes, not
    // seconds — keep the socket open and trace progress to the console.
    req.setTimeout(0);
    res.setTimeout(0);
    const be = vlmAnalyze.backend();
    console.log(`[vlm] analysing ${nodeId} via ${be.name} (${be.model})`);
    const started = Date.now();
    try {
        const analysis = await vlmAnalyze.analyzeNode(tour.project, tour.folder, nodeId, (step) =>
            console.log(`[vlm]   ${nodeId}: ${step}`)
        );
        console.log(`[vlm] ${nodeId} done in ${Math.round((Date.now() - started) / 1000)}s`);
        res.json({ success: true, nodeId, analysis });
    } catch (error) {
        console.error(`[vlm] ${nodeId} failed: ${error.message}`);
        res.status(500).json({ success: false, message: error.message });
    }
});

// ------------------------------------------------------------------- geo

// Node coordinates + annotation pins for a tour, plus how much of the tour
// has actually been placed on the map so the UI can be honest about it.
app.get("/api/tours/:project/:folder/geo", auth.requireAuth, (req, res) => {
    try {
        const tour = loadTour(req, res);
        if (!tour) return;

        const geo = geoStore.getGeo(tour.project, tour.folder);
        const named = extractNamedLocations(tour.graph, tour.layout.positions);

        res.json({
            success: true,
            project: tour.project,
            folder: tour.folder,
            coverage: coverage(tour.graph, geo.nodes),
            nodes: geo.nodes,
            pins: geo.pins,
            // Every node, so the admin can place any of them - named ones are
            // flagged so the placement list can lead with the useful ones.
            allNodes: Object.keys(tour.graph.nodes).map((id) => {
                const labels = named.filter((n) => n.nodeId === id).map((n) => n.displayName);
                return { nodeId: id, labels, placed: !!geo.nodes[id] };
            })
        });
    } catch (error) {
        res.status(500).json({ success: false, message: "Failed to load geo data.", error: error.message });
    }
});

app.post("/api/tours/:project/:folder/geo/node", auth.requireAdmin, (req, res) => {
    const tour = loadTour(req, res);
    if (!tour) return;

    const { nodeId } = req.body;
    if (!nodeId || !tour.graph.nodes[nodeId]) {
        return res.status(400).json({ success: false, message: "Unknown node id." });
    }

    const clearing = req.body.lat === null || req.body.lon === null;
    try {
        const nodes = geoStore.setNodeCoords(
            tour.project,
            tour.folder,
            nodeId,
            clearing ? null : Number(req.body.lat),
            clearing ? null : Number(req.body.lon)
        );
        // A moved node orphans any cached routes that used its old position.
        valhalla.clearRouteCache();
        res.json({ success: true, coverage: coverage(tour.graph, nodes) });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
});

app.post("/api/tours/:project/:folder/pins", auth.requireAdmin, (req, res) => {
    const project = path.basename(req.params.project);
    const folder = path.basename(req.params.folder);
    try {
        const pin = geoStore.addPin(project, folder, {
            lat: Number(req.body.lat),
            lon: Number(req.body.lon),
            title: req.body.title,
            description: req.body.description,
            kind: req.body.kind
        });
        res.json({ success: true, pin });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
});

app.delete("/api/tours/:project/:folder/pins/:pinId", auth.requireAdmin, (req, res) => {
    const project = path.basename(req.params.project);
    const folder = path.basename(req.params.folder);
    const removed = geoStore.deletePin(project, folder, req.params.pinId);
    if (!removed) return res.status(404).json({ success: false, message: "Pin not found." });
    res.json({ success: true });
});

// Real-world distance in metres between two placed nodes: walking distance
// along the tour's own hotspot links, plus straight-line for reference.
app.get("/api/tours/:project/:folder/geo-distance", auth.requireAuth, (req, res) => {
    const tour = loadTour(req, res);
    if (!tour) return;

    const to = req.query.to;
    if (!to) return res.status(400).json({ success: false, message: "Provide ?to=nodeId" });

    const geo = geoStore.getGeo(tour.project, tour.folder);
    const from = req.query.from || tour.graph.startNode;
    const result = routeMetres(tour.graph, geo.nodes, from, to);

    if (result.error) {
        return res.status(400).json({ success: false, message: result.error, coverage: coverage(tour.graph, geo.nodes) });
    }

    res.json({
        success: true,
        from,
        to,
        metres: result.metres,
        straightLineMetres: result.straightLineMetres,
        hops: result.hops,
        path: result.path,
        coverage: coverage(tour.graph, geo.nodes)
    });
});

// ------------------------------------------------------- reaction analysis

// "If something happens HERE, who can reach it and how fast?"
//
// A public mapping service answers point-to-point navigation. It cannot answer
// this for a closed site: one origin, every surveyed position ranked by real
// walking time along the site's own paths, grouped into reaction bands. That
// is response planning - siting a reserve, checking mutual support between
// sentry positions, judging whether a post can be reinforced in time.
app.get("/api/tours/:project/:folder/reaction", auth.requireAuth, async (req, res) => {
    const tour = loadTour(req, res);
    if (!tour) return;

    const from = req.query.from || tour.graph.startNode;
    const pace = PACE[req.query.pace] || PACE.walk;
    // Valhalla follows real mapped paths and needs only the two endpoints
    // placed. The hotspot graph needs every junction along the way placed too,
    // and with 11 of 108 surveyed that reaches almost nothing - so real paths
    // are the default and the graph is opt-in for cross-checking.
    const mode = req.query.mode === "graph" ? "graph" : "paths";

    const geo = geoStore.getGeo(tour.project, tour.folder);
    if (!geo.nodes[from]) {
        return res.status(400).json({ success: false, message: "That origin has not been placed on the map yet." });
    }

    const names = {};
    for (const loc of extractNamedLocations(tour.graph, tour.layout.positions)) {
        if (!names[loc.nodeId]) names[loc.nodeId] = loc.displayName;
    }

    const banded = (seconds) =>
        seconds <= 30 ? "immediate" : seconds <= 60 ? "under1min" : seconds <= 120 ? "under2min" : "beyond";

    let reached = [];
    let unreachable = [];

    if (mode === "graph") {
        const result = reachFrom(tour.graph, geo.nodes, from);
        if (result.error) {
            return res.status(400).json({ success: false, message: result.error, coverage: coverage(tour.graph, geo.nodes) });
        }
        reached = result.reached
            .filter((r) => geo.nodes[r.nodeId])
            .map((r) => ({
                nodeId: r.nodeId,
                name: names[r.nodeId] || r.nodeId,
                metres: Math.round(r.metres),
                seconds: Math.round(r.metres / pace),
                band: banded(r.metres / pace),
                hops: r.hops,
                lat: geo.nodes[r.nodeId].lat,
                lon: geo.nodes[r.nodeId].lon
            }));
    } else {
        const targets = Object.keys(geo.nodes).filter((id) => id !== from);
        for (const id of targets) {
            try {
                const r = await valhalla.route(geo.nodes[from], geo.nodes[id], "pedestrian");
                // Time is derived from distance and the chosen pace rather than
                // taken from Valhalla, so the pace selector actually means
                // something and every row uses one consistent assumption.
                const seconds = r.metres / pace;
                reached.push({
                    nodeId: id,
                    name: names[id] || id,
                    metres: r.metres,
                    seconds: Math.round(seconds),
                    band: banded(seconds),
                    lat: geo.nodes[id].lat,
                    lon: geo.nodes[id].lon,
                    shape: r.shape,
                    cached: !!r.cached
                });
            } catch (err) {
                unreachable.push({ nodeId: id, name: names[id] || id, reason: err.message });
            }
        }
        reached.sort((a, b) => a.metres - b.metres);
    }

    res.json({
        success: true,
        mode,
        origin: { nodeId: from, name: names[from] || from, lat: geo.nodes[from].lat, lon: geo.nodes[from].lon },
        paceMetresPerSecond: pace,
        paceName: PACE[req.query.pace] ? req.query.pace : "walk",
        bands: {
            immediate: reached.filter((r) => r.band === "immediate").length,
            under1min: reached.filter((r) => r.band === "under1min").length,
            under2min: reached.filter((r) => r.band === "under2min").length,
            beyond: reached.filter((r) => r.band === "beyond").length
        },
        reached,
        unreachable,
        coverage: coverage(tour.graph, geo.nodes)
    });
});

// Site-wide rollup: what is surveyed, what is analysed, and what the analysis
// says is hidden. Answers "where is this site weakest?" in one call.
app.get("/api/tours/:project/:folder/overview", auth.requireAuth, (req, res) => {
    const tour = loadTour(req, res);
    if (!tour) return;

    const geo = geoStore.getGeo(tour.project, tour.folder);
    const names = {};
    for (const loc of extractNamedLocations(tour.graph, tour.layout.positions)) {
        if (!names[loc.nodeId]) names[loc.nodeId] = loc.displayName;
    }

    const nodes = Object.keys(tour.graph.nodes).map((id) => {
        const analysis = vlmAnalyze.getAnalysis(tour.project, tour.folder, id);
        const dirs = analysis && analysis.directions ? Object.values(analysis.directions) : [];
        // Count only entries that actually say something - a field reading
        // "none obvious" is an absence of analysis, not a finding of none.
        const said = (v) => {
            const s = String(v || "").trim();
            return s && !/^\s*(none|no\b|not\b|n\/a)/i.test(s);
        };
        return {
            nodeId: id,
            name: names[id] || null,
            placed: !!geo.nodes[id],
            analysed: !!analysis,
            blindSpotMentions: dirs.filter((d) => said(d.blindSpots)).length,
            hazardMentions: dirs.filter((d) => said(d.hazards)).length,
            coverMentions: dirs.filter((d) => said(d.cover)).length,
            directionsAnalysed: dirs.length
        };
    });

    res.json({
        success: true,
        project: tour.project,
        folder: tour.folder,
        totals: {
            nodes: nodes.length,
            placed: nodes.filter((n) => n.placed).length,
            analysed: nodes.filter((n) => n.analysed).length,
            named: nodes.filter((n) => n.name).length,
            pins: geo.pins.length
        },
        nodes
    });
});

// Download every node as a CSV to fill in offline, pre-populated with any
// coordinates already recorded so a partly-finished survey round-trips.
app.get("/api/tours/:project/:folder/nodes.csv", auth.requireAuth, (req, res) => {
    const tour = loadTour(req, res);
    if (!tour) return;

    const geo = geoStore.getGeo(tour.project, tour.folder);
    const csv = toCsv(buildSheet(tour.graph, tour.layout, geo.nodes));

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${tour.folder} nodes.csv"`);
    res.send("﻿" + csv); // BOM so Excel reads UTF-8 correctly
});

// Bulk-apply coordinates from a filled-in sheet. Rows without coordinates are
// skipped rather than rejected, so the same sheet can be re-imported as more
// of the survey gets done.
app.post("/api/tours/:project/:folder/nodes-import", auth.requireAdmin, (req, res) => {
    const tour = loadTour(req, res);
    if (!tour) return;

    const validIds = new Set(Object.keys(tour.graph.nodes));
    const { rows, errors, skipped } = parseSheet(req.body.csv, validIds);

    if (!rows.length) {
        return res.status(400).json({
            success: false,
            message: errors[0] || "No rows with coordinates were found.",
            errors,
            skipped
        });
    }

    let applied = 0;
    for (const row of rows) {
        try {
            geoStore.setNodeCoords(tour.project, tour.folder, row.nodeId, row.lat, row.lon);
            applied++;
        } catch (error) {
            errors.push(`${row.nodeId}: ${error.message}`);
        }
    }

    const geo = geoStore.getGeo(tour.project, tour.folder);
    res.json({
        success: true,
        applied,
        skipped,
        errors,
        coverage: coverage(tour.graph, geo.nodes)
    });
});

// ------------------------------------------------------------ map tiles

// Leaflet points here instead of at OSM directly, so every tile viewed is
// kept on disk and the map keeps working with no connection.
app.get("/api/tiles/:z/:x/:y.png", auth.requireAuth, async (req, res) => {
    const z = Number(req.params.z);
    const x = Number(req.params.x);
    const y = Number(req.params.y);

    try {
        const { buffer, cached } = await tileCache.getTile(z, x, y);
        res.setHeader("Content-Type", "image/png");
        res.setHeader("Cache-Control", "public, max-age=604800");
        res.setHeader("X-Tile-Cache", cached ? "hit" : "miss");
        res.send(buffer);
    } catch (error) {
        // 204 keeps Leaflet quiet - a missing tile shows as blank rather than
        // a broken-image icon plastered across the map when offline.
        res.status(204).end();
    }
});

app.get("/api/tiles/stats", auth.requireAuth, (req, res) => {
    res.json({ success: true, ...tileCache.cacheStats(), maxPerPrefetch: tileCache.MAX_TILES_PER_PREFETCH });
});

// Pre-download an area so it is available offline later.
app.post("/api/tiles/prefetch", auth.requireAdmin, async (req, res) => {
    const { north, south, east, west } = req.body.bounds || {};
    const minZoom = Number(req.body.minZoom ?? 15);
    const maxZoom = Number(req.body.maxZoom ?? 18);

    if (![north, south, east, west].every((n) => Number.isFinite(Number(n)))) {
        return res.status(400).json({ success: false, message: "Provide bounds {north, south, east, west}." });
    }
    if (minZoom < 0 || maxZoom > 19 || minZoom > maxZoom) {
        return res.status(400).json({ success: false, message: "Zoom range must be between 0 and 19." });
    }

    const bounds = { north: Number(north), south: Number(south), east: Number(east), west: Number(west) };

    try {
        const result = await tileCache.prefetchArea(bounds, minZoom, maxZoom);
        res.json({ success: true, ...result, ...tileCache.cacheStats() });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
});

// Estimate the cost of a prefetch before committing to it.
app.post("/api/tiles/prefetch-estimate", auth.requireAuth, (req, res) => {
    const { north, south, east, west } = req.body.bounds || {};
    const minZoom = Number(req.body.minZoom ?? 15);
    const maxZoom = Number(req.body.maxZoom ?? 18);
    if (![north, south, east, west].every((n) => Number.isFinite(Number(n)))) {
        return res.status(400).json({ success: false, message: "Provide bounds." });
    }
    // Counted arithmetically - a wide area at high zoom is far too large to
    // enumerate, so it must never be turned into an array just to be measured.
    const tiles = tileCache.countPrefetch(
        { north: Number(north), south: Number(south), east: Number(east), west: Number(west) },
        minZoom,
        maxZoom
    );
    res.json({
        success: true,
        tiles,
        withinLimit: tiles <= tileCache.MAX_TILES_PER_PREFETCH,
        limit: tileCache.MAX_TILES_PER_PREFETCH,
        estimatedSeconds: Math.round(tiles * 0.55)
    });
});

// Turn-by-turn walking directions between two surveyed nodes, following real
// OSM paths via Valhalla. Falls alongside the hotspot-graph distance, not in
// place of it - see valhalla.js for why both exist.
app.get("/api/tours/:project/:folder/directions", auth.requireAuth, async (req, res) => {
    const tour = loadTour(req, res);
    if (!tour) return;

    const { from, to } = req.query;
    if (!from || !to) return res.status(400).json({ success: false, message: "Provide ?from=nodeId&to=nodeId" });

    const geo = geoStore.getGeo(tour.project, tour.folder);
    const a = geo.nodes[from];
    const b = geo.nodes[to];
    if (!a) return res.status(400).json({ success: false, message: "The starting point has not been placed on the map yet." });
    if (!b) return res.status(400).json({ success: false, message: "That destination has not been placed on the map yet." });

    try {
        const result = await valhalla.route(a, b, "pedestrian");
        res.json({ success: true, from, to, ...result });
    } catch (error) {
        res.status(502).json({ success: false, message: error.message || "Routing service unavailable." });
    }
});

// Pre-fetch and cache walking routes between every pair of placed nodes, so
// the whole site's directions work with no connection later. Both directions
// of each pair are cached because pedestrian routing is not symmetric.
app.post("/api/tours/:project/:folder/cache-routes", auth.requireAdmin, async (req, res) => {
    const tour = loadTour(req, res);
    if (!tour) return;

    const geo = geoStore.getGeo(tour.project, tour.folder);
    const ids = Object.keys(geo.nodes);
    let cached = 0;
    let failed = 0;

    for (let i = 0; i < ids.length; i++) {
        for (let j = 0; j < ids.length; j++) {
            if (i === j) continue;
            try {
                await valhalla.route(geo.nodes[ids[i]], geo.nodes[ids[j]], "pedestrian");
                cached++;
            } catch {
                failed++;
            }
        }
    }

    res.json({ success: true, placedNodes: ids.length, cached, failed, ...valhalla.cacheStats() });
});

// Directions between two arbitrary map points (no nodes involved).
app.get("/api/geo/directions", auth.requireAuth, async (req, res) => {
    const nums = ["fromLat", "fromLon", "toLat", "toLon"].map((k) => Number(req.query[k]));
    if (nums.some((n) => !Number.isFinite(n))) {
        return res.status(400).json({ success: false, message: "Provide fromLat, fromLon, toLat, toLon." });
    }
    const [fromLat, fromLon, toLat, toLon] = nums;
    try {
        const result = await valhalla.route({ lat: fromLat, lon: fromLon }, { lat: toLat, lon: toLon }, "pedestrian");
        res.json({ success: true, ...result });
    } catch (error) {
        res.status(502).json({ success: false, message: error.message || "Routing service unavailable." });
    }
});

// Distance between two arbitrary map clicks - no nodes involved.
app.get("/api/geo/point-distance", auth.requireAuth, (req, res) => {
    const nums = ["fromLat", "fromLon", "toLat", "toLon"].map((k) => Number(req.query[k]));
    if (nums.some((n) => !Number.isFinite(n))) {
        return res.status(400).json({ success: false, message: "Provide fromLat, fromLon, toLat, toLon." });
    }
    const [fromLat, fromLon, toLat, toLon] = nums;
    if (!geoStore.isValidLatLon(fromLat, fromLon) || !geoStore.isValidLatLon(toLat, toLon)) {
        return res.status(400).json({ success: false, message: "Coordinates out of range." });
    }
    res.json({
        success: true,
        straightLineMetres: haversineMetres({ lat: fromLat, lon: fromLon }, { lat: toLat, lon: toLon })
    });
});

// ------------------------------------------------------------- structures

app.get("/personnel", auth.requireAuth, (req, res) => res.json(readPersonnel()));

app.post("/add-personnel", auth.requireAdmin, (req, res) => {
    const { sno, name, location, project, folderName } = req.body;
    if (!project || !folderName) {
        return res.status(400).json({ success: false, message: "project and folderName are required." });
    }

    const data = readPersonnel();
    if (data.some((e) => e.project === project && e.folderName === folderName)) {
        return res.status(409).json({ success: false, message: `${folderName} is already listed under ${project}.` });
    }

    data.push({ sno, name, location, project, folderName });
    writePersonnel(data);
    res.json({ success: true });
});

app.post("/update-personnel", auth.requireAdmin, (req, res) => {
    const { project, folderName, sno, name, location } = req.body;
    if (!project || !folderName) {
        return res.status(400).json({ success: false, message: "project and folderName are required." });
    }

    const data = readPersonnel();
    const entry = data.find((e) => e.project === project && e.folderName === folderName);
    if (!entry) {
        return res.status(404).json({ success: false, message: "Structure record not found." });
    }

    const trimmed = String(location || "").trim();
    if (!trimmed) {
        return res.status(400).json({ success: false, message: "Location can't be empty." });
    }

    const clash = data.find(
        (e) => e !== entry && e.project === project && String(e.location || "").toLowerCase() === trimmed.toLowerCase()
    );
    if (clash) {
        return res.status(409).json({ success: false, message: `"${trimmed}" is already used in ${project}.` });
    }

    entry.sno = sno;
    entry.name = name;
    entry.location = trimmed;
    writePersonnel(data);
    res.json({ success: true, entry });
});

// Deletes one structure: its record AND its files, so nothing is orphaned.
app.post("/delete-structure", auth.requireAdmin, (req, res) => {
    const project = path.basename(String(req.body.project || ""));
    const folderName = path.basename(String(req.body.folderName || ""));
    if (!project || !folderName) {
        return res.status(400).json({ success: false, message: "project and folderName are required." });
    }

    const data = readPersonnel();
    const remaining = data.filter((e) => !(e.project === project && e.folderName === folderName));
    if (remaining.length === data.length) {
        return res.status(404).json({ success: false, message: "Structure record not found." });
    }

    try {
        const dir = path.join(uploadsRoot, project, folderName);
        if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });

        // Drop the project folder too once its last structure is gone.
        const projectDir = path.join(uploadsRoot, project);
        if (fs.existsSync(projectDir) && fs.readdirSync(projectDir).length === 0) {
            fs.rmSync(projectDir, { recursive: true, force: true });
        }

        invalidateTour(project, folderName);
        geoStore.clearTour(project, folderName);
        sceneDetect.clearTour(project, folderName);
        vlmAnalyze.clearTour(project, folderName);
        writePersonnel(remaining);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, message: "Could not delete the structure files.", error: error.message });
    }
});

// Clears every record AND the uploaded files, so "clear" doesn't leave
// invisible orphaned folders behind on disk.
app.post("/clear-personnel", auth.requireAdmin, (req, res) => {
    try {
        for (const entry of readPersonnel()) {
            const dir = path.join(uploadsRoot, path.basename(entry.project || ""), path.basename(entry.folderName || ""));
            if (entry.project && entry.folderName && fs.existsSync(dir)) {
                fs.rmSync(dir, { recursive: true, force: true });
            }
            invalidateTour(entry.project, entry.folderName);
            geoStore.clearTour(entry.project, entry.folderName);
            sceneDetect.clearTour(entry.project, entry.folderName);
            vlmAnalyze.clearTour(entry.project, entry.folderName);
        }
        for (const dirent of fs.readdirSync(uploadsRoot, { withFileTypes: true })) {
            const projectDir = path.join(uploadsRoot, dirent.name);
            if (dirent.isDirectory() && fs.readdirSync(projectDir).length === 0) {
                fs.rmSync(projectDir, { recursive: true, force: true });
            }
        }
        writePersonnel([]);
        res.json({ success: true, message: "All structures and their files were removed." });
    } catch (error) {
        res.status(500).json({ success: false, message: "Could not clear everything.", error: error.message });
    }
});

app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});
