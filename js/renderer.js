/**
 * renderer.js — Draw route on SVG overlay, GPS marker, animations
 */
var Renderer = (function () {
  'use strict';

  var SVG_NS = 'http://www.w3.org/2000/svg';
  var overlayGroup = null;
  var routePath = null;
  var gpsMarker = null;
  var gpsAccuracyCircle = null;

  /** Initialize: get reference to #overlays group */
  function init() {
    var svg = SvgLoader.getSvg();
    if (!svg) return;
    overlayGroup = svg.querySelector('#overlays');
    if (!overlayGroup) {
      overlayGroup = document.createElementNS(SVG_NS, 'g');
      overlayGroup.id = 'overlays';
      svg.appendChild(overlayGroup);
    }
  }

  /** Clear all overlays */
  function clearRoute() {
    if (routePath) {
      routePath.remove();
      routePath = null;
    }
    // Remove old route elements
    if (overlayGroup) {
      var old = overlayGroup.querySelectorAll('.route-line, .route-arrow, .route-endpoint');
      old.forEach(function (el) { el.remove(); });
    }
  }

  /**
   * Draw route as animated polyline on overlay.
   * @param {string[]} nodeKeys - ordered node keys of the route
   * @param {string[]} edgeIds - ordered segment IDs of the route
   */
  function drawRoute(nodeKeys, edgeIds) {
    if (!overlayGroup) init();
    clearRoute();

    var graph = GraphBuilder.getGraph();
    if (nodeKeys.length < 2) return;

    // Build point string
    var points = [];
    for (var i = 0; i < nodeKeys.length; i++) {
      var node = graph.nodes.get(nodeKeys[i]);
      if (node) {
        points.push(node.x + ',' + node.y);
      }
    }

    if (points.length < 2) return;

    // Create path
    var d = 'M' + points[0];
    for (var j = 1; j < points.length; j++) {
      d += ' L' + points[j];
    }

    routePath = document.createElementNS(SVG_NS, 'path');
    routePath.setAttribute('d', d);
    routePath.setAttribute('class', 'route-line');
    overlayGroup.appendChild(routePath);

    // Animate with stroke-dashoffset
    var totalLen = routePath.getTotalLength();
    routePath.style.strokeDasharray = totalLen;
    routePath.style.strokeDashoffset = totalLen;
    routePath.style.transition = 'none';

    // Force layout
    routePath.getBoundingClientRect();

    routePath.style.transition = 'stroke-dashoffset 1.5s ease';
    routePath.style.strokeDashoffset = '0';

    // Draw start/end markers
    drawEndpoint(graph.nodes.get(nodeKeys[0]), 'start');
    drawEndpoint(graph.nodes.get(nodeKeys[nodeKeys.length - 1]), 'end');
  }

  /** Draw a start or end marker */
  function drawEndpoint(node, type) {
    if (!node || !overlayGroup) return;

    var circle = document.createElementNS(SVG_NS, 'circle');
    circle.setAttribute('cx', node.x);
    circle.setAttribute('cy', node.y);
    circle.setAttribute('r', type === 'start' ? 4 : 5);
    circle.setAttribute('class', 'route-endpoint');
    circle.style.fill = type === 'start' ? '#00d4ff' : '#2ed573';
    circle.style.stroke = '#fff';
    circle.style.strokeWidth = '1.5';
    overlayGroup.appendChild(circle);
  }

  /**
   * Update or create the GPS position marker.
   * @param {number} x - SVG x
   * @param {number} y - SVG y
   * @param {number} accuracy - meters (converted proportionally)
   * @param {number|null} heading - degrees
   */
  function updateGpsMarker(x, y, accuracy, heading) {
    if (!overlayGroup) init();

    // Accuracy circle (very rough: 1 SVG unit ≈ 0.5m for this map)
    var accRadius = Math.min(Math.max(accuracy * 0.5, 3), 30);

    if (!gpsAccuracyCircle) {
      gpsAccuracyCircle = document.createElementNS(SVG_NS, 'circle');
      gpsAccuracyCircle.setAttribute('class', 'gps-accuracy');
      overlayGroup.appendChild(gpsAccuracyCircle);
    }
    gpsAccuracyCircle.setAttribute('cx', x);
    gpsAccuracyCircle.setAttribute('cy', y);
    gpsAccuracyCircle.setAttribute('r', accRadius);

    // Main marker
    if (!gpsMarker) {
      gpsMarker = document.createElementNS(SVG_NS, 'circle');
      gpsMarker.setAttribute('class', 'gps-marker');
      gpsMarker.setAttribute('r', 4);
      overlayGroup.appendChild(gpsMarker);
    }
    gpsMarker.setAttribute('cx', x);
    gpsMarker.setAttribute('cy', y);
  }

  /** Remove GPS marker */
  function removeGpsMarker() {
    if (gpsMarker) { gpsMarker.remove(); gpsMarker = null; }
    if (gpsAccuracyCircle) { gpsAccuracyCircle.remove(); gpsAccuracyCircle = null; }
  }

  /**
   * Highlight a manzana block.
   * @param {string} manzanaId - e.g. "79"
   */
  function highlightManzana(manzanaId) {
    clearManzanaHighlight();
    var svg = SvgLoader.getSvg();
    if (!svg) return;
    var g = svg.querySelector('#M' + manzanaId);
    if (g) {
      var rect = g.querySelector('rect');
      if (rect) rect.classList.add('manzana-highlight');
    }
  }

  /** Remove manzana highlights */
  function clearManzanaHighlight() {
    var svg = SvgLoader.getSvg();
    if (!svg) return;
    var all = svg.querySelectorAll('.manzana-highlight');
    all.forEach(function (el) { el.classList.remove('manzana-highlight'); });
  }

  /**
   * Draw debug graph visualization.
   */
  function drawDebugGraph() {
    if (!overlayGroup) init();
    clearDebugGraph();

    var graph = GraphBuilder.getGraph();
    var group = document.createElementNS(SVG_NS, 'g');
    group.id = 'debug-graph';

    // Draw edges
    graph.edges.forEach(function (edgeList, fromKey) {
      var fromNode = graph.nodes.get(fromKey);
      if (!fromNode) return;
      edgeList.forEach(function (edge) {
        var toNode = graph.nodes.get(edge.to);
        if (!toNode) return;
        var line = document.createElementNS(SVG_NS, 'line');
        line.setAttribute('x1', fromNode.x);
        line.setAttribute('y1', fromNode.y);
        line.setAttribute('x2', toNode.x);
        line.setAttribute('y2', toNode.y);
        line.setAttribute('class', 'debug-edge');
        if (edge.special === 'orange') line.style.stroke = '#ffa502';
        else if (edge.special === 'blue') line.style.stroke = '#3742fa';
        group.appendChild(line);
      });
    });

    // Draw nodes
    graph.nodes.forEach(function (node, key) {
      var c = document.createElementNS(SVG_NS, 'circle');
      c.setAttribute('cx', node.x);
      c.setAttribute('cy', node.y);
      c.setAttribute('class', 'debug-node');
      group.appendChild(c);
    });

    overlayGroup.appendChild(group);
  }

  function clearDebugGraph() {
    if (overlayGroup) {
      var dg = overlayGroup.querySelector('#debug-graph');
      if (dg) dg.remove();
    }
  }

  return {
    init: init,
    clearRoute: clearRoute,
    drawRoute: drawRoute,
    updateGpsMarker: updateGpsMarker,
    removeGpsMarker: removeGpsMarker,
    highlightManzana: highlightManzana,
    clearManzanaHighlight: clearManzanaHighlight,
    drawDebugGraph: drawDebugGraph,
    clearDebugGraph: clearDebugGraph
  };
})();
