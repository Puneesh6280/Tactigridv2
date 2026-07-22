/*
 * Tactical scene panel, injected into the Pano2VR tour viewer.
 *
 * Shows the VLM analysis for the node you are standing in, and follows where
 * you are looking: as you pan around, the panel switches to the analysis for
 * that direction (front/right/back/left/up/down). Read-only - analysis is run
 * from the dashboard.
 *
 * The tour HTML is regenerated on every upload, so this file is NOT edited into
 * it directly; patchTour.js injects a <script> tag pointing here on upload.
 */
(function () {
  "use strict";

  // /uploads/<project>/<folder>/index.html  ->  { project, folder }
  function context() {
    const m = decodeURIComponent(location.pathname).match(/\/uploads\/([^/]+)\/([^/]+)\//);
    return m ? { project: m[1], folder: m[2] } : null;
  }

  const ctx = context();
  if (!ctx) return;

  const DIRECTIONS = ["front", "right", "back", "left", "up", "down"];
  let panelEl, bodyEl, dirTabsEl, statusEl;
  let analysisCache = {}; // nodeId -> analysis | false (unanalyzed) | null (error)
  let currentNode = null;
  let activeDir = "front";
  let pinnedDir = null; // set when the user clicks a direction tab
  let collapsed = false;

  function buildPanel() {
    const style = document.createElement("style");
    style.textContent = `
      #tg-scene{position:fixed;top:70px;left:14px;z-index:10050;width:320px;max-width:calc(100vw - 28px);
        max-height:calc(100vh - 120px);display:flex;flex-direction:column;
        background:rgba(9,14,12,.92);border:1px solid rgba(46,230,161,.45);border-radius:8px;
        color:#eaf5ef;font-family:'Segoe UI',system-ui,sans-serif;font-size:13px;
        box-shadow:0 8px 30px rgba(0,0,0,.5);backdrop-filter:blur(6px);overflow:hidden}
      #tg-scene .tg-head{display:flex;align-items:center;justify-content:space-between;gap:8px;
        padding:9px 11px;background:rgba(46,230,161,.10);border-bottom:1px solid rgba(46,230,161,.25);cursor:pointer}
      #tg-scene .tg-head b{font-family:'Consolas',monospace;font-size:11px;letter-spacing:.12em;color:#2ee6a1}
      #tg-scene .tg-toggle{color:#8aa39a;font-family:monospace}
      #tg-scene .tg-tabs{display:flex;flex-wrap:wrap;gap:4px;padding:8px 10px 0}
      #tg-scene .tg-tabs button{flex:1 0 30%;padding:5px 4px;background:transparent;border:1px solid rgba(46,230,161,.2);
        color:#8aa39a;font-family:monospace;font-size:10px;letter-spacing:.06em;border-radius:4px;cursor:pointer;text-transform:uppercase}
      #tg-scene .tg-tabs button.on{border-color:rgba(46,230,161,.55);color:#2ee6a1;background:rgba(46,230,161,.12)}
      #tg-scene .tg-tabs button:disabled{opacity:.3;cursor:default}
      #tg-scene .tg-body{padding:10px 12px;overflow-y:auto}
      #tg-scene .tg-status{color:#8aa39a;font-family:monospace;font-size:11px}
      #tg-scene .tg-summary{margin:0 0 10px;line-height:1.5}
      #tg-scene .tg-dirname{font-family:monospace;font-size:10px;letter-spacing:.1em;color:#2ee6a1;margin-bottom:5px}
      #tg-scene .tg-feat{margin:0 0 9px;padding-left:0;list-style:none}
      #tg-scene .tg-feat li{margin-bottom:5px;line-height:1.4}
      #tg-scene .tg-feat b{color:#eaf5ef}
      #tg-scene .tg-feat span{color:#8aa39a}
      #tg-scene .tg-tac{display:grid;grid-template-columns:auto 1fr;gap:3px 8px;font-size:12px;margin-top:8px;
        border-top:1px solid rgba(46,230,161,.15);padding-top:8px}
      #tg-scene .tg-tac dt{font-family:monospace;font-size:10px;letter-spacing:.05em;color:#ffb454;text-transform:uppercase}
      #tg-scene .tg-tac dd{margin:0;color:#cfe0d8;line-height:1.35}
      #tg-scene.tg-collapsed .tg-tabs,#tg-scene.tg-collapsed .tg-body{display:none}
      #tg-scene .tg-note{margin-top:9px;font-size:10.5px;color:#6f857c;font-style:italic}
    `;
    document.head.appendChild(style);

    panelEl = document.createElement("div");
    panelEl.id = "tg-scene";
    panelEl.innerHTML =
      '<div class="tg-head"><b>TACTICAL SCENE</b><span class="tg-toggle">[-]</span></div>' +
      '<div class="tg-tabs"></div>' +
      '<div class="tg-body"><div class="tg-status">Loading…</div></div>';
    document.body.appendChild(panelEl);

    dirTabsEl = panelEl.querySelector(".tg-tabs");
    bodyEl = panelEl.querySelector(".tg-body");
    statusEl = panelEl.querySelector(".tg-status");

    panelEl.querySelector(".tg-head").addEventListener("click", () => {
      collapsed = !collapsed;
      panelEl.classList.toggle("tg-collapsed", collapsed);
      panelEl.querySelector(".tg-toggle").textContent = collapsed ? "[+]" : "[-]";
    });

    DIRECTIONS.forEach((d) => {
      const b = document.createElement("button");
      b.textContent = d;
      b.dataset.dir = d;
      b.addEventListener("click", () => {
        pinnedDir = d;
        activeDir = d;
        render();
      });
      dirTabsEl.appendChild(b);
    });
  }

  async function fetchAnalysis(nodeId) {
    if (nodeId in analysisCache) return analysisCache[nodeId];
    try {
      const r = await fetch(
        `/api/tours/${encodeURIComponent(ctx.project)}/${encodeURIComponent(ctx.folder)}/analysis/${encodeURIComponent(nodeId)}`,
        { credentials: "same-origin" }
      );
      if (r.status === 401) { analysisCache[nodeId] = "auth"; return "auth"; }
      const d = await r.json();
      analysisCache[nodeId] = d.success && d.analyzed ? d.analysis : false;
    } catch {
      analysisCache[nodeId] = null;
    }
    return analysisCache[nodeId];
  }

  // Map the current look direction to one of the six faces.
  function lookDirection() {
    if (pinnedDir) return pinnedDir;
    try {
      const tilt = typeof pano.getTilt === "function" ? pano.getTilt() : 0;
      if (tilt > 45) return "up";
      if (tilt < -45) return "down";
      let pan = typeof pano.getPan === "function" ? pano.getPan() : 0;
      pan = ((pan % 360) + 360) % 360;
      return ["front", "right", "back", "left"][Math.round(pan / 90) % 4];
    } catch {
      return "front";
    }
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  }

  function render() {
    const a = analysisCache[currentNode];

    if (a === "auth") { statusEl.textContent = "Sign in on the dashboard to see analysis."; setBodyStatus(); return; }
    if (a === undefined) { statusEl.textContent = "Loading…"; setBodyStatus(); return; }
    if (a === null) { statusEl.textContent = "Could not load analysis."; setBodyStatus(); return; }
    if (a === false) { statusEl.textContent = "This point has not been analyzed yet."; setBodyStatus(); return; }

    const dirs = a.directions || {};
    dirTabsEl.querySelectorAll("button").forEach((b) => {
      const has = !!dirs[b.dataset.dir];
      b.disabled = !has;
      b.classList.toggle("on", b.dataset.dir === activeDir && has);
    });

    const d = dirs[activeDir];
    let html = a.overall ? `<p class="tg-summary">${esc(a.overall)}</p>` : "";
    html += `<div class="tg-dirname">LOOKING: ${activeDir.toUpperCase()}${pinnedDir ? " (pinned)" : ""}</div>`;

    if (!d) {
      html += '<div class="tg-status">Nothing notable in this direction.</div>';
    } else {
      if (d.summary) html += `<p style="margin:0 0 8px;line-height:1.5">${esc(d.summary)}</p>`;
      if (d.features && d.features.length) {
        html += '<ul class="tg-feat">';
        d.features.forEach((f) => { html += `<li><b>${esc(f.label)}</b>${f.note ? ` — <span>${esc(f.note)}</span>` : ""}</li>`; });
        html += "</ul>";
      }
      const tac = [["Cover", d.cover], ["Conceal", d.concealment], ["Blind", d.blindSpots], ["Routes", d.routes], ["Hazards", d.hazards]]
        .filter(([, v]) => v && !/^none obvious$/i.test(v));
      if (tac.length) {
        html += '<dl class="tg-tac">';
        tac.forEach(([k, v]) => { html += `<dt>${k}</dt><dd>${esc(v)}</dd>`; });
        html += "</dl>";
      }
    }
    html += '<div class="tg-note">Pan around to switch direction · click a tab to pin.</div>';
    bodyEl.innerHTML = html;
  }

  function setBodyStatus() {
    // Ensure the status element is the only body content in non-data states.
    if (!bodyEl.querySelector(".tg-status")) bodyEl.innerHTML = "";
    bodyEl.innerHTML = `<div class="tg-status">${statusEl.textContent}</div>`;
    statusEl = bodyEl.querySelector(".tg-status");
  }

  async function tick() {
    let node;
    try { node = pano.getCurrentNode && pano.getCurrentNode(); } catch { node = null; }
    if (node && node !== currentNode) {
      currentNode = node;
      pinnedDir = null;
      await fetchAnalysis(node);
      render();
    }
    const dir = lookDirection();
    if (dir !== activeDir) {
      activeDir = dir;
      if (analysisCache[currentNode] && typeof analysisCache[currentNode] === "object") render();
    }
  }

  function waitForPano() {
    if (typeof pano !== "undefined" && pano && typeof pano.getCurrentNode === "function") {
      try { if (!pano.getCurrentNode()) return setTimeout(waitForPano, 300); } catch { return setTimeout(waitForPano, 300); }
      buildPanel();
      tick();
      setInterval(tick, 400);
    } else {
      setTimeout(waitForPano, 300);
    }
  }

  if (document.readyState === "loading") {
    window.addEventListener("load", waitForPano);
  } else {
    waitForPano();
  }
})();
