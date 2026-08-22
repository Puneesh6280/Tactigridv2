// Tactical scene analysis of a node using a vision-language model.
//
// Each of the six cube faces (an undistorted 90 deg view) is sent to a vision
// model with a tactical prompt, and the model returns a per-direction readout:
// structures, doors/windows/openings, cover, concealment, blind spots,
// obstacles (ditches/nallahs), signage, vehicles, and approach routes. This is
// scene *understanding*, so it catches things a fixed-class detector cannot.
//
// Backend is chosen from whichever key is available (OpenAI or Anthropic),
// read from apikeys.json (git-ignored) or the environment, or from a local
// Ollama server. Results are cached per node in vlmdata.json and dropped when
// the scan is re-uploaded. The 3D viewer reads the cache, so once analysed a
// node works fully offline.
//
// TACGRID_VLM_BACKEND forces a backend (ollama | anthropic | openai |
// google | openrouter). With nothing set, a configured cloud key wins and
// Ollama is the fallback, so a machine with no keys runs fully local — the
// imagery never leaves the box, which is the point for a defence site.

const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");

const dataFile = path.join(__dirname, "vlmdata.json");
const keysFile = path.join(__dirname, "apikeys.json");
const stitchScript = path.join(__dirname, "stitch_faces.py");
const uploadsRoot = path.join(__dirname, "uploads");
const PYTHON = process.env.TACGRID_PYTHON || "python";

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

function ollamaBackend() {
    return {
        name: "ollama",
        key: "",
        url: (process.env.OLLAMA_HOST || "http://127.0.0.1:11434").replace(/\/$/, "") + "/api/chat",
        // Its own variable: TACGRID_VLM_MODEL also names the Anthropic model,
        // so sharing it would send a local model name to the cloud API.
        model: process.env.TACGRID_OLLAMA_MODEL || "qwen2.5vl:7b"
    };
}

