// Parses a Pano2VR pano.xml (the config inside an extracted .ggpkg tour)
// into a plain JS graph: nodes keyed by id, each with its floorplan position,
// image tile info, POI hotspots, and edges to other nodes.

function decodeXmlEntities(str) {
  return str
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(parseInt(dec, 10)))
    .replace(/&amp;/g, "&");
}

function parseAttrs(attrString) {
  const attrs = {};
  const re = /([\w-]+)\s*=\s*"([^"]*)"/g;
  let m;
  while ((m = re.exec(attrString))) {
    attrs[m[1]] = decodeXmlEntities(m[2]);
  }
  return attrs;
}

// Finds the first <tagName ...>...</tagName> or self-closing <tagName .../>
// at or after fromIndex. Returns { attrs, content, start, end } or null.
function findTag(xml, tagName, fromIndex = 0) {
  const openRe = new RegExp(`<${tagName}(\\s[^>]*)?>`, "g");
  openRe.lastIndex = fromIndex;
  const match = openRe.exec(xml);
  if (!match) return null;

  const tagStart = match.index;
  const fullOpenTag = match[0];
  const attrString = match[1] || "";
  const selfClosing = fullOpenTag.endsWith("/>");
  const attrs = parseAttrs(selfClosing ? attrString.slice(0, -1) : attrString);
  const contentStart = tagStart + fullOpenTag.length;

  if (selfClosing) {
    return { attrs, content: "", start: tagStart, end: contentStart };
  }

  const closeTag = `</${tagName}>`;
  const closeIdx = xml.indexOf(closeTag, contentStart);
  const content = closeIdx === -1 ? "" : xml.slice(contentStart, closeIdx);
  const end = closeIdx === -1 ? contentStart : closeIdx + closeTag.length;
  return { attrs, content, start: tagStart, end };
}

function findAllTags(xml, tagName) {
  const results = [];
  let idx = 0;
  for (;;) {
    const found = findTag(xml, tagName, idx);
    if (!found) break;
    results.push(found);
    idx = found.end;
  }
  return results;
}

function parsePolygon(polyhotspotContent) {
  const match = /<polystring>([\s\S]*?)<\/polystring>/.exec(polyhotspotContent);
  if (!match) return [];
  return match[1]
    .trim()
    .split("|")
    .filter(Boolean)
    .map((pair) => pair.split("/").map(Number));
}

function targetNodeFromUrl(url) {
  const match = /\{([^}]+)\}/.exec(url || "");
  return match ? match[1] : null;
}

function parseTourXml(xml) {
  const tourTag = findTag(xml, "tour");
  const tourAttrs = tourTag ? tourTag.attrs : {};
  const nodes = {};

  for (const pano of findAllTags(xml, "panorama")) {
    const id = pano.attrs.id;
    const block = pano.content;

    const input = findTag(block, "input");
    const view = findTag(block, "view");
    const start = view ? findTag(view.content, "start") : null;
    const userdata = findTag(block, "userdata");
    const mapcoords = userdata ? findTag(userdata.content, "mapcoords") : null;
    const hotspotsTag = findTag(block, "hotspots");

    const edges = [];
    const pois = [];

    if (hotspotsTag) {
      for (const poly of findAllTags(hotspotsTag.content, "polyhotspot")) {
        const targetNode = targetNodeFromUrl(poly.attrs.url);
        if (!targetNode) continue;
        edges.push({
          id: poly.attrs.id,
          title: poly.attrs.title || "",
          targetNode,
          polygon: parsePolygon(poly.content)
        });
      }

      for (const hs of findAllTags(hotspotsTag.content, "hotspot")) {
        const targetNode = targetNodeFromUrl(hs.attrs.url);
        const pan = hs.attrs.pan !== undefined ? Number(hs.attrs.pan) : null;
        const tilt = hs.attrs.tilt !== undefined ? Number(hs.attrs.tilt) : 0;

        if (targetNode) {
          edges.push({ id: hs.attrs.id, title: hs.attrs.title || "", targetNode, pan, tilt });
        } else {
          pois.push({
            id: hs.attrs.id,
            skin: hs.attrs.skinid || "",
            title: hs.attrs.title || "",
            description: hs.attrs.description || "",
            pan,
            tilt
          });
        }
      }
    }

    nodes[id] = {
      id,
      image: {
        width: input ? Number(input.attrs.width) : null,
        height: input ? Number(input.attrs.height) : null,
        tileUrlTemplate: input ? input.attrs.leveltileurl : null
      },
      view: start
        ? { pan: Number(start.attrs.pan), tilt: Number(start.attrs.tilt), fov: Number(start.attrs.fov) }
        : null,
      title: userdata ? userdata.attrs.title || "" : "",
      description: userdata ? userdata.attrs.description || "" : "",
      floorplan: mapcoords
        ? {
            mapId: mapcoords.attrs.mapid,
            xPercent: Number(mapcoords.attrs.x_floorplan_percent),
            yPercent: Number(mapcoords.attrs.y_floorplan_percent),
            x: Number(mapcoords.attrs.x),
            y: Number(mapcoords.attrs.y)
          }
        : null,
      edges,
      pois
    };
  }

  const floorplans = findAllTags(xml, "map").map((m) => ({
    id: m.attrs.id,
    width: Number(m.attrs.width),
    height: Number(m.attrs.height)
  }));

  return {
    startNode: tourAttrs.start || null,
    appVersion: tourAttrs.appversion || null,
    nodes,
    floorplans
  };
}

module.exports = { parseTourXml };
