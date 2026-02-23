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

  /** Snap tolerance in SVG units. Points closer than this merge. */
  var SNAP_TOLERANCE = 2;

  var nodes = new Map();
  var edges = new Map();
  var segments = new Map();

  /** Round coordinate to snap grid */
  function snapKey(x, y) {
    // Find existing node within tolerance
    for (var entry of nodes) {
      var n = entry[1];
      var dx = n.x - x;
      var dy = n.y - y;
      if (Math.sqrt(dx * dx + dy * dy) <= SNAP_TOLERANCE) {
        return entry[0];
      }
    }
    var key = x.toFixed(1) + ',' + y.toFixed(1);
    nodes.set(key, { x: x, y: y });
    return key;
  }

  /** Parse SVG path "d" attribute to extract start and end points. */
  function parsePathEndpoints(d) {
    if (!d || !d.trim()) return null;
    d = d.trim();

    // Normalize: handle relative commands by converting to absolute coords
    var points = [];
    var cx = 0, cy = 0;
    var startX = 0, startY = 0;

    // Tokenize
    var tokens = d.match(/[MmLlHhVvCcSsQqTtAaZz]|[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/g);
    if (!tokens) return null;

    var i = 0;
    var cmd = '';
    while (i < tokens.length) {
      var t = tokens[i];
      if (/^[A-Za-z]$/.test(t)) {
        cmd = t;
        i++;
      }

      switch (cmd) {
        case 'M':
          cx = parseFloat(tokens[i]); cy = parseFloat(tokens[i + 1]);
          startX = cx; startY = cy;
          points.push({ x: cx, y: cy });
          i += 2;
          cmd = 'L'; // implicit lineto after M
          break;
        case 'm':
          cx += parseFloat(tokens[i]); cy += parseFloat(tokens[i + 1]);
          startX = cx; startY = cy;
          points.push({ x: cx, y: cy });
          i += 2;
          cmd = 'l';
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
          // Cubic bezier: skip control points, take end point
          cx = parseFloat(tokens[i + 4]); cy = parseFloat(tokens[i + 5]);
          points.push({ x: cx, y: cy });
          i += 6;
          break;
        case 'c':
          cx += parseFloat(tokens[i + 4]); cy += parseFloat(tokens[i + 5]);
          points.push({ x: cx, y: cy });
          i += 6;
          break;
        case 'Z': case 'z':
          cx = startX; cy = startY;
          points.push({ x: cx, y: cy });
          i++;
          break;
        default:
          // Skip unknown
          i++;
          break;
      }
    }

    if (points.length < 2) {
      // Single-point path (degenerate, skip)
      return null;
    }

    return {
      start: points[0],
      end: points[points.length - 1],
      allPoints: points
    };
  }

  /** Parse a polyline/line element's endpoints */
  function parseLineEndpoints(el) {
    var tag = el.tagName.toLowerCase();
    if (tag === 'line') {
      return {
        start: { x: parseFloat(el.getAttribute('x1')), y: parseFloat(el.getAttribute('y1')) },
        end: { x: parseFloat(el.getAttribute('x2')), y: parseFloat(el.getAttribute('y2')) }
      };
    }
    if (tag === 'polyline') {
      var pts = el.getAttribute('points').trim().split(/\s+/).map(function (p) {
        var xy = p.split(',');
        return { x: parseFloat(xy[0]), y: parseFloat(xy[1]) };
      });
      if (pts.length < 2) return null;
      return { start: pts[0], end: pts[pts.length - 1] };
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
   * Detect if a segment is a special turn-restriction segment.
   * @returns {string|null} 'orange' | 'blue' | null
   */
  function detectSpecial(el) {
    var id = el.id;
    if (id === 'st_0068' || id === 'st_0225') return 'orange';
    if (id === 'st_0069') return 'blue';
    // Also check class
    var cls = el.getAttribute('class') || '';
    if (cls.includes('st46')) return 'orange';
    if (cls.includes('st47')) return 'blue';
    return null;
  }

  /**
   * Build directed graph from street SVG elements.
   * @param {SVGElement[]} streetEls
   * @param {number} [tolerance] - snap tolerance override
   */
  function build(streetEls, tolerance) {
    if (tolerance !== undefined) SNAP_TOLERANCE = tolerance;

    nodes.clear();
    edges.clear();
    segments.clear();

    streetEls.forEach(function (el) {
      var id = el.id;
      var d = el.getAttribute('d');
      var endpoints = null;

      if (d) {
        endpoints = parsePathEndpoints(d);
      } else {
        endpoints = parseLineEndpoints(el);
      }

      if (!endpoints) return; // Skip degenerate segments

      var oneway = el.getAttribute('data-oneway');
      var flow = el.getAttribute('data-flow') || 'both';
      var dir = el.getAttribute('data-dir') || 'both';
      var special = detectSpecial(el);

      var isOneway = oneway === '1';

      var startKey = snapKey(endpoints.start.x, endpoints.start.y);
      var endKey = snapKey(endpoints.end.x, endpoints.end.y);

      // Skip zero-length segments
      if (startKey === endKey) return;

      var weight = dist(endpoints.start, endpoints.end);

      var segData = {
        startKey: startKey,
        endKey: endKey,
        flow: flow,
        dir: dir,
        oneway: isOneway,
        special: special,
        el: el
      };
      segments.set(id, segData);

      function addEdge(from, to) {
        if (!edges.has(from)) edges.set(from, []);
        edges.get(from).push({
          to: to,
          weight: weight,
          segmentId: id,
          flow: flow,
          dir: dir,
          special: special
        });
      }

      if (!isOneway) {
        // Bidirectional
        addEdge(startKey, endKey);
        addEdge(endKey, startKey);
      } else if (dir === 'forward') {
        // A -> B (start to end)
        addEdge(startKey, endKey);
      } else if (dir === 'backward') {
        // B -> A (end to start)
        addEdge(endKey, startKey);
      }
    });

    return { nodes: nodes, edges: edges, segments: segments };
  }

  /** Get the closest graph node to a given SVG point. */
  function findNearestNode(x, y, maxDist) {
    maxDist = maxDist || Infinity;
    var best = null;
    var bestD = maxDist;
    for (var entry of nodes) {
      var n = entry[1];
      var d = dist(n, { x: x, y: y });
      if (d < bestD) {
        bestD = d;
        best = entry[0];
      }
    }
    return best;
  }

  /** Get snap tolerance */
  function getSnapTolerance() { return SNAP_TOLERANCE; }

  /** Set snap tolerance */
  function setSnapTolerance(v) { SNAP_TOLERANCE = v; }

  /** Get graph data for external use */
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