function backend() {
    const keys = loadKeys();
    const forced = (process.env.TACGRID_VLM_BACKEND || "").trim().toLowerCase();
    if (forced === "ollama") return ollamaBackend();
    if (forced && keys[forced]) {
        // Fall through to the matching branch below by masking the others.
        for (const k of Object.keys(keys)) if (k !== forced) keys[k] = "";
    }
    if (keys.openrouter) {
        return {
            name: "openrouter",
            key: keys.openrouter,
            url: "https://openrouter.ai/api/v1/chat/completions",
            // A free vision model on OpenRouter; override with TACGRID_OPENROUTER_MODEL.
            model: process.env.TACGRID_OPENROUTER_MODEL || "nvidia/nemotron-nano-12b-v2-vl:free"
        };
    }
    if (keys.google) {
        const model = process.env.TACGRID_GEMINI_MODEL || "gemini-2.0-flash";
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
            model: process.env.TACGRID_OPENAI_MODEL || "gpt-4o-mini"
        };
    }
    if (keys.anthropic) {
        return {
            name: "anthropic",
            key: keys.anthropic,
            url: (process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com").replace(/\/$/, "") + "/v1/messages",
            model: process.env.TACGRID_VLM_MODEL || "claude-sonnet-5"
        };
    }
    // No cloud key: run locally against Ollama.
    return ollamaBackend();
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
            {
                timeout: 120000,
                maxBuffer: 64 * 1024 * 1024,
                // OpenBLAS allocates large per-thread buffers and on the
                // bigger panoramas (node111 has 50 tiles a face) it fails with
                // "Memory allocation still failed after 10 retries" despite
                // gigabytes free. Single-threaded stitching is not measurably
                // slower here and does not fail.
                env: { ...process.env, OPENBLAS_NUM_THREADS: "1" }
            },
            (err, stdout) => {
                if (err && !stdout) {
                    return reject(new Error(/ENOENT/.test(err.message) ? "Python not found (set TACGRID_PYTHON)." : err.message));
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
        headers["HTTP-Referer"] = "https://tacgrid.local";
        headers["X-Title"] = "TAC-GRID";
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

// One cube face at a time. A 7B vision model on an 8 GB card cannot hold six
// 1024px images in one context, and sending them separately also removes the
// ambiguity about which image the model is describing.
//
// Prompt design, learned the hard way. The first version ended each tactical
// field with "- or 'none obvious'" and phrased blind spots as "areas hidden
// from this viewpoint". The model then answered "none obvious" for 97% of
// fields (2 substantive out of 66), because:
//   1. An explicit opt-out is the cheapest token path, so it always wins.
//   2. "Which areas are hidden" requires reasoning about what is NOT in the
//      image - weak in a 7B model - whereas naming objects that ARE in the
//      image is exactly what it is good at.
// So: no opt-out is offered, and every tactical field is now phrased as "name
// the objects that...". Blind spots in particular are reached via "every solid
// object hides the ground behind it", which turns a negative inference into an
// object-listing task. Same answer, easy route.
const DIRECTION_PROMPT = (direction) => `You are a tactical reconnaissance analyst. This single image is the ${direction.toUpperCase()} view from a 360° panorama taken at a site.

Examine the image closely and report what is actually there. Return ONLY a JSON object with this exact shape:
{
  "summary": "1-2 sentences on what is in this view",
  "features": [ { "label": "short name e.g. 'Two-storey building', 'Metal gate', 'Sentry hut', 'Drainage nallah'", "note": "brief detail incl. doors/windows/openings if a structure" } ],
  "cover": "Name the specific solid objects in this view that would stop a bullet or shield a person from fire - walls, buildings, vehicles, pillars, kerbs, embankments, boundary stones.",
  "concealment": "Name what in this view would hide a person from sight without stopping fire - trees, bushes, hedges, tall grass, shadow, dead ground, clutter.",
  "blindSpots": "Every solid object in this view hides the ground behind it. List each such object - buildings, walls, vehicles, vegetation, boards, huts - and state what area it conceals from this viewpoint.",
  "routes": "Every way a person could move into or through this view - roads, tracks, paths, gates, doorways, gaps in walls or vegetation, open ground.",
  "hazards": "Anything here that impedes or endangers movement - ditches, nallahs, barbed wire, slopes, loose surface, debris, power lines, vehicle traffic."
}

Rules:
- Every field must name something visible in THIS image. Be concrete and specific.
- NEVER write "none obvious", "none", "N/A", "not applicable" or similar. If a
  feature is sparse, describe the little that is present instead of dismissing it.
- Read any visible signage and quote it.
- Note doors, windows, gates and openings on every structure.
- For a view of open sky or bare ground, still report what it means for movement
  and observation (e.g. overhead exposure, no overhead cover, open approach).`;

// "overall" must be ONE string. Asked loosely, the model returns a list of
// fragments or {description: ...}, which asText then flattens into a
// semicolon-jumble that reads as broken.
const OVERALL_PROMPT = `You are a tactical reconnaissance analyst. Below are observations from each direction at one 360° panorama viewpoint. Write a short tactical summary of the location as a whole.

Return ONLY this JSON object:
{"overall": "2-3 complete sentences of flowing prose"}

Rules:
- "overall" must be a single plain string - NOT a list, NOT an object.
- Write full sentences. Do not output fragments separated by semicolons.
- Cover what the position is, how it can be approached, and what limits
  observation from it.`;

// A local 7B model follows the requested JSON shape only loosely: a field
// asked for as a string often arrives as {description: "..."} or {label, note},
// and a list sometimes arrives as a bare object. The text it produces is
// usually right even when the shape is not, so coerce instead of discarding.
function asText(v) {
    if (v == null) return "";
    if (typeof v === "string") return v.trim();
    if (typeof v === "number" || typeof v === "boolean") return String(v);
    if (Array.isArray(v)) return v.map(asText).filter(Boolean).join("; ");
    if (typeof v === "object") {
        for (const k of ["description", "text", "summary", "value", "detail"]) {
            if (typeof v[k] === "string" && v[k].trim()) return v[k].trim();
        }
        if (v.label || v.note) return [asText(v.label), asText(v.note)].filter(Boolean).join(" — ");
        return Object.values(v).map(asText).filter(Boolean).join("; ");
    }
    return "";
}

const DIRECTION_FIELDS = ["summary", "cover", "concealment", "blindSpots", "routes", "hazards"];

// Force one direction's payload into the exact shape the viewer renders.
function normalizeDirection(raw) {
    const d = raw && typeof raw === "object" ? raw : {};
    const out = {};
    for (const f of DIRECTION_FIELDS) out[f] = asText(d[f]);
    const list = Array.isArray(d.features) ? d.features : d.features ? [d.features] : [];
    out.features = list
        .map((f) => (typeof f === "string"
            ? { label: f.trim(), note: "" }
            : { label: asText(f && f.label), note: asText(f && f.note) }))
        .filter((f) => f.label || f.note);
    return out;
}

// Occasionally the model returns an empty body on a face it otherwise handles
// fine - HTTP 200, no content, no token counts. Retrying with a slightly
// warmer sample almost always succeeds, so one node is not lost to a blip.
async function ollamaChat(be, opts) {
    try {
        return await ollamaChatOnce(be, opts);
    } catch (err) {
        if (!/returned nothing/.test(err.message)) throw err;
        return await ollamaChatOnce(be, { ...opts, temperature: 0.5 });
    }
}

async function ollamaChatOnce(be, { prompt, images, timeout, temperature }) {
    const message = { role: "user", content: prompt };
    if (images && images.length) message.images = images;
    let res;
    try {
        res = await fetch(be.url, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
                model: be.model,
                messages: [message],
                stream: false,
                format: "json",
                // Hold the model in VRAM across the six calls; reloading it per
                // face would dominate the runtime.
                keep_alive: "10m",
                options: {
                    temperature: typeof temperature === "number" ? temperature : 0.2,
                    // Typical replies are 400-600 tokens, but the most verbose
                    // ones run past 900 and get cut off mid-object, which
                    // surfaces as "Expected ',' or '}' ... at position 2515"
                    // rather than as a truncation. Headroom is cheap: the cap
                    // only costs anything when it is actually reached.
                    num_predict: Number(process.env.TACGRID_VLM_NUM_PREDICT) || 1600,
                    // A 1024px face is ~1800 tokens on its own, so prompt +
                    // image + reply does not fit Ollama's 4096 default, and on
                    // overflow it returns an empty string rather than an error.
                    // 8192 is measured to be sufficient - a controlled test at
                    // 8192 vs 16384 produced no empty replies at either.
                    num_ctx: Number(process.env.TACGRID_VLM_NUM_CTX) || 8192
                }
            }),
            signal: AbortSignal.timeout(timeout)
        });
    } catch (err) {
        if (/timed out|aborted|TimeoutError/i.test(err.message || "")) {
            throw new Error(`Local model timed out after ${Math.round(timeout / 1000)}s. Is ${be.model} loaded?`);
        }
        throw new Error(`Cannot reach Ollama at ${be.url}. Is it running? (${err.message})`);
    }
    if (!res.ok) {
        const body = await res.text().catch(() => "");
        if (res.status === 404) {
            throw new Error(`Model "${be.model}" not found in Ollama. Pull it with: ollama pull ${be.model}`);
        }
        throw new Error(`Ollama returned ${res.status}. ${body.slice(0, 200)}`);
    }
    const data = await res.json();
    if (data.error) throw new Error(String(data.error).slice(0, 200));
    const content = (data.message && data.message.content) || "";
    // An empty reply means the request overflowed the context window: Ollama
    // returns 200 with no content and no token counts. Left unchecked this
    // writes a blank analysis to cache and looks like a bad model rather than
    // a config problem, so fail loudly instead.
    if (!content.trim()) {
        // Measured cause: another request was hitting Ollama at the same time.
        // The model occupies ~6.4 GB of an 8 GB card, so a concurrent request
        // cannot allocate and comes back HTTP 200 with an empty body. Running
        // one request at a time makes this disappear entirely (0 empties in a
        // controlled run vs 58% of nodes failing during a contended batch).
        // Context size is NOT the cause - tested at 8192 and 16384 alike.
        throw new Error(
            "Model returned nothing for this view - usually another request was using the GPU at the same time. Run analysis one at a time."
        );
    }
    return content;
}

