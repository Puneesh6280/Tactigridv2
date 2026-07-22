// Export/import of node coordinates as CSV, so a whole site can be surveyed
// offline in a spreadsheet and pasted back in one go rather than clicking
// 108 points one at a time.

const { extractNamedLocations } = require("./namedLocations");

function csvEscape(value) {
  const s = String(value ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// Named nodes come first - those are the places anyone will actually ask
// about, so they are worth surveying even if the rest is left blank.
function buildSheet(graph, layout, geoNodes) {
  const named = extractNamedLocations(graph, layout.positions);

  const rows = Object.keys(graph.nodes).map((id) => {
    const labels = named.filter((n) => n.nodeId === id).map((n) => n.displayName);
    const hints = graph.nodes[id].edges.map((e) => e.title).filter(Boolean);
    const coords = geoNodes[id];
    return {
      nodeId: id,
      label: labels.join(" / "),
      leadsTo: [...new Set(hints)].slice(0, 3).join(" | "),
      lat: coords ? coords.lat : "",
      lon: coords ? coords.lon : ""
    };
  });

  rows.sort((a, b) => {
    if (!!b.label !== !!a.label) return b.label ? 1 : -1;
    return a.nodeId.localeCompare(b.nodeId, undefined, { numeric: true });
  });
  return rows;
}

function toCsv(rows) {
  const header = ["nodeId", "label", "leadsTo", "lat", "lon"];
  const lines = [header.join(",")];
  for (const r of rows) lines.push(header.map((h) => csvEscape(r[h])).join(","));
  return lines.join("\r\n");
}

function splitCsvLine(line) {
  const out = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') inQuotes = false;
      else cur += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ",") { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

// Tolerant on purpose: column order can vary, extra columns are ignored, and
// rows with a blank lat/lon are skipped rather than treated as errors, so a
// half-finished sheet can be imported repeatedly as the survey progresses.
function parseSheet(csvText, validNodeIds) {
  const lines = String(csvText || "").split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return { rows: [], errors: ["The sheet is empty."], skipped: 0 };

  const header = splitCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
  const idx = {
    nodeId: header.indexOf("nodeid"),
    lat: header.indexOf("lat"),
    lon: header.findIndex((h) => h === "lon" || h === "lng" || h === "long")
  };

  if (idx.nodeId === -1 || idx.lat === -1 || idx.lon === -1) {
    return { rows: [], errors: ["The sheet needs nodeId, lat and lon columns."], skipped: 0 };
  }

  const rows = [];
  const errors = [];
  let skipped = 0;
  const seen = new Set();

  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]);
    const nodeId = (cells[idx.nodeId] || "").trim();
    const latRaw = (cells[idx.lat] || "").trim();
    const lonRaw = (cells[idx.lon] || "").trim();

    if (!nodeId) continue;
    if (!latRaw && !lonRaw) { skipped++; continue; }

    if (!validNodeIds.has(nodeId)) {
      errors.push(`Row ${i + 1}: "${nodeId}" is not a node in this tour.`);
      continue;
    }
    if (seen.has(nodeId)) {
      errors.push(`Row ${i + 1}: "${nodeId}" appears more than once.`);
      continue;
    }

    const lat = Number(latRaw);
    const lon = Number(lonRaw);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      errors.push(`Row ${i + 1} (${nodeId}): lat/lon must be numbers.`);
      continue;
    }
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      errors.push(`Row ${i + 1} (${nodeId}): coordinates are out of range.`);
      continue;
    }

    seen.add(nodeId);
    rows.push({ nodeId, lat, lon });
  }

  return { rows, errors, skipped };
}

module.exports = { buildSheet, toCsv, parseSheet };
