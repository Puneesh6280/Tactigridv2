// Tactical scene analysis of a node using a vision-language model.
//
// Each of the six cube faces (an undistorted 90 deg view) is sent to a vision
// model with a tactical prompt, and the model returns a per-direction readout:
// structures, doors/windows/openings, cover, concealment, blind spots,
// obstacles (ditches/nallahs), signage, vehicles, and approach routes. This is
// scene *understanding*, so it catches things a fixed-class detector cannot.
//
// Backend is chosen from whichever key is available (OpenAI or Anthropic),
// read from apikeys.json (git-ignored) or the environment. Results are cached
// per node in vlmdata.json and dropped when the scan is re-uploaded. The 3D
// viewer reads the cache, so once analysed a node works fully offline.

const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");

const dataFile = path.join(__dirname, "vlmdata.json");
const keysFile = path.join(__dirname, "apikeys.json");
const stitchScript = path.join(__dirname, "stitch_faces.py");
const uploadsRoot = path.join(__dirname, "uploads");
const PYTHON = process.env.TACTIGRID_PYTHON || "python";

// Read keys fresh each call so dropping in apikeys.json needs no restart.
function loadKeys() {
    let file = {};
    try {
        if (fs.existsSync(keysFile)) file = JSON.parse(fs.readFileSync(keysFile, "utf8"));
    } catch { /* ignore malformed file */ }
    return {
        openrouter: process.env.OPENROUTER_API_KEY || file.openrouter || "",
        google: process.env.GOOGLE_API_KEY || file.google || "",
        openai: process.env.OPENAI_API_KEY || file.openai || "",
        anthropic: process.env.ANTHROPIC_API_KEY || file.anthropic || ""
    };
}

function backend() {
    const keys = loadKeys();
    if (keys.openrouter) {
        return {
            name: "openrouter",
            key: keys.openrouter,
            url: "https://openrouter.ai/api/v1/chat/completions",
            // A free vision model on OpenRouter; override with TACTIGRID_OPENROUTER_MODEL.
            model: process.env.TACTIGRID_OPENROUTER_MODEL || "nvidia/nemotron-nano-12b-v2-vl:free"
        };
    }
    if (keys.google) {
        const model = process.env.TACTIGRID_GEMINI_MODEL || "gemini-2.0-flash";
        return {
            name: "google",
            key: keys.google,
            url: `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
            model
        };
    }
    if (keys.openai) {
        return {
            name: "openai",
            key: keys.openai,
            url: (process.env.OPENAI_BASE_URL || "https://api.openai.com").replace(/\/$/, "") + "/v1/chat/completions",
            model: process.env.TACTIGRID_OPENAI_MODEL || "gpt-4o-mini"
        };
    }
    if (keys.anthropic) {
        return {
            name: "anthropic",
            key: keys.anthropic,
            url: (process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com").replace(/\/$/, "") + "/v1/messages",
            model: process.env.TACTIGRID_VLM_MODEL || "claude-sonnet-5"
        };
    }
    return null;
}

const keyConfigured = () => !!backend();

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
                } catch {
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

function extractJson(text) {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("Model did not return JSON.");
    return JSON.parse(match[0]);
}

// OpenAI-compatible chat completions (used by both OpenAI and OpenRouter).
async function callOpenAICompat(be, faces) {
    const content = [{ type: "text", text: PROMPT }];
    for (const f of faces) {
        content.push({ type: "text", text: `\n=== ${f.direction.toUpperCase()} VIEW ===` });
        content.push({ type: "image_url", image_url: { url: `data:image/jpeg;base64,${f.b64}`, detail: "low" } });
    }
    const headers = { "content-type": "application/json", authorization: `Bearer ${be.key}` };
    const body = { model: be.model, max_tokens: 3000, messages: [{ role: "user", content }] };
    if (be.name === "openrouter") {
        headers["HTTP-Referer"] = "https://tactigrid.local";
        headers["X-Title"] = "Tactigrid";
        // Free OpenRouter models may reject response_format; rely on extractJson.
    } else {
        body.response_format = { type: "json_object" };
    }

    const res = await fetch(be.url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(120000)
    });
    if (!res.ok) {
        const errBody = await res.text().catch(() => "");
        throw new Error(`Vision API returned ${res.status}. ${errBody.slice(0, 200)}`);
    }
    const data = await res.json();
    if (data.error) throw new Error(data.error.message || JSON.stringify(data.error).slice(0, 200));
    const text = data.choices && data.choices[0] && data.choices[0].message.content;
    return { ...extractJson(text || ""), model: be.model };
}

async function callAnthropic(be, faces) {
    const content = [{ type: "text", text: PROMPT }];
    for (const f of faces) {
        content.push({ type: "text", text: `\n=== ${f.direction.toUpperCase()} VIEW ===` });
        content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: f.b64 } });
    }
    const res = await fetch(be.url, {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": be.key, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model: be.model, max_tokens: 3000, messages: [{ role: "user", content }] }),
        signal: AbortSignal.timeout(120000)
    });
    if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`Vision API returned ${res.status}. ${body.slice(0, 200)}`);
    }
    const data = await res.json();
    const text = (data.content || []).filter((c) => c.type === "text").map((c) => c.text).join("");
    return { ...extractJson(text), model: be.model };
}

async function callGoogle(be, faces) {
    const parts = [{ text: PROMPT }];
    for (const f of faces) {
        parts.push({ text: `\n=== ${f.direction.toUpperCase()} VIEW ===` });
        parts.push({ inline_data: { mime_type: "image/jpeg", data: f.b64 } });
    }
    // Google AI Studio (Gemini) API keys authenticate via the x-goog-api-key
    // header — including the newer AQ.* format, not just the older AIza* one.
    const res = await fetch(be.url, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": be.key },
        body: JSON.stringify({
            contents: [{ role: "user", parts }],
            generationConfig: { responseMimeType: "application/json", maxOutputTokens: 3000 }
        }),
        signal: AbortSignal.timeout(120000)
    });
    if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`Vision API returned ${res.status}. ${body.slice(0, 220)}`);
    }
    const data = await res.json();
    const cand = data.candidates && data.candidates[0];
    const text = cand && cand.content && cand.content.parts && cand.content.parts.map((p) => p.text || "").join("");
    return { ...extractJson(text || ""), model: be.model };
}

async function analyzeNode(project, folder, nodeId) {
    const be = backend();
    if (!be) throw new Error("No vision API key configured (set apikeys.json google/openai/anthropic).");
    const faces = await stitchFaces(project, folder, nodeId);
    const result =
        be.name === "google" ? await callGoogle(be, faces) :
        (be.name === "openai" || be.name === "openrouter") ? await callOpenAICompat(be, faces) :
        await callAnthropic(be, faces);
    saveAnalysis(project, folder, nodeId, result);
    return getAnalysis(project, folder, nodeId);
}

module.exports = { getAnalysis, saveAnalysis, analyzeNode, clearTour, keyConfigured, backend };