// Ollama degrades after sustained batch load: it starts returning HTTP 200
// with an empty body and never recovers on its own. Measured over a 46-node
// run - 13 fine, then 29 consecutive failures - and a restart fixed it
// immediately (4/4 straight after). Asking it to unload the model frees the
// VRAM through the official API and the next request loads a fresh instance,
// which avoids killing processes from inside the app.
async function resetModel(be) {
    const target = be || backend();
    if (target.name !== "ollama") return false;
    try {
        await fetch(target.url, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ model: target.model, messages: [], keep_alive: 0 }),
            signal: AbortSignal.timeout(30000)
        });
        // Give the runner a moment to actually release the card.
        await new Promise((r) => setTimeout(r, 5000));
        return true;
    } catch {
        return false;
    }
}

async function callOllama(be, allFaces, onProgress) {
    const directions = {};
    const failures = [];
    const perFaceTimeout = Number(process.env.TACGRID_VLM_TIMEOUT_MS) || 300000;

    // "up" is sky and "down" is the tripod nadir patch, so both cost a third of
    // the runtime to describe nothing tactically useful. Set TACGRID_VLM_FACES
    // to a comma-separated list to change which are analysed.
    const wanted = (process.env.TACGRID_VLM_FACES || "front,right,back,left")
        .split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
    const faces = allFaces.filter((f) => wanted.includes(f.direction));
    if (!faces.length) throw new Error(`No faces left to analyse (TACGRID_VLM_FACES=${wanted.join(",")}).`);

    for (let i = 0; i < faces.length; i++) {
        const f = faces[i];
        if (onProgress) onProgress(`${f.direction} (${i + 1}/${faces.length})`);
        // The request must be inside the try as well as the parse. Previously
        // only the parse was guarded, so a single face erroring threw straight
        // out and lost the whole node - and with a per-face failure rate of p,
        // a four-face node fails at 1-(1-p)^4, which turned a 20% face problem
        // into a 58% node problem.
        try {
            const text = await ollamaChat(be, {
                prompt: DIRECTION_PROMPT(f.direction),
                images: [f.b64],
                timeout: perFaceTimeout
            });
            directions[f.direction] = normalizeDirection(extractJson(text));
        } catch (err) {
            failures.push(`${f.direction}: ${err.message}`);
        }
    }

    // Salvage whatever succeeded, but never cache a node that produced nothing
    // - a blank analysis in the viewer is worse than an honest failure.
    if (!Object.keys(directions).length) {
        throw new Error(`No view could be analysed. ${failures[0] || ""}`.trim());
    }

    const digest = Object.entries(directions)
        .map(([d, v]) => `${d.toUpperCase()}: ${v.summary || ""} Routes: ${v.routes || "-"} Hidden: ${v.blindSpots || "-"}`)
        .join("\n");
    let overall = "";
    try {
        if (onProgress) onProgress("overall summary");
        overall = asText(extractJson(await ollamaChat(be, {
            prompt: `${OVERALL_PROMPT}\n\n${digest}`,
            timeout: perFaceTimeout
        })).overall);
    } catch {
        overall = "";
    }
    if (!overall) overall = digest.slice(0, 600);

    // Record partial coverage so a half-analysed node is visibly half-analysed
    // rather than quietly passing as complete.
    const result = { overall, directions, model: be.model };
    if (failures.length) {
        result.incompleteViews = failures.length;
        result.viewErrors = failures;
    }
    return result;
}

async function analyzeNode(project, folder, nodeId, onProgress) {
    const be = backend();
    if (!be) throw new Error("No vision backend configured.");
    const faces = await stitchFaces(project, folder, nodeId);
    const result =
        be.name === "ollama" ? await callOllama(be, faces, onProgress) :
        be.name === "google" ? await callGoogle(be, faces) :
        (be.name === "openai" || be.name === "openrouter") ? await callOpenAICompat(be, faces) :
        await callAnthropic(be, faces);
    saveAnalysis(project, folder, nodeId, result);
    return getAnalysis(project, folder, nodeId);
}

module.exports = { getAnalysis, saveAnalysis, analyzeNode, clearTour, keyConfigured, backend, resetModel };
