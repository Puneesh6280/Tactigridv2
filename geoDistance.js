// Distances in real metres, once nodes have been placed on the map.
//
// This does NOT replace the hotspot graph with an external routing engine.
// The 282 hotspot links were created by walking the site, so they are ground
// truth for which places actually connect - better than any generic path
// network would be for a closed campus. What was missing was the length of
// each link, and real coordinates supply exactly that.
//
// So: same graph, same Dijkstra, but every edge is now weighted by the true
// ground distance between its two endpoints instead of a hop count.

const EARTH_RADIUS_M = 6371008.8;

function haversineMetres(a, b) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

function buildAdjacency(graph) {
  const adj = new Map();
  for (const id of Object.keys(graph.nodes)) adj.set(id, new Set());
  for (const [id, node] of Object.entries(graph.nodes)) {
    for (const edge of node.edges) {
      if (!adj.has(edge.targetNode)) continue;
      adj.get(id).add(edge.targetNode);
      adj.get(edge.targetNode).add(id);
    }
  }
  return adj;
}

function coverage(graph, nodeCoords) {
  const ids = Object.keys(graph.nodes);
  const placed = ids.filter((id) => nodeCoords[id]);
  return { placed: placed.length, total: ids.length };
}

// Walks the graph from `fromId` to `toId`, summing real ground distance.
// Any edge with an unplaced endpoint makes the total unmeasurable, so those
// edges are skipped and the caller is told the route isn't fully surveyed
// rather than being handed a confidently wrong number.
function routeMetres(graph, nodeCoords, fromId, toId) {
  if (!graph.nodes[fromId]) return { error: `Unknown origin node: ${fromId}` };
  if (!graph.nodes[toId]) return { error: `Unknown destination node: ${toId}` };
  if (!nodeCoords[fromId]) return { error: "The starting point has not been placed on the map yet." };
  if (!nodeCoords[toId]) return { error: "That destination has not been placed on the map yet." };

  if (fromId === toId) {
    return { metres: 0, straightLineMetres: 0, path: [fromId], hops: 0 };
  }

  const adj = buildAdjacency(graph);
  const dist = new Map([[fromId, 0]]);
  const prev = new Map();
  const visited = new Set();

  for (;;) {
    let current = null;
    let best = Infinity;
    for (const [id, d] of dist) {
      if (!visited.has(id) && d < best) { best = d; current = id; }
    }
    if (current === null || current === toId) break;
    visited.add(current);

    for (const neighbour of adj.get(current) || []) {
      const a = nodeCoords[current];
      const b = nodeCoords[neighbour];
      if (!a || !b) continue; // unsurveyed leg - can't measure it
      const candidate = best + haversineMetres(a, b);
      if (!dist.has(neighbour) || candidate < dist.get(neighbour)) {
        dist.set(neighbour, candidate);
        prev.set(neighbour, current);
      }
    }
  }

  if (!dist.has(toId)) {
    return { error: "No fully-placed route connects those two points yet." };
  }

  const path = [toId];
  let cur = toId;
  while (prev.has(cur)) {
    cur = prev.get(cur);
    path.push(cur);
  }
  path.reverse();

  return {
    metres: dist.get(toId),
    straightLineMetres: haversineMetres(nodeCoords[fromId], nodeCoords[toId]),
    path,
    hops: path.length - 1
  };
}

module.exports = { haversineMetres, routeMetres, coverage };
