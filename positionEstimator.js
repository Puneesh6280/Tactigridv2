// Backfills a floorplan position for every node in a parsed pano.xml graph
// (see panoParser.js), even though only a handful of nodes carry real
// <mapcoords>. Panorama "pan" angles turned out NOT to be usable as compass
// bearings here (verified against the known anchor nodes: the offset between
// recorded pan and real-world angle is inconsistent between anchor pairs,
// e.g. ~180 deg for one pair and ~100 deg for another), so this ignores
// bearing entirely and instead estimates positions from graph topology:
//
//   1. Treat the hotspot connections as an undirected graph and compute
//      all-pairs shortest-path hop counts (BFS).
//   2. Calibrate a world-units-per-hop scale using the nodes that DO have
//      known real positions (regression through origin on hop vs. real
//      distance for every anchor pair).
//   3. Run SMACOF stress majorization (an iterative MDS technique) to find
//      2D positions whose pairwise distances best match hop-count * scale,
//      holding the known anchors fixed throughout.
//   4. Fit an affine transform from world (x, y) to floorplan percent using
//      the anchors, and apply it to every node.
//
// This is an approximation: hop count is a proxy for real distance, not an
// exact measurement, so accuracy degrades for nodes far from any anchor.
// Every returned position is tagged `estimated: true/false` so callers can
// tell backfilled positions apart from the real ones.

function buildAdjacency(nodes) {
  const adj = new Map();
  for (const id of Object.keys(nodes)) adj.set(id, new Set());
  for (const [id, node] of Object.entries(nodes)) {
    for (const edge of node.edges) {
      if (!adj.has(edge.targetNode)) continue;
      adj.get(id).add(edge.targetNode);
      adj.get(edge.targetNode).add(id);
    }
  }
  return adj;
}

function bfsHops(adj, source) {
  const dist = new Map([[source, 0]]);
  const queue = [source];
  let head = 0;
  while (head < queue.length) {
    const cur = queue[head++];
    for (const nb of adj.get(cur) || []) {
      if (!dist.has(nb)) {
        dist.set(nb, dist.get(cur) + 1);
        queue.push(nb);
      }
    }
  }
  return dist;
}

// Deterministic PRNG so repeated calls produce the same layout.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function solveLinearSystem3(A, b) {
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < 3; col++) {
    let pivot = col;
    for (let r = col + 1; r < 3; r++) {
      if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r;
    }
    [M[col], M[pivot]] = [M[pivot], M[col]];
    const pivotVal = M[col][col] || 1e-12;
    for (let r = 0; r < 3; r++) {
      if (r === col) continue;
      const factor = M[r][col] / pivotVal;
      for (let c = col; c < 4; c++) M[r][c] -= factor * M[col][c];
    }
  }
  return [M[0][3] / M[0][0], M[1][3] / M[1][1], M[2][3] / M[2][2]];
}

// Least-squares fit of u = a*x + b*y + c (and same shape for v) from points {x,y,u,v}.
function fitAffine(points) {
  let Sxx = 0, Sxy = 0, Sx = 0, Syy = 0, Sy = 0;
  let Sxu = 0, Syu = 0, Su = 0, Sxv = 0, Syv = 0, Sv = 0;
  for (const p of points) {
    Sxx += p.x * p.x; Sxy += p.x * p.y; Sx += p.x;
    Syy += p.y * p.y; Sy += p.y;
    Sxu += p.x * p.u; Syu += p.y * p.u; Su += p.u;
    Sxv += p.x * p.v; Syv += p.y * p.v; Sv += p.v;
  }
  const A = [
    [Sxx, Sxy, Sx],
    [Sxy, Syy, Sy],
    [Sx, Sy, points.length]
  ];
  const [au, bu, cu] = solveLinearSystem3(A, [Sxu, Syu, Su]);
  const [av, bv, cv] = solveLinearSystem3(A, [Sxv, Syv, Sv]);
  return {
    toPercentX: (x, y) => au * x + bu * y + cu,
    toPercentY: (x, y) => av * x + bv * y + cv
  };
}

