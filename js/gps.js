/**
 * gps.js — GPS tracking, coordinate projection, deviation detection
 *
 * Converts WGS84 lat/lon to SVG coordinates using known anchor points.
 * The SVG map's real-world bounds must be calibrated with at least 2 GPS anchors.
 */
var GPS = (function () {
  'use strict';

  var watchId = null;
  var currentPosition = null; // {lat, lon, accuracy, heading, svgX, svgY}
  var listeners = [];

  /**
   * Calibration anchors: real GPS coords ↔ SVG coords.
   * These must be set to match the actual barrio location.
   * Default: approximate for Altos de Márquez, San Isidro.
   */
  var anchors = {
    // Acceso Principal (Márquez) - SVG: (410.4, 589.8)
    a: { lat: -34.4813, lon: -58.5267, svgX: 410.4, svgY: 589.8 },
    // Acceso Florida (top) - SVG: (470.2, 52.6)
    b: { lat: -34.4765, lon: -58.5220, svgX: 470.2, svgY: 52.6 }
  };

  // Computed projection factors (set during calibrate)
  var proj = null;

  /** Calibrate projection from anchors */
  function calibrate() {
    var dLat = anchors.b.lat - anchors.a.lat;
    var dLon = anchors.b.lon - anchors.a.lon;
    var dSvgX = anchors.b.svgX - anchors.a.svgX;
    var dSvgY = anchors.b.svgY - anchors.a.svgY;

    // Simple affine: lat/lon differences → SVG differences
    // Using two-point linear mapping
    proj = {
      // SVG = origin + (gps - anchor_a) * scale
      latToY: dSvgY / dLat,
      lonToX: dSvgX / dLon,
      refLat: anchors.a.lat,
      refLon: anchors.a.lon,
      refSvgX: anchors.a.svgX,
      refSvgY: anchors.a.svgY
    };
  }

  calibrate();

  /**
   * Convert GPS coords to SVG coords.
   * @param {number} lat
   * @param {number} lon
   * @returns {{x: number, y: number}}
   */
  function gpsToSvg(lat, lon) {
    if (!proj) calibrate();
    return {
      x: proj.refSvgX + (lon - proj.refLon) * proj.lonToX,
      y: proj.refSvgY + (lat - proj.refLat) * proj.latToY
    };
  }

  /**
   * Start watching GPS position.
   */
  function startTracking() {
    if (!navigator.geolocation) {
      notifyListeners({ error: 'Geolocalización no soportada' });
      return;
    }

    if (watchId !== null) return; // Already tracking

    watchId = navigator.geolocation.watchPosition(
      function (pos) {
        var svgCoord = gpsToSvg(pos.coords.latitude, pos.coords.longitude);
        currentPosition = {
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          heading: pos.coords.heading,
          svgX: svgCoord.x,
          svgY: svgCoord.y,
          timestamp: pos.timestamp
        };
        notifyListeners({ position: currentPosition });
      },
      function (err) {
        notifyListeners({ error: 'GPS error: ' + err.message + ' (code ' + err.code + ')' });
      },
      {
        enableHighAccuracy: true,
        maximumAge: 3000,
        timeout: 10000
      }
    );
  }

  /** Stop GPS tracking */
  function stopTracking() {
    if (watchId !== null) {
      navigator.geolocation.clearWatch(watchId);
      watchId = null;
    }
  }

  /** Subscribe to position updates */
  function onUpdate(fn) {
    listeners.push(fn);
  }

  /** Remove listener */
  function offUpdate(fn) {
    listeners = listeners.filter(function (f) { return f !== fn; });
  }

  function notifyListeners(data) {
    listeners.forEach(function (fn) { fn(data); });
  }

  /** Get last known position */
  function getPosition() {
    return currentPosition;
  }

  /**
   * Check if current GPS position deviates from the route.
   * @param {string[]} routeNodeKeys - list of node keys on route
   * @param {number} threshold - max distance in SVG units before "off route"
   * @returns {{ onRoute: boolean, nearestDist: number, nearestNodeIdx: number }}
   */
  function checkDeviation(routeNodeKeys, threshold) {
    threshold = threshold || 15;
    if (!currentPosition) return { onRoute: false, nearestDist: Infinity, nearestNodeIdx: -1 };

    var graph = GraphBuilder.getGraph();
    var bestDist = Infinity;
    var bestIdx = -1;

    for (var i = 0; i < routeNodeKeys.length; i++) {
      var node = graph.nodes.get(routeNodeKeys[i]);
      if (!node) continue;
      var dx = node.x - currentPosition.svgX;
      var dy = node.y - currentPosition.svgY;
      var d = Math.sqrt(dx * dx + dy * dy);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }

    return {
      onRoute: bestDist <= threshold,
      nearestDist: bestDist,
      nearestNodeIdx: bestIdx
    };
  }

  /**
   * Simulate a GPS position (for testing without real GPS).
   * @param {number} svgX
   * @param {number} svgY
   */
  function simulatePosition(svgX, svgY) {
    currentPosition = {
      lat: 0, lon: 0,
      accuracy: 5,
      heading: null,
      svgX: svgX,
      svgY: svgY,
      timestamp: Date.now()
    };
    notifyListeners({ position: currentPosition });
  }

  /** Update calibration anchors */
  function setAnchors(a, b) {
    anchors.a = a;
    anchors.b = b;
    calibrate();
  }

  return {
    startTracking: startTracking,
    stopTracking: stopTracking,
    onUpdate: onUpdate,
    offUpdate: offUpdate,
    getPosition: getPosition,
    gpsToSvg: gpsToSvg,
    checkDeviation: checkDeviation,
    simulatePosition: simulatePosition,
    setAnchors: setAnchors
  };
})();
