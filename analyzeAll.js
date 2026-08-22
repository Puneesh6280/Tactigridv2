// Batch VLM analysis for a whole structure.
//
// Analysing a node takes about a minute on a laptop GPU, which is far too slow
// to do live in front of an audience. This walks every node that has imagery
// and analyses the ones not already cached, so a briefing runs entirely off
// warm cache. It is resumable: already-analysed nodes are skipped, so it can
// be stopped with Ctrl-C and restarted without losing work.
//
//   node analyzeAll.js "CTW" "Main Gate"             # fill in the gaps
//   node analyzeAll.js "CTW" "Main Gate" --force     # redo this model's work
//   node analyzeAll.js "CTW" "Main Gate" --force-all # redo everything, incl.
//                                                    # hand-written analyses
//   node analyzeAll.js "CTW" "Main Gate" --limit 10  # first 10 only
//   node analyzeAll.js "CTW" "Main Gate" --incomplete       # redo nodes
//                                                          # missing a view
//   node analyzeAll.js "CTW" "Main Gate" --only node151,node153
//
// Runs strictly one node at a time. A 7B vision model already occupies most of
// an 8 GB card, so issuing these concurrently would spill into system RAM and
// run slower, not faster.

const fs = require("fs");
const path = require("path");
const { getTourAnalysis } = require("./tourCache");
const vlmAnalyze = require("./vlmAnalyze");

const uploadsRoot = path.join(__dirname, "uploads");

const args = process.argv.slice(2);
const project = args[0];
const folder = args[1];
const force = args.includes("--force");
const limitArg = args.indexOf("--limit");
const limit = limitArg !== -1 ? Number(args[limitArg + 1]) : Infinity;
// Redo specific nodes: --only node151,node153
const onlyArg = args.indexOf("--only");
const only = onlyArg !== -1
    ? String(args[onlyArg + 1] || "").split(",").map((s) => s.trim()).filter(Boolean)
    : null;
// Nodes whose analysis is missing one or more views: --incomplete
const incompleteOnly = args.includes("--incomplete");

if (!project || !folder) {
    console.error('Usage: node analyzeAll.js <project> <folder> [--force] [--limit N]');
    process.exit(1);
}

const tour = getTourAnalysis(uploadsRoot, project, folder);
if (!tour) {
    console.error(`Structure not found: ${project}/${folder}`);
    process.exit(1);
}

const tilesDir = path.join(uploadsRoot, project, folder, "tiles");
const hasImagery = (nodeId) => fs.existsSync(path.join(tilesDir, nodeId));

const be = vlmAnalyze.backend();
const forceAll = args.includes("--force-all");

// --force re-analyses only what THIS model produced. Nodes carrying a
// hand-written or cloud-model analysis are worth more than a local re-run and
// must not be silently overwritten; --force-all is the explicit opt-out.
function protectedBy(existing) {
    if (!existing || forceAll) return null;
    const m = String(existing.model || "");
    return m && m !== be.model ? m : null;
}

const allNodes = Object.keys(tour.graph.nodes);
const withImagery = allNodes.filter(hasImagery);
const preserved = [];
const pending = withImagery.filter((id) => {
    const existing = vlmAnalyze.getAnalysis(project, folder, id);

    // --only and --incomplete are explicit re-analysis requests, so they
    // override the "already done" skip - but never the protection on another
    // model's work.
    if (only || incompleteOnly) {
        if (only && !only.includes(id)) return false;
        if (incompleteOnly && !(existing && existing.incompleteViews)) return false;
        const owner = protectedBy(existing);
        if (owner) { preserved.push(`${id} (${owner})`); return false; }
        return true;
    }

    if (!existing) return true;
    if (!force) return false;
    const owner = protectedBy(existing);
    if (owner) { preserved.push(`${id} (${owner})`); return false; }
    return true;
});

if (only) {
    const missing = only.filter((id) => !withImagery.includes(id));
    if (missing.length) console.log(`Warning: no imagery for ${missing.join(", ")}`);
}
const candidates = pending.slice(0, limit);

console.log(`Backend  : ${be.name} (${be.model})`);
console.log(`Structure: ${project}/${folder}`);
console.log(`Nodes    : ${allNodes.length} total, ${withImagery.length} with imagery, ${withImagery.length - pending.length} already analysed`);
console.log(`To do    : ${candidates.length}${candidates.length < pending.length ? ` (of ${pending.length} pending, capped by --limit)` : ""}`);
if (preserved.length) {
    console.log(`Preserved: ${preserved.length} node(s) from another model, not overwritten (--force-all to override)`);
    preserved.forEach((p) => console.log(`           ${p}`));
}
if (!candidates.length) process.exit(0);

let done = 0;
let failed = 0;
let consecutive = 0;
let resets = 0;
const started = Date.now();

(async () => {
    for (let i = 0; i < candidates.length; i++) {
        const nodeId = candidates[i];
        const t0 = Date.now();
        process.stdout.write(`[${done + failed + 1}/${candidates.length}] ${nodeId} ... `);
        try {
            await vlmAnalyze.analyzeNode(project, folder, nodeId);
            done++;
            consecutive = 0;
            const secs = Math.round((Date.now() - t0) / 1000);
            const avg = (Date.now() - started) / (done + failed);
            const left = Math.round((avg * (candidates.length - done - failed)) / 60000);
            console.log(`ok (${secs}s), ~${left} min remaining`);
        } catch (err) {
            failed++;
            consecutive++;
            console.log(`FAILED: ${err.message}`);
            // Ollama being down would fail every remaining node; stop early
            // rather than burn through the list producing the same error.
            if (/Cannot reach Ollama|not found in Ollama/.test(err.message)) {
                console.error("\nBackend unavailable - stopping. Fix the above and re-run to resume.");
                break;
            }
            // Ollama wedges under sustained load and then fails every node
            // until the model is reloaded. Unload it and retry this node once
            // rather than losing the rest of the run.
            if (consecutive >= 2) {
                console.log(`      ${consecutive} failures in a row - reloading the model...`);
                const ok = await vlmAnalyze.resetModel();
                resets++;
                consecutive = 0;
                if (ok) {
                    console.log(`      reloaded; retrying ${nodeId}`);
                    failed--;
                    i--; // retry the same node with a fresh model instance
                }
            }
        }
    }
    const mins = Math.round((Date.now() - started) / 60000);
    console.log(`\nDone: ${done} analysed, ${failed} failed, ${resets} model reload(s), ${mins} min total.`);
})();
