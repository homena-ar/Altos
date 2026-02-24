/**
 * graphBuilder.js — Parse SVG #streets → directed graph
 *
 * Graph structure:
 *   nodes: Map<nodeKey, {x, y}>
 *   edges: Map<nodeKey, [{to, weight, segmentId, flow, dir, special}]>
 *   segments: Map<segmentId, {startKey, endKey, flow, dir, oneway, special, el}>
 */
var GraphBuilder = (function () {
  'use strict';

  /**
   * Snap tolerance in SVG units. Points closer than this merge into one node.
   * Determined empirically: SVG viewBox is ~573×704. Street endpoints drawn
   * in Illustrator have gaps of 1–8 px at intended intersections.
   * 8 px catches 92 % of connections without merging parallel streets.
   */
  var SNAP_TOLERANCE = 8;

  /**
   * T-intersection tolerance: when an endpoint doesn't snap to any existing
   * node, check if it falls within this distance of the LINE of another
   * segment (not just its endpoints). This catches T-intersections where a
   * street ends in the middle of another street.
   */
  var T_SNAP_TOLERANCE = 6;

  var nodes = new Map();
  var edges = new Map();
  var segments = new Map();

  /* ---- Spatial index for fast snap lookup ---- */
  var gridCellSize = 0;
  var grid = {};  // "col,row" → [{key, x, y}]

  function gridKey(x, y) {
    return Math.floor(x / gridCellSize) + ',' + Math.floor(y / gridCellSize);
  }

  function gridNeighborKeys(x, y) {
    var cx = Math.floor(x / gridCellSize);
    var cy = Math.floor(y / gridCellSize);
    var keys = [];
    for (var dx = -1; dx <= 1; dx++) {
      for (var dy = -1; dy <= 1; dy++) {
        keys.push((cx + dx) + ',' + (cy + dy));
      }
    }
    return keys;
  }

  function addToGrid(key, x, y) {
    var gk = gridKey(x, y);
    if (!grid[gk]) grid[gk] = [];
    grid[gk].push({ key: key, x: x, y: y });
  }

  /** Find existing node within SNAP_TOLERANCE, or create new one */
  function snapKey(x, y) {
    var cellKeys = gridNeighborKeys(x, y);
    var bestDist = SNAP_TOLERANCE + 1;
    var bestKey = null;

    for (var c = 0; c < cellKeys.length; c++) {
      var bucket = grid[cellKeys[c]];
      if (!bucket) continue;
      for (var i = 0; i < bucket.length; i++) {
        var n = bucket[i];
        var dx = n.x - x;
        var dy = n.y - y;
        var d = Math.sqrt(dx * dx + dy * dy);
        if (d < bestDist) {
          bestDist = d;
          bestKey = n.key;
        }
      }
    }

    if (bestKey !== null) return bestKey;

    var key = x.toFixed(1) + ',' + y.toFixed(1);
    nodes.set(key, { x: x, y: y });
    addToGrid(key, x, y);
    return key;
  }

  /** Parse SVG path "d" attribute to extract ALL points (not just endpoints). */
  function parsePathPoints(d) {
    if (!d || !d.trim()) return null;
    d = d.trim();

    var points = [];
    var cx = 0, cy = 0;
    var startX = 0, startY = 0;

    var tokens = d.match(/[MmLlHhVvCcSsQqTtAaZz]|[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/g);
    if (!tokens) return null;

    var i = 0;
    var cmd = '';
    while (i < tokens.length) {
      var t = tokens[i];
      if (/^[A-Za-z]$/.test(t)) {
        cmd = t;
        i++;
        if (cmd === 'Z' || cmd === 'z') {
          cx = startX; cy = startY;
          points.push({ x: cx, y: cy });
        }
        continue;
      }

      switch (cmd) {
        case 'M':
          cx = parseFloat(tokens[i]); cy = parseFloat(tokens[i + 1]);
          startX = cx; startY = cy;
          points.push({ x: cx, y: cy });
          i += 2; cmd = 'L';
          break;
        case 'm':
          cx += parseFloat(tokens[i]); cy += parseFloat(tokens[i + 1]);
          startX = cx; startY = cy;
          points.push({ x: cx, y: cy });
          i += 2; cmd = 'l';
          break;
        case 'L':
          cx = parseFloat(tokens[i]); cy = parseFloat(tokens[i + 1]);
          points.push({ x: cx, y: cy });
          i += 2;
          break;
        case 'l':
          cx += parseFloat(tokens[i]); cy += parseFloat(tokens[i + 1]);
          points.push({ x: cx, y: cy });
          i += 2;
          break;
        case 'H':
          cx = parseFloat(tokens[i]);
          points.push({ x: cx, y: cy });
          i += 1;
          break;
        case 'h':
          cx += parseFloat(tokens[i]);
          points.push({ x: cx, y: cy });
          i += 1;
          break;
        case 'V':
          cy = parseFloat(tokens[i]);
          points.push({ x: cx, y: cy });
          i += 1;
          break;
        case 'v':
          cy += parseFloat(tokens[i]);
          points.push({ x: cx, y: cy });
          i += 1;
          break;
        case 'C':
          cx = parseFloat(tokens[i + 4]); cy = parseFloat(tokens[i + 5]);
          points.push({ x: cx, y: cy });
          i += 6;
          break;
        case 'c':
          cx += parseFloat(tokens[i + 4]); cy += parseFloat(tokens[i + 5]);
          points.push({ x: cx, y: cy });
          i += 6;
          break;
        default:
          i++;
          break;
      }
    }

    if (points.length < 2) return null;

    return {
      start: points[0],
      end: points[points.length - 1],
      allPoints: points
    };
  }

  /** Parse a polyline/line element */
  function parseLineEndpoints(el) {
    var tag = el.tagName.toLowerCase();
    if (tag === 'line') {
      var s = { x: parseFloat(el.getAttribute('x1')), y: parseFloat(el.getAttribute('y1')) };
      var e = { x: parseFloat(el.getAttribute('x2')), y: parseFloat(el.getAttribute('y2')) };
      return { start: s, end: e, allPoints: [s, e] };
    }
    if (tag === 'polyline') {
      var pts = el.getAttribute('points').trim().split(/\s+/).map(function (p) {
        var xy = p.split(',');
        return { x: parseFloat(xy[0]), y: parseFloat(xy[1]) };
      });
      if (pts.length < 2) return null;
      return { start: pts[0], end: pts[pts.length - 1], allPoints: pts };
    }
    return null;
  }

  /** Euclidean distance */
  function dist(a, b) {
    var dx = a.x - b.x;
    var dy = a.y - b.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  /**
   * Distance from point P to line segment A–B.
   * Returns { dist, projX, projY, t } where t∈[0,1] is the projection parameter.
   */
  function pointToSegmentDist(p, a, b) {
    var abx = b.x - a.x;
    var aby = b.y - a.y;
    var len2 = abx * abx + aby * aby;
    if (len2 === 0) return { dist: dist(p, a), projX: a.x, projY: a.y, t: 0 };
    var t = ((p.x - a.x) * abx + (p.y - a.y) * aby) / len2;
    t = Math.max(0, Math.min(1, t));
    var projX = a.x + t * abx;
    var projY = a.y + t * aby;
    var dx = p.x - projX;
    var dy = p.y - projY;
    return { dist: Math.sqrt(dx * dx + dy * dy), projX: projX, projY: projY, t: t };
  }

  /**
   * Detect if a segment is a special turn-restriction segment.
   * Checks data-special attribute first, then falls back to CSS class.
   * @returns {string|null} 'orange' | 'blue' | null
   */
  function detectSpecial(el) {
    var special = el.getAttribute('data-special');
    if (special === 'orange' || special === 'blue') return special;

    var cls = el.getAttribute('class') || '';
    if (cls.includes('st46')) return 'orange';
    if (cls.includes('st47')) return 'blue';
    return null;
  }

  /**
   * Build directed graph from street SVG elements.
   *
   * Phase 1: Parse all segments and snap endpoints.
   * Phase 2: T-intersection detection — for each endpoint still isolated,
   *          check if it is near the middle of another segment and create
   *          an intersection node there.
   *
   * @param {SVGElement[]} streetEls
   * @param {number} [tolerance] - snap tolerance override
   */
  function build(streetEls, tolerance) {
    if (tolerance !== undefined) SNAP_TOLERANCE = tolerance;
    gridCellSize = SNAP_TOLERANCE * 2;

    nodes.clear();
    edges.clear();
    segments.clear();
    grid = {};

    // --- Phase 1: Parse all segments, collect point data ---
    var parsed = [];  // [{id, el, endpoints, flow, dir, isOneway, special}]

    streetEls.forEach(function (el) {
      var id = el.id;
      var d = el.getAttribute('d');
      var endpoints = d ? parsePathPoints(d) : parseLineEndpoints(el);
      if (!endpoints) return;

      parsed.push({
        id: id,
        el: el,
        endpoints: endpoints,
        flow: el.getAttribute('data-flow') || 'both',
        dir: el.getAttribute('data-dir') || 'both',
        isOneway: el.getAttribute('data-oneway') === '1',
        special: detectSpecial(el)
      });
    });

    // --- Phase 2: Snap endpoints and build initial graph ---
    parsed.forEach(function (seg) {
      var startKey = snapKey(seg.endpoints.start.x, seg.endpoints.start.y);
      var endKey = snapKey(seg.endpoints.end.x, seg.endpoints.end.y);

      if (startKey === endKey) return; // zero-length

      var weight = dist(seg.endpoints.start, seg.endpoints.end);
      var segData = {
        startKey: startKey,
        endKey: endKey,
        flow: seg.flow,
        dir: seg.dir,
        oneway: seg.isOneway,
        special: seg.special,
        el: seg.el,
        allPoints: seg.endpoints.allPoints
      };
      segments.set(seg.id, segData);

      addEdgePair(seg.id, startKey, endKey, weight, seg);
    });

    // --- Phase 3: T-intersection detection ---
    // For each node, check if it is near the LINE of another segment
    // (not just endpoints). If so, split that segment and add edges.
    var segEntries = Array.from(segments.entries());

    segEntries.forEach(function (entry) {
      var segId = entry[0];
      var seg = entry[1];
      var pts = seg.allPoints;
      if (!pts || pts.length < 2) return;

      // Check all OTHER nodes against this segment's line segments
      nodes.forEach(function (node, nodeKey) {
        if (nodeKey === seg.startKey || nodeKey === seg.endKey) return;

        for (var i = 0; i < pts.length - 1; i++) {
          var res = pointToSegmentDist(node, pts[i], pts[i + 1]);
          // Only consider points that project onto the INTERIOR of the segment
          // (t between 0.05 and 0.95 to avoid snapping to endpoints)
          if (res.dist <= T_SNAP_TOLERANCE && res.t > 0.05 && res.t < 0.95) {
            // This node is near the middle of this segment — add edges
            var w1 = dist(nodes.get(seg.startKey), node);
            var w2 = dist(node, nodes.get(seg.endKey));
            addEdgePair(segId, seg.startKey, nodeKey, w1, seg);
            addEdgePair(segId, nodeKey, seg.endKey, w2, seg);
            break; // One connection per node per segment is enough
          }
        }
      });
    });

    return { nodes: nodes, edges: edges, segments: segments };
  }

  /** Add directed edge(s) based on segment direction */
  function addEdgePair(segId, startKey, endKey, weight, seg) {
    function addEdge(from, to) {
      if (!edges.has(from)) edges.set(from, []);
      // Avoid duplicate edges
      var list = edges.get(from);
      for (var i = 0; i < list.length; i++) {
        if (list[i].to === to && list[i].segmentId === segId) return;
      }
      list.push({
        to: to,
        weight: weight,
        segmentId: segId,
        flow: seg.flow,
        dir: seg.dir,
        special: seg.special
      });
    }

    if (!seg.isOneway) {
      addEdge(startKey, endKey);
      addEdge(endKey, startKey);
    } else if (seg.dir === 'forward') {
      addEdge(startKey, endKey);
    } else if (seg.dir === 'backward') {
      addEdge(endKey, startKey);
    }
  }

  /** Get the closest graph node to a given SVG point. */
  function findNearestNode(x, y, maxDist) {
    maxDist = maxDist || Infinity;
    var best = null;
    var bestD = maxDist;

    // Use grid for faster lookup
    var radius = Math.ceil(maxDist / gridCellSize) + 1;
    var cx = Math.floor(x / gridCellSize);
    var cy = Math.floor(y / gridCellSize);

    for (var dx = -radius; dx <= radius; dx++) {
      for (var dy = -radius; dy <= radius; dy++) {
        var bucket = grid[(cx + dx) + ',' + (cy + dy)];
        if (!bucket) continue;
        for (var i = 0; i < bucket.length; i++) {
          var n = bucket[i];
          var d = Math.sqrt((n.x - x) * (n.x - x) + (n.y - y) * (n.y - y));
          if (d < bestD) {
            bestD = d;
            best = n.key;
          }
        }
      }
    }

    return best;
  }

  function getSnapTolerance() { return SNAP_TOLERANCE; }
  function setSnapTolerance(v) { SNAP_TOLERANCE = v; }
  function getGraph() { return { nodes: nodes, edges: edges, segments: segments }; }

  return {
    build: build,
    findNearestNode: findNearestNode,
    getGraph: getGraph,
    getSnapTolerance: getSnapTolerance,
    setSnapTolerance: setSnapTolerance,
    dist: dist
  };
})();
