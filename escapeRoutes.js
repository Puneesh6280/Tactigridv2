// Multi-source Dijkstra over the tour's node graph: given a set of "exit"
// node ids, computes the nearest exit and shortest path for every other
// node in one pass. Edge weight is the straight-line distance between each
// pair's positions (from positionEstimator.js), falling back to a weight of
// 1 (i.e. hop count) if positions aren't available for that edge.
//
// Deliberately not A*: the node positions here are estimates (see
// positionEstimator.js), not measured distances, so they aren't a safe
// admissible heuristic. At this graph size (~100 nodes) Dijkstra is just as
// fast and stays guaranteed-correct.

function buildWeightedAdjacency(graph, positions) {
  const adj = new Map();
  for (const id of Object.keys(graph.nodes)) adj.set(id, new Map());

  for (const [id, node] of Object.entries(graph.nodes)) {
    for (const edge of node.edges) {
      const target = edge.targetNode;
      if (!graph.nodes[target]) continue;

      const posA = positions[id];
      const posB = positions[target];
      let weight = 1;
      if (posA && posB && posA.x !== null && posB.x !== null) {
        weight = Math.hypot(posA.x - posB.x, posA.y - posB.y) || 1e-9;
      }

      const existingAB = adj.get(id).get(target);
      if (existingAB === undefined || weight < existingAB) adj.get(id).set(target, weight);
      const existingBA = adj.get(target).get(id);
      if (existingBA === undefined || weight < existingBA) adj.get(target).set(id, weight);
    }
  }

  return adj;
}

// Simple O(n^2) Dijkstra - fine for graphs of this size (no binary heap needed).
function multiSourceDijkstra(adj, sourceIds) {
  const dist = new Map();
  const nearestExit = new Map();
  const prevNode = new Map();
  const visited = new Set();

  for (const s of sourceIds) {
    if (!adj.has(s)) continue;
    dist.set(s, 0);
    nearestExit.set(s, s);
  }

  for (;;) {
    let u = null;
    let best = Infinity;
    for (const [id, d] of dist) {
      if (!visited.has(id) && d < best) { best = d; u = id; }
    }
    if (u === null) break;
    visited.add(u);

    for (const [v, w] of adj.get(u) || []) {
      const candidate = best + w;
      if (!dist.has(v) || candidate < dist.get(v)) {
        dist.set(v, candidate);
        nearestExit.set(v, nearestExit.get(u));
        prevNode.set(v, u);
      }
    }
  }

  return { dist, nearestExit, prevNode };
}

// Returns the path as [nodeId, ..., exit] - walking directions from the
// queried node out to its nearest exit.
function reconstructPath(prevNode, nodeId) {
  const path = [nodeId];
  let cur = nodeId;
  while (prevNode.has(cur)) {
    cur = prevNode.get(cur);
    path.push(cur);
  }
  return path;
}

function computeEscapeRoutes(graph, positions, exitNodeIds) {
  const validExits = exitNodeIds.filter((id) => graph.nodes[id]);
  const invalidExits = exitNodeIds.filter((id) => !graph.nodes[id]);

  if (validExits.length === 0) {
    return { routes: {}, exitNodeIds: [], invalidExits, warning: "No valid exit node ids provided." };
  }

  const adj = buildWeightedAdjacency(graph, positions);
  const { dist, nearestExit, prevNode } = multiSourceDijkstra(adj, validExits);

  const routes = {};
  for (const id of Object.keys(graph.nodes)) {
    if (validExits.includes(id)) {
      routes[id] = { distance: 0, nearestExit: id, path: [id], isExit: true };
      continue;
    }
    if (!dist.has(id)) {
      routes[id] = { distance: null, nearestExit: null, path: null, unreachable: true };
      continue;
    }
    routes[id] = {
      distance: dist.get(id),
      nearestExit: nearestExit.get(id),
      path: reconstructPath(prevNode, id)
    };
  }

  return { routes, exitNodeIds: validExits, invalidExits };
}

module.exports = { computeEscapeRoutes };
