// Runs the Python YOLO detector for a node and caches the result.
//
// Detection is slow-ish on CPU (~15 s for a node's six faces), but a node's
// imagery never changes unless the scan is re-uploaded, so each result is
// cached in a sidecar keyed by project/folder/nodeId. The cache is dropped
// for a tour when it is re-uploaded or deleted.
//
// The Python executable is taken from TACTIGRID_PYTHON, falling back to
// "python" on PATH. numpy + opencv-python must be importable there; no
// torch/ultralytics needed.

const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");

const sceneFilePath = path.join(__dirname, "scenedata.json");
const detectorPath = path.join(__dirname, "detector.py");
const modelPath = path.join(__dirname, "models", "yolov8n.onnx");
const PYTHON = process.env.TACTIGRID_PYTHON || "python";
const uploadsRoot = path.join(__dirname, "uploads");

function readAll() {
  if (!fs.existsSync(sceneFilePath)) return {};
  try {
    return JSON.parse(fs.readFileSync(sceneFilePath, "utf8"));
  } catch {
    return {};
  }
}

function writeAll(data) {
  fs.writeFileSync(sceneFilePath, JSON.stringify(data, null, 2));
}

const key = (project, folder) => `${project}/${folder}`;

function getScene(project, folder, nodeId) {
  const tour = readAll()[key(project, folder)];
  return tour && tour[nodeId] ? tour[nodeId] : null;
}

function getAllScenes(project, folder) {
  return readAll()[key(project, folder)] || {};
}

function saveScene(project, folder, nodeId, result) {
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

function modelAvailable() {
  return fs.existsSync(modelPath);
}

// Resolves with the detector's parsed JSON, or rejects with a clear message.
function runDetector(project, folder, nodeId) {
  return new Promise((resolve, reject) => {
    const nodeDir = path.join(uploadsRoot, path.basename(project), path.basename(folder), "tiles", path.basename(nodeId));
    if (!fs.existsSync(nodeDir)) return reject(new Error(`No imagery for ${nodeId}.`));
    if (!modelAvailable()) return reject(new Error("Detection model is missing (models/yolov8n.onnx)."));

    execFile(
      PYTHON,
      [detectorPath, nodeDir, modelPath],
      { timeout: 120000, maxBuffer: 8 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err && !stdout) {
          const hint = /ENOENT/.test(err.message)
            ? `Python not found. Set TACTIGRID_PYTHON to your python.exe path.`
            : (stderr || err.message);
          return reject(new Error(hint));
        }
        let parsed;
        try {
          parsed = JSON.parse(stdout.trim().split("\n").pop());
        } catch {
          return reject(new Error("Detector returned unreadable output."));
        }
        if (!parsed.ok) return reject(new Error(parsed.error || "Detection failed."));
        resolve(parsed);
      }
    );
  });
}

async function analyzeNode(project, folder, nodeId) {
  const result = await runDetector(project, folder, nodeId);
  saveScene(project, folder, nodeId, result);
  return getScene(project, folder, nodeId);
}

module.exports = { getScene, getAllScenes, analyzeNode, clearTour, modelAvailable, PYTHON };