function estimatePositions(graph, options = {}) {
  const iterations = options.iterations ?? 300;
  const seed = options.seed ?? 42;

  const nodeIds = Object.keys(graph.nodes);
  const n = nodeIds.length;
  const indexOf = new Map(nodeIds.map((id, i) => [id, i]));
  const adj = buildAdjacency(graph.nodes);

  const anchorIds = nodeIds.filter((id) => graph.nodes[id].floorplan);
  if (anchorIds.length === 0) {
    return { positions: {}, calibration: null, warning: "No floorplan anchors in this tour; cannot estimate positions." };
  }

  const hop = Array.from({ length: n }, () => new Array(n).fill(Infinity));
  for (const id of nodeIds) {
    const dist = bfsHops(adj, id);
    const i = indexOf.get(id);
    for (const [otherId, d] of dist) hop[i][indexOf.get(otherId)] = d;
  }

  // Calibrate world-units-per-hop via regression through the origin
  // (minimizes squared error of realDistance ~= scale * hops) using anchor pairs.
  let num = 0, den = 0;
  for (const a of anchorIds) {
    for (const b of anchorIds) {
      if (a === b) continue;
      const h = hop[indexOf.get(a)][indexOf.get(b)];
      if (!isFinite(h) || h === 0) continue;
      const fa = graph.nodes[a].floorplan;
      const fb = graph.nodes[b].floorplan;
      const real = Math.hypot(fb.x - fa.x, fb.y - fa.y);
      num += h * real;
      den += h * h;
    }
  }
  const scale = den > 0 ? num / den : 1;

  const target = Array.from({ length: n }, () => new Array(n).fill(null));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i !== j && isFinite(hop[i][j])) target[i][j] = hop[i][j] * scale;
    }
  }

  const rand = mulberry32(seed);
  const anchorSet = new Set(anchorIds);
  const pos = new Array(n);
  for (const id of nodeIds) {
    const i = indexOf.get(id);
    if (anchorSet.has(id)) {
      const fp = graph.nodes[id].floorplan;
      pos[i] = [fp.x, fp.y];
      continue;
    }
    let nearest = null;
    let nearestHops = Infinity;
    for (const a of anchorIds) {
      const h = hop[indexOf.get(a)][i];
      if (h < nearestHops) { nearestHops = h; nearest = a; }
    }
    if (nearest === null) {
      // unreachable from any anchor (disconnected component) - leave unresolved
      pos[i] = null;
      continue;
    }
    const fp = graph.nodes[nearest].floorplan;
    const r = nearestHops * scale;
    const angle = rand() * Math.PI * 2;
    pos[i] = [fp.x + r * Math.cos(angle), fp.y + r * Math.sin(angle)];
  }

  // SMACOF stress majorization (Guttman transform), anchors held fixed.
  // x_i_new = (1/n) * sum_{j != i} [ x_j + target_ij * (x_i - x_j) / dist_ij ]
  for (let iter = 0; iter < iterations; iter++) {
    const next = pos.map((p) => (p ? p.slice() : null));
    for (let i = 0; i < n; i++) {
      if (anchorSet.has(nodeIds[i]) || !pos[i]) continue;
      let sx = 0, sy = 0;
      for (let j = 0; j < n; j++) {
        if (i === j || !pos[j] || target[i][j] === null) continue;
        const dx = pos[i][0] - pos[j][0];
        const dy = pos[i][1] - pos[j][1];
        const dist = Math.max(Math.hypot(dx, dy), 1e-9);
        sx += pos[j][0] + (target[i][j] * dx) / dist;
        sy += pos[j][1] + (target[i][j] * dy) / dist;
      }
      next[i][0] = sx / n;
      next[i][1] = sy / n;
    }
    for (let i = 0; i < n; i++) pos[i] = next[i];
  }

  const affinePoints = anchorIds.map((id) => {
    const fp = graph.nodes[id].floorplan;
    return { x: fp.x, y: fp.y, u: fp.xPercent, v: fp.yPercent };
  });
  const affine = affinePoints.length >= 3 ? fitAffine(affinePoints) : null;

  const positions = {};
  for (const id of nodeIds) {
    const i = indexOf.get(id);
    if (!pos[i]) {
      positions[id] = { x: null, y: null, xPercent: null, yPercent: null, estimated: true, unreachableFromAnchors: true };
      continue;
    }
    const [x, y] = pos[i];
    positions[id] = {
      x,
      y,
      xPercent: affine ? affine.toPercentX(x, y) : null,
      yPercent: affine ? affine.toPercentY(x, y) : null,
      estimated: !anchorSet.has(id)
    };
  }

  return {
    positions,
    calibration: { scaleWorldUnitsPerHop: scale, anchorCount: anchorIds.length }
  };
}

module.exports = { estimatePositions };
