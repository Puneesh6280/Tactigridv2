// Real-world coordinates for panorama nodes, plus admin-placed annotation
// pins.
//
// IMPORTANT: this is deliberately stored OUTSIDE the tour folder. Re-uploading
// a scan replaces the whole extracted directory (including pano.xml), so
// anything written in there would be destroyed. Keeping geo data in a sidecar
// keyed by project/folder/nodeId means placement work survives re-uploads -
// node ids are stable across Pano2VR exports of the same tour.

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const geoFilePath = path.join(__dirname, "geodata.json");

function readAll() {
  if (!fs.existsSync(geoFilePath)) return {};
  try {
    return JSON.parse(fs.readFileSync(geoFilePath, "utf8"));
  } catch {
    return {};
  }
}

function writeAll(data) {
  fs.writeFileSync(geoFilePath, JSON.stringify(data, null, 2));
}

const keyFor = (project, folder) => `${project}/${folder}`;

function getGeo(project, folder) {
  const entry = readAll()[keyFor(project, folder)] || {};
  return { nodes: entry.nodes || {}, pins: entry.pins || [] };
}

function isValidLatLon(lat, lon) {
  return (
    Number.isFinite(lat) && Number.isFinite(lon) &&
    lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180
  );
}

// Passing null coordinates clears a node's placement.
function setNodeCoords(project, folder, nodeId, lat, lon) {
  const all = readAll();
  const key = keyFor(project, folder);
  const entry = all[key] || { nodes: {}, pins: [] };

  if (lat === null || lon === null) {
    delete entry.nodes[nodeId];
  } else {
    if (!isValidLatLon(lat, lon)) throw new Error("Invalid coordinates.");
    entry.nodes[nodeId] = { lat, lon };
  }

  all[key] = entry;
  writeAll(all);
  return entry.nodes;
}

function addPin(project, folder, { lat, lon, title, description, kind }) {
  if (!isValidLatLon(lat, lon)) throw new Error("Invalid coordinates.");
  const clean = String(title || "").trim();
  if (!clean) throw new Error("Pin needs a title.");

  const all = readAll();
  const key = keyFor(project, folder);
  const entry = all[key] || { nodes: {}, pins: [] };

  const pin = {
    id: crypto.randomBytes(8).toString("hex"),
    lat,
    lon,
    title: clean,
    description: String(description || "").trim(),
    kind: kind === "hazard" || kind === "asset" ? kind : "note",
    createdAt: new Date().toISOString()
  };
  entry.pins.push(pin);
  all[key] = entry;
  writeAll(all);
  return pin;
}

function deletePin(project, folder, pinId) {
  const all = readAll();
  const key = keyFor(project, folder);
  const entry = all[key];
  if (!entry) return false;

  const before = entry.pins.length;
  entry.pins = entry.pins.filter((p) => p.id !== pinId);
  if (entry.pins.length === before) return false;

  all[key] = entry;
  writeAll(all);
  return true;
}

// Drops everything for a tour - called when a structure is deleted so stale
// coordinates don't linger and reattach to a later upload of the same name.
function clearTour(project, folder) {
  const all = readAll();
  delete all[keyFor(project, folder)];
  writeAll(all);
}

module.exports = { getGeo, setNodeCoords, addPin, deletePin, clearTour, isValidLatLon };
