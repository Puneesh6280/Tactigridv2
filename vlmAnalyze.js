// Tactical scene analysis of a node using a vision-language model.
//
// Each of the six cube faces (an undistorted 90 deg view) is sent to the
// Anthropic Messages API with a tactical prompt, and the model returns a
// per-direction readout: notable structures, doors/windows/openings, cover and
// concealment, blind spots, obstacles (ditches/nallahs), signage, vehicles,
// and approach routes. This is scene *understanding*, so it catches things a
// fixed-class detector cannot (a hut, a nallah, a CCTV sign).
//
// Requires ANTHROPIC_API_KEY. Results are cached per node in vlmdata.json and
// dropped when the scan is re-uploaded. Analysis is the same regardless of
// which operator later reads it, so it is computed once by an admin.

const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");

const dataFile = path.join(__dirname, "vlmdata.json");
const stitchScript = path.join(__dirname, "stitch_faces.py");
const uploadsRoot = path.join(__dirname, "uploads");
const PYTHON = process.env.TACTIGRID_PYTHON || "python";
const API_KEY = process.env.ANTHROPIC_API_KEY || "";
const BASE_URL = (process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com").replace(/\/$/, "");
const MODEL = process.env.TACTIGRID_VLM_MODEL || "claude-sonnet-5";

const readAll = () => (fs.existsSync(dataFile) ? JSON.parse(fs.readFileSync(dataFile, "utf8")) : {});
const writeAll = (d) => fs.writeFileSync(dataFile, JSON.stringify(d, null, 2));
const key = (project, folder) => `${project}/${folder}`;

function getAnalysis(project, folder, nodeId) {
    const tour = readAll()[key(project, folder)];
    return tour && tour[nodeId] ? tour[nodeId] : null;
}

function saveAnalysis(project, folder, nodeId, result) {
    const all = readAll();
    const k = key(project, folder);
    all[k] = all[k] || {};
    all[k][nodeId] = { ...result, analyzedAt: new Date().toISOString() };
    writeAll(all);
}

function clearTour(project, folder) {
    const all = readAll();
    delete all[key(project, folder)];
    writeAll(all);
}

const keyConfigured = () => !!API_KEY;

// Stitch the six faces to base64 JPEGs via the Python helper.
function stitchFaces(project, folder, nodeId) {
    return new Promise((resolve, reject) => {
        const nodeDir = path.join(uploadsRoot, path.basename(project), path.basename(folder), "tiles", path.basename(nodeId));
        if (!fs.existsSync(nodeDir)) return reject(new Error(`No imagery for ${nodeId}.`));
        execFile(
            PYTHON,
            [stitchScript, nodeDir, "base64", "1024"],
            { timeout: 60000, maxBuffer: 64 * 1024 * 1024 },
            (err, stdout) => {
                if (err && !stdout) {
                    return reject(new Error(/ENOENT/.test(err.message) ? "Python not found (set TACTIGRID_PYTHON)." : err.message));
                }
                try {
                    const parsed = JSON.parse(stdout.trim().split("\n").pop());
                    if (!parsed.ok || !parsed.faces.length) throw new Error("No faces stitched.");
                    resolve(parsed.faces);
                } catch (e) {
                    reject(new Error("Could not stitch panorama faces."));
                }
            }
        );
    });
}

const PROMPT = `You are a tactical reconnaissance analyst reviewing a 360° panorama of a site, split into 6 directional views (front, right, back, left, up, down). For EACH view image provided, identify what matters for movement and security.

Return ONLY a JSON object, no prose outside it, with this exact shape:
{
  "overall": "2-3 sentence tactical summary of the whole location",
  "directions": {
    "front": {
      "summary": "1-2 sentences on what is in this view",
      "features": [ { "label": "short name e.g. 'Two-storey building', 'Metal gate', 'Sentry hut', 'Drainage nallah'", "note": "brief detail incl. doors/windows/openings if a structure" } ],
      "cover": "hard cover a person could use (walls, vehicles, pillars) - or 'none obvious'",
      "concealment": "concealment (vegetation, shadow, dead ground) - or 'none obvious'",
      "blindSpots": "areas hidden from this viewpoint - or 'none obvious'",
      "routes": "movement routes/approaches visible (roads, gaps, gates) - or 'none obvious'",
      "hazards": "obstacles/hazards (ditches, nallahs, wire, gradient) - or 'none obvious'"
    }
    // ... one entry per direction that has an image
  }
}
Be specific and read any visible signage. Note doors, windows, gates, and openings on every structure. If a view is only sky or featureless ground, say so briefly.`;

async function callVlm(faces) {
    const content = [{ type: "text", text: PROMPT }];
    for (const f of faces) {
        content.push({ type: "text", text: `\n=== ${f.direction.toUpperCase()} VIEW ===` });
        content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: f.b64 } });
    }

    const res = await fetch(`${BASE_URL}/v1/messages`, {
        method: "POST",
        headers: {
            "content-type": "application/json",
            "x-api-key": API_KEY,
            "anthropic-version": "2023-06-01"
        },
        body: JSON.stringify({ model: MODEL, max_tokens: 3000, messages: [{ role: "user", content }] }),
        signal: AbortSignal.timeout(120000)
    });

    if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`Vision API returned ${res.status}. ${body.slice(0, 160)}`);
    }

    const data = await res.json();
    const text = (data.content || []).filter((c) => c.type === "text").map((c) => c.text).join("");
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("Model did not return JSON.");
    return { ...JSON.parse(match[0]), model: MODEL };
}

async function analyzeNode(project, folder, nodeId) {
    if (!keyConfigured()) {
        throw new Error("ANTHROPIC_API_KEY is not set on the server, so live analysis is unavailable.");
    }
    const faces = await stitchFaces(project, folder, nodeId);
    const result = await callVlm(faces);
    saveAnalysis(project, folder, nodeId, result);
    return getAnalysis(project, folder, nodeId);
}

module.exports = { getAnalysis, saveAnalysis, analyzeNode, clearTour, keyConfigured, MODEL };
