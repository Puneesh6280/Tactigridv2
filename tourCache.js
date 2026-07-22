// Parsing pano.xml and estimating node positions is expensive (a ~340 KB XML
// parse, all-pairs BFS, then 300 SMACOF iterations - around 200-290 ms), and
// it used to run on EVERY request. The result only changes when the tour is
// re-uploaded, so it is computed once and cached in memory here.
//
// Cache entries are keyed by project + folder and validated against the
// pano.xml modification time, so replacing a scan on disk (even outside the
// app) invalidates the entry automatically.

const fs = require("fs");
const path = require("path");
const { parseTourXml } = require("./panoParser");
const { estimatePositions } = require("./positionEstimator");

const cache = new Map(); // "project/folder" -> { mtimeMs, graph, layout }

function getTourAnalysis(uploadsRoot, project, folder) {
  const xmlPath = path.join(uploadsRoot, project, folder, "pano.xml");
  if (!fs.existsSync(xmlPath)) return null;

  const key = `${project}/${folder}`;
  const { mtimeMs } = fs.statSync(xmlPath);

  const cached = cache.get(key);
  if (cached && cached.mtimeMs === mtimeMs) return cached;

  const xml = fs.readFileSync(xmlPath, "utf8");
  const graph = parseTourXml(xml);
  const layout = estimatePositions(graph);

  const entry = { mtimeMs, graph, layout };
  cache.set(key, entry);
  return entry;
}

function invalidateTour(project, folder) {
  cache.delete(`${project}/${folder}`);
}

module.exports = { getTourAnalysis, invalidateTour };
