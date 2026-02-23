/**
 * debug.js — Route auditing, graph diagnostics
 */
var Debug = (function () {
  'use strict';

  var logEl = null;

  function init() {
    logEl = document.getElementById('debug-log');

    document.getElementById('btn-debug').addEventListener('click', function () {
      document.getElementById('debug-overlay').classList.remove('hidden');
    });

    document.getElementById('btn-close-debug').addEventListener('click', function () {
      document.getElementById('debug-overlay').classList.add('hidden');
      Renderer.clearDebugGraph();
    });

    document.getElementById('btn-run-audit').addEventListener('click', runAudit);
    document.getElementById('btn-show-graph').addEventListener('click', function () {
      Renderer.drawDebugGraph();
      log('Grafo dibujado en overlay.');
    });
  }

  function log(msg) {
    if (!logEl) logEl = document.getElementById('debug-log');
    logEl.textContent += msg + '\n';
    logEl.scrollTop = logEl.scrollHeight;
    console.log('[Debug]', msg);
  }

  function clearLog() {
    if (logEl) logEl.textContent = '';
  }

  /**
   * Audit random routes: pick 200 random origin→dest pairs and validate.
   */
  function runAudit() {
    clearLog();
    var graph = GraphBuilder.getGraph();
    var nodeKeys = Array.from(graph.nodes.keys());
    var nodeCount = nodeKeys.length;
    var edgeCount = 0;

    graph.edges.forEach(function (list) { edgeCount += list.length; });

    log('=== Auditoría de rutas ===');
    log('Nodos: ' + nodeCount);
    log('Aristas dirigidas: ' + edgeCount);
    log('Segmentos SVG: ' + graph.segments.size);
    log('Snap tolerance: ' + GraphBuilder.getSnapTolerance() + 'px');
    log('');

    // Validate data-flow/dir counts
    var flowDirCounts = {};
    graph.segments.forEach(function (seg) {
      var key = seg.flow + '-' + seg.dir;
      flowDirCounts[key] = (flowDirCounts[key] || 0) + 1;
    });
    log('Distribución flow-dir: ' + JSON.stringify(flowDirCounts));

    // Detect special segments
    var specials = [];
    graph.segments.forEach(function (seg, id) {
      if (seg.special) specials.push(id + ' (' + seg.special + ')');
    });
    log('Segmentos especiales: ' + (specials.length > 0 ? specials.join(', ') : 'ninguno'));
    log('');

    // Connected components (undirected)
    var components = findComponents(nodeKeys, graph.edges);
    log('Componentes conexas (dirigido→alcanzable): ' + components.length);
    components.forEach(function (comp, i) {
      log('  Componente ' + (i + 1) + ': ' + comp.length + ' nodos');
    });
    log('');

    // Run 200 random routes
    var NUM_TESTS = 200;
    var modes = [Router.MODE_IN, Router.MODE_OUT, Router.MODE_INTERNAL];
    var stats = { ok: 0, noRoute: 0, wrongWay: 0, errors: [] };

    for (var t = 0; t < NUM_TESTS; t++) {
      var startIdx = Math.floor(Math.random() * nodeCount);
      var endIdx = Math.floor(Math.random() * nodeCount);
      if (startIdx === endIdx) { endIdx = (endIdx + 1) % nodeCount; }

      var mode = modes[t % modes.length];
      var result = Router.findRoute(nodeKeys[startIdx], nodeKeys[endIdx], mode);

      if (result.error) {
        stats.noRoute++;
        if (stats.errors.length < 10) {
          stats.errors.push({
            from: nodeKeys[startIdx],
            to: nodeKeys[endIdx],
            mode: mode,
            error: result.error
          });
        }
        continue;
      }

      // Validate: check each edge is legal
      var violation = validateRoute(result.path, result.edgeIds, mode, graph);
      if (violation) {
        stats.wrongWay++;
        if (stats.errors.length < 10) {
          stats.errors.push({
            from: nodeKeys[startIdx],
            to: nodeKeys[endIdx],
            mode: mode,
            error: 'Contramano: ' + violation
          });
        }
      } else {
        stats.ok++;
      }
    }

    log('--- Resultados (' + NUM_TESTS + ' rutas) ---');
    log('OK: ' + stats.ok);
    log('Sin ruta: ' + stats.noRoute);
    log('Contramano: ' + stats.wrongWay);

    if (stats.errors.length > 0) {
      log('');
      log('Errores (primeros 10):');
      stats.errors.forEach(function (e, i) {
        log('  ' + (i + 1) + ') ' + e.from + ' → ' + e.to + ' [' + e.mode + ']: ' + e.error);
      });
    }

    log('');
    log('=== Auditoría completada ===');
  }

  /**
   * Validate that a route doesn't traverse edges in the wrong direction.
   * @returns {string|null} violation description, or null if OK
   */
  function validateRoute(path, edgeIds, mode, graph) {
    for (var i = 0; i < edgeIds.length; i++) {
      var segId = edgeIds[i];
      var seg = graph.segments.get(segId);
      if (!seg) return 'Segmento ' + segId + ' no existe';

      var fromKey = path[i];
      var toKey = path[i + 1];

      // Check direction is legal
      if (seg.oneway) {
        if (seg.dir === 'forward') {
          // Must go startKey → endKey
          if (fromKey !== seg.startKey || toKey !== seg.endKey) {
            return segId + ' es forward pero se recorre al revés';
          }
        } else if (seg.dir === 'backward') {
          // Must go endKey → startKey
          if (fromKey !== seg.endKey || toKey !== seg.startKey) {
            return segId + ' es backward pero se recorre al revés';
          }
        }
      }

      // Check turn restrictions
      if (seg.special === 'orange' && mode === Router.MODE_IN) {
        return segId + ' (orange) prohibido en modo IN';
      }
      if (seg.special === 'blue' && mode === Router.MODE_OUT) {
        return segId + ' (blue) prohibido en modo OUT';
      }
    }
    return null;
  }

  /**
   * Find connected components using BFS (following directed edges).
   */
  function findComponents(nodeKeys, edgesMap) {
    var visited = new Set();
    var components = [];

    // Use undirected view for component analysis
    var undirected = new Map();
    edgesMap.forEach(function (list, from) {
      list.forEach(function (edge) {
        if (!undirected.has(from)) undirected.set(from, []);
        undirected.get(from).push(edge.to);
        if (!undirected.has(edge.to)) undirected.set(edge.to, []);
        undirected.get(edge.to).push(from);
      });
    });

    nodeKeys.forEach(function (key) {
      if (visited.has(key)) return;
      var comp = [];
      var queue = [key];
      visited.add(key);
      while (queue.length > 0) {
        var curr = queue.shift();
        comp.push(curr);
        var nbrs = undirected.get(curr) || [];
        for (var i = 0; i < nbrs.length; i++) {
          if (!visited.has(nbrs[i])) {
            visited.add(nbrs[i]);
            queue.push(nbrs[i]);
          }
        }
      }
      components.push(comp);
    });

    return components;
  }

  return { init: init, log: log, runAudit: runAudit };
})();
