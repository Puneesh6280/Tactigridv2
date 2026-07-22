// Pulls the human-readable, navigable locations out of a parsed tour graph
// (see panoParser.js) - the info hotspots that carry a real place name
// ("Charlie Block", "Rear Gate", "Sentry Post", ...) rather than a directional
// label like "Towards Charlie Block" (which just marks which way to walk from
// wherever that hotspot happens to be, not the place itself).

// node56 has no self-titled POI, but every "Towards Main Gate" edge in this
// tour converges on it and it has no outgoing "towards gate" edge of its own
// - confirmed by inspecting pano.xml directly, not auto-detected.
const MANUAL_OVERRIDES = {
  node56: "Main Gate"
};

function extractNamedLocations(graph, positions) {
  const locations = [];
  // A single node can legitimately carry more than one name (e.g. node56 is
  // both the "Sentry Post" info marker AND the Main Gate override) - only
  // dedupe on the exact (nodeId, name) pair, not the node alone.
  const seenPairs = new Set();

  const addLocation = (nodeId, name, inferred) => {
    const key = `${nodeId}::${name}`;
    if (seenPairs.has(key)) return;
    seenPairs.add(key);
    locations.push({ nodeId, name, inferred });
  };

  for (const [nodeId, node] of Object.entries(graph.nodes)) {
    for (const poi of node.pois) {
      if (poi.skin === "ht_info" && poi.title) addLocation(nodeId, poi.title, false);
    }
  }

  for (const [nodeId, name] of Object.entries(MANUAL_OVERRIDES)) {
    if (graph.nodes[nodeId]) addLocation(nodeId, name, true);
  }

  // Two different nodes can share the same place name (e.g. "Eklavya Mess"
  // is tagged from two different vantage points) - disambiguate those in
  // the display label so a dropdown/list doesn't show identical entries.
  const nameCounts = new Map();
  for (const loc of locations) nameCounts.set(loc.name, (nameCounts.get(loc.name) || 0) + 1);

  return locations
    .map((loc) => {
      const pos = positions[loc.nodeId] || {};
      const displayName = nameCounts.get(loc.name) > 1 ? `${loc.name} (${loc.nodeId})` : loc.name;
      return {
        ...loc,
        displayName,
        xPercent: pos.xPercent ?? null,
        yPercent: pos.yPercent ?? null,
        estimatedPosition: pos.estimated ?? null
      };
    })
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
}

module.exports = { extractNamedLocations };
