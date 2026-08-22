// Pano2VR exports that were hand-edited to add the drawing-tools overlay
// end up creating the player TWICE: once in the export's own bootstrap
// (which reads the "#nodeId" URL hash to pick a start node), and again in
// the appended <script> for the fabric.js canvas. The second instance
// overwrites the first and ignores the hash, so deep-linking to a specific
// start point silently lands on the wrong node.
//
// This strips the duplicate instantiation after extraction so uploaded
// tours support "?/index.html#node56" style start points. The drawing tools
// keep working - they just reference the single remaining player.

const fs = require("fs");
const path = require("path");

const DUPLICATE_PLAYER = /\n\s*const pano = new pano2vrPlayer\("container"\);\s*\n\s*const skin = new pano2vrSkin\(pano\);\s*\n\s*pano\.readConfigUrl\("pano\.xml"\);\s*\n/;

// Pano2VR exports often bundle the source package (.ggpkg) and the editable
// project file (.p2vr) alongside the viewer. Because uploads/ is served as
// static files, leaving them in place lets anyone download the complete raw
// survey of a site. Nothing in the viewer reads them, so they are removed.
function stripSourceFiles(tourDir) {
  const removed = [];
  for (const entry of fs.readdirSync(tourDir)) {
    if (/\.(ggpkg|p2vr)$/i.test(entry)) {
      fs.rmSync(path.join(tourDir, entry), { force: true });
      removed.push(entry);
    }
  }
  return removed;
}

// Injects the tactical-scene panel script into the viewer. The tour HTML is
// regenerated on every upload, so this must be re-applied each time rather
// than edited in by hand.
const SCENE_TAG = '<script src="/tacgrid-scene.js"></script>';
function injectSceneScript(html) {
  if (html.includes("/tacgrid-scene.js")) return html;
  if (html.includes("</body>")) return html.replace("</body>", `${SCENE_TAG}\n</body>`);
  return html + `\n${SCENE_TAG}\n`;
}

function patchExtractedTour(tourDir) {
  const removedSources = stripSourceFiles(tourDir);

  const indexPath = path.join(tourDir, "index.html");
  if (!fs.existsSync(indexPath)) return { patched: false, removedSources, reason: "no index.html" };

  let html = fs.readFileSync(indexPath, "utf8");
  const before = html;
  const instances = (html.match(/new pano2vrPlayer\(/g) || []).length;

  // Only intervene on the duplicate player when there really are two; a clean
  // export needs no patching, and 3+ means something unexpected.
  let playerPatched = false;
  if (instances === 2 && DUPLICATE_PLAYER.test(html)) {
    html = html.replace(DUPLICATE_PLAYER, "\n");
    playerPatched = true;
  }

  html = injectSceneScript(html);

  if (html !== before) fs.writeFileSync(indexPath, html);
  return { patched: playerPatched, sceneInjected: true, removedSources };
}

module.exports = { patchExtractedTour, stripSourceFiles, injectSceneScript };
