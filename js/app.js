/**
 * app.js — Main application orchestrator
 *
 * Loads SVG → builds graph → initializes UI → handles navigation
 */
var App = (function () {
  'use strict';

  var controlPoints = null;
  var currentRoute = null;    // { path, edgeIds, cost, mode, originType, destType }
  var isNavigating = false;
  var REROUTE_THRESHOLD = 15; // SVG units before recalculation
  var REROUTE_COOLDOWN = 3000; // ms between recalculations
  var lastRerouteTime = 0;

  async function init() {
    try {
      // 1. Load SVG
      await SvgLoader.load('mapa_altos.svg', 'svg-wrapper');

      // 2. Build graph
      var streets = SvgLoader.getStreetElements();
      GraphBuilder.build(streets);

      // 3. Get control points
      controlPoints = SvgLoader.getControlPoints();

      // 4. Initialize UI
      var manzanaIds = Object.keys(controlPoints.manzanas);
      UI.init(manzanaIds);

      // 5. Initialize renderer
      Renderer.init();

      // 6. Initialize debug
      Debug.init();

      // 7. Bind navigation buttons
      bindButtons();

      // 8. Start GPS tracking
      bindGps();

      // 9. Log summary
      var graph = GraphBuilder.getGraph();
      console.log('[App] Inicializado. Nodos:', graph.nodes.size,
        'Aristas:', countEdges(graph.edges),
        'Segmentos:', graph.segments.size,
        'Manzanas:', manzanaIds.length);

    } catch (err) {
      console.error('[App] Error de inicialización:', err);
      UI.showToast('Error cargando el mapa: ' + err.message, 'error');
    }
  }

  function countEdges(edgesMap) {
    var c = 0;
    edgesMap.forEach(function (list) { c += list.length; });
    return c;
  }

  function bindButtons() {
    document.getElementById('btn-route').addEventListener('click', calculateRoute);
    document.getElementById('btn-clear').addEventListener('click', stopNavigation);
    document.getElementById('btn-stop-nav').addEventListener('click', stopNavigation);

    document.getElementById('btn-center-gps').addEventListener('click', function () {
      var pos = GPS.getPosition();
      if (pos) {
        UI.centerOnSvg(pos.svgX, pos.svgY);
      } else {
        UI.showToast('GPS no disponible aún', 'warning');
      }
    });
  }

  function bindGps() {
    GPS.onUpdate(function (data) {
      if (data.error) {
        console.warn('[GPS]', data.error);
        return;
      }
      if (data.position) {
        Renderer.updateGpsMarker(
          data.position.svgX,
          data.position.svgY,
          data.position.accuracy,
          data.position.heading
        );

        // Check deviation if navigating
        if (isNavigating && currentRoute) {
          checkAndReroute();
        }
      }
    });

    // Try to start tracking (user will be prompted for permission)
    GPS.startTracking();
  }

  /** Resolve an origin/dest selection to a graph node key. */
  function resolvePoint(config) {
    if (config.type === 'marquez') {
      if (!controlPoints.marquez) return { error: 'Punto de Márquez no definido en SVG' };
      var key = GraphBuilder.findNearestNode(controlPoints.marquez.x, controlPoints.marquez.y, 30);
      return key ? { key: key } : { error: 'No hay nodo de grafo cerca de Entrada Márquez' };
    }

    if (config.type === 'florida') {
      if (!controlPoints.florida) return { error: 'Punto de Florida no definido en SVG' };
      var key = GraphBuilder.findNearestNode(controlPoints.florida.x, controlPoints.florida.y, 30);
      return key ? { key: key } : { error: 'No hay nodo de grafo cerca de Entrada Florida' };
    }

    if (config.type === 'gps') {
      var pos = GPS.getPosition();
      if (!pos) return { error: 'GPS no disponible. Activá la ubicación o elegí otro origen.' };
      var key = GraphBuilder.findNearestNode(pos.svgX, pos.svgY, 30);
      return key ? { key: key } : { error: 'Tu ubicación GPS está fuera del mapa de calles' };
    }

    if (config.type === 'manual') {
      if (!config.manzana) return { error: 'Seleccioná una manzana' };
      var pt = controlPoints.manzanas[config.manzana];
      if (!pt) return { error: 'Manzana ' + config.manzana + ' no tiene punto de acceso' };
      var key = GraphBuilder.findNearestNode(pt.x, pt.y, 20);
      return key ? { key: key } : { error: 'No hay calle cerca de Manzana ' + config.manzana };
    }

    return { error: 'Tipo de punto desconocido' };
  }

  /** Main route calculation */
  function calculateRoute() {
    var origin = UI.getOrigin();
    var dest = UI.getDest();

    // Resolve to graph nodes
    var originResult = resolvePoint(origin);
    if (originResult.error) {
      UI.showToast(originResult.error, 'error');
      return;
    }

    var destResult = resolvePoint(dest);
    if (destResult.error) {
      UI.showToast(destResult.error, 'error');
      return;
    }

    // Determine travel mode
    var mode = Router.inferMode(origin.type, dest.type);

    // Find route
    var result = Router.findRoute(originResult.key, destResult.key, mode);

    if (result.error) {
      UI.showToast(result.error, 'error', 6000);
      console.error('[App] Ruta fallida:', result.error);
      return;
    }

    // Store current route
    currentRoute = {
      path: result.path,
      edgeIds: result.edgeIds,
      cost: result.cost,
      mode: mode,
      originType: origin.type,
      destType: dest.type,
      originKey: originResult.key,
      destKey: destResult.key
    };

    // Draw
    Renderer.clearRoute();
    Renderer.drawRoute(result.path, result.edgeIds);

    // Highlight destination manzana
    Renderer.clearManzanaHighlight();
    if (dest.type === 'manual' && dest.manzana) {
      Renderer.highlightManzana(dest.manzana);
    }

    // Start navigation mode
    isNavigating = true;
    UI.setNavigating(true);

    // Show nav panel with initial instruction
    var instructions = generateInstructions(result.path, result.edgeIds);
    if (instructions.length > 0) {
      UI.showNavPanel(instructions[0].text, formatDistance(result.cost));
    } else {
      UI.showNavPanel('Seguí la ruta marcada', formatDistance(result.cost));
    }

    // Center on route start
    var graph = GraphBuilder.getGraph();
    var startNode = graph.nodes.get(result.path[0]);
    if (startNode) UI.centerOnSvg(startNode.x, startNode.y);

    UI.showToast('Ruta calculada: ' + formatDistance(result.cost), 'success', 3000);
  }

  /** Stop navigation */
  function stopNavigation() {
    isNavigating = false;
    currentRoute = null;
    Renderer.clearRoute();
    Renderer.clearManzanaHighlight();
    UI.hideNavPanel();
    UI.setNavigating(false);
    document.getElementById('route-panel').style.display = '';
  }

  /** Check GPS deviation and recalculate if needed */
  function checkAndReroute() {
    if (!currentRoute || !isNavigating) return;

    var now = Date.now();
    if (now - lastRerouteTime < REROUTE_COOLDOWN) return;

    var deviation = GPS.checkDeviation(currentRoute.path, REROUTE_THRESHOLD);

    if (!deviation.onRoute) {
      lastRerouteTime = now;
      console.log('[App] Desvío detectado (' + deviation.nearestDist.toFixed(1) + 'u). Recalculando…');

      // Recalculate from current GPS position
      var pos = GPS.getPosition();
      if (!pos) return;

      var nearestNode = GraphBuilder.findNearestNode(pos.svgX, pos.svgY, 30);
      if (!nearestNode) {
        UI.showToast('Estás fuera del mapa de calles', 'warning');
        return;
      }

      var result = Router.findRoute(nearestNode, currentRoute.destKey, currentRoute.mode);

      if (result.error) {
        UI.showToast('No se pudo recalcular: ' + result.error, 'error');
        return;
      }

      currentRoute.path = result.path;
      currentRoute.edgeIds = result.edgeIds;
      currentRoute.cost = result.cost;
      currentRoute.originKey = nearestNode;

      Renderer.clearRoute();
      Renderer.drawRoute(result.path, result.edgeIds);

      var instructions = generateInstructions(result.path, result.edgeIds);
      if (instructions.length > 0) {
        UI.updateNavInstruction('Ruta recalculada: ' + instructions[0].text, formatDistance(result.cost));
      }
    } else if (deviation.nearestNodeIdx > 0) {
      // Update instruction based on progress
      var remaining = currentRoute.path.length - deviation.nearestNodeIdx;
      var pct = Math.round((deviation.nearestNodeIdx / currentRoute.path.length) * 100);
      UI.updateNavInstruction(
        'En ruta (' + pct + '% completado)',
        'Faltan ~' + remaining + ' segmentos'
      );
    }
  }

  /**
   * Generate basic turn-by-turn instructions.
   * @param {string[]} path - node keys
   * @param {string[]} edgeIds - segment IDs
   * @returns {{ text: string, nodeIdx: number }[]}
   */
  function generateInstructions(path, edgeIds) {
    var graph = GraphBuilder.getGraph();
    var instructions = [];

    if (path.length < 2) return instructions;

    // Starting instruction
    var seg0 = graph.segments.get(edgeIds[0]);
    if (seg0) {
      var flowLabel = seg0.flow === 'in' ? 'ingreso' : seg0.flow === 'out' ? 'egreso' : 'interna';
      instructions.push({ text: 'Iniciá por calle de ' + flowLabel, nodeIdx: 0 });
    }

    // Detect turns by angle change
    for (var i = 1; i < path.length - 1; i++) {
      var prev = graph.nodes.get(path[i - 1]);
      var curr = graph.nodes.get(path[i]);
      var next = graph.nodes.get(path[i + 1]);
      if (!prev || !curr || !next) continue;

      var angle = calcTurnAngle(prev, curr, next);

      if (Math.abs(angle) > 30) {
        var dir = angle > 0 ? 'derecha' : 'izquierda';
        instructions.push({ text: 'Girá a la ' + dir, nodeIdx: i });
      }
    }

    // Arrival
    instructions.push({ text: 'Llegaste a destino', nodeIdx: path.length - 1 });

    return instructions;
  }

  /**
   * Calculate turn angle in degrees.
   * Positive = right turn, negative = left turn.
   */
  function calcTurnAngle(prev, curr, next) {
    var dx1 = curr.x - prev.x;
    var dy1 = curr.y - prev.y;
    var dx2 = next.x - curr.x;
    var dy2 = next.y - curr.y;

    var cross = dx1 * dy2 - dy1 * dx2;
    var dot = dx1 * dx2 + dy1 * dy2;
    var angle = Math.atan2(cross, dot) * (180 / Math.PI);
    return angle;
  }

  /**
   * Format SVG distance to approximate meters.
   * Scale is derived from the two GPS calibration anchors in gps.js:
   *   Anchor A (-34.4813, -58.5267) → SVG (410.4, 589.8)
   *   Anchor B (-34.4765, -58.5220) → SVG (470.2, 52.6)
   * Real-world distance between anchors ≈ 680 m (Haversine).
   * SVG distance ≈ √((470.2-410.4)² + (52.6-589.8)²) ≈ 540.5 SVG units.
   * Scale ≈ 680 / 540.5 ≈ 1.26 m per SVG unit.
   */
  var SVG_TO_METERS = 1.26;

  function formatDistance(svgUnits) {
    var meters = Math.round(svgUnits * SVG_TO_METERS);
    if (meters >= 1000) return (meters / 1000).toFixed(1) + ' km';
    return meters + ' m';
  }

  // Auto-init on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  return {
    calculateRoute: calculateRoute,
    stopNavigation: stopNavigation,
    resolvePoint: resolvePoint
  };
})();
