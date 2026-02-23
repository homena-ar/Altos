/**
 * router.js — A* pathfinding with turn restrictions
 *
 * Turn restrictions:
 *   - Orange segments (st_0068, st_0225): blocked for flow=in traffic
 *   - Blue segment (st_0069): blocked for flow=out traffic
 *
 * The "travel mode" is inferred from the origin:
 *   - Origin = Márquez or Florida entry → mode "in" (ingressing)
 *   - Origin = inside, dest = exit → mode "out" (egressing)
 *   - Otherwise → mode "internal" (no special restriction)
 */
var Router = (function () {
  'use strict';

  var DEBUG = false;

  /** Travel modes */
  var MODE_IN = 'in';
  var MODE_OUT = 'out';
  var MODE_INTERNAL = 'internal';

  /**
   * Simple binary min-heap for A* open set.
   */
  function MinHeap() {
    this.data = [];
  }

  MinHeap.prototype.push = function (item) {
    this.data.push(item);
    this._bubbleUp(this.data.length - 1);
  };

  MinHeap.prototype.pop = function () {
    var top = this.data[0];
    var last = this.data.pop();
    if (this.data.length > 0) {
      this.data[0] = last;
      this._sinkDown(0);
    }
    return top;
  };

  MinHeap.prototype.size = function () {
    return this.data.length;
  };

  MinHeap.prototype._bubbleUp = function (i) {
    while (i > 0) {
      var pi = (i - 1) >> 1;
      if (this.data[i].f < this.data[pi].f) {
        var tmp = this.data[i]; this.data[i] = this.data[pi]; this.data[pi] = tmp;
        i = pi;
      } else break;
    }
  };

  MinHeap.prototype._sinkDown = function (i) {
    var n = this.data.length;
    while (true) {
      var l = 2 * i + 1, r = 2 * i + 2, smallest = i;
      if (l < n && this.data[l].f < this.data[smallest].f) smallest = l;
      if (r < n && this.data[r].f < this.data[smallest].f) smallest = r;
      if (smallest !== i) {
        var tmp = this.data[i]; this.data[i] = this.data[smallest]; this.data[smallest] = tmp;
        i = smallest;
      } else break;
    }
  };

  /**
   * Check if a turn from prevSegId to nextEdge is restricted.
   * @param {string|null} prevSegId - previous segment traversed
   * @param {object} nextEdge - candidate edge {segmentId, special, ...}
   * @param {string} mode - 'in' | 'out' | 'internal'
   * @returns {boolean} true if turn is BLOCKED
   */
  function isTurnRestricted(prevSegId, nextEdge, mode) {
    if (!nextEdge.special) return false;

    if (nextEdge.special === 'orange') {
      // Orange: blocked for IN traffic
      if (mode === MODE_IN) return true;
    }

    if (nextEdge.special === 'blue') {
      // Blue: blocked for OUT traffic
      if (mode === MODE_OUT) return true;
    }

    return false;
  }

  /**
   * Euclidean heuristic for A*.
   */
  function heuristic(nodeKeyA, nodeKeyB, nodesMap) {
    var a = nodesMap.get(nodeKeyA);
    var b = nodesMap.get(nodeKeyB);
    if (!a || !b) return 0;
    var dx = a.x - b.x;
    var dy = a.y - b.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  /**
   * A* pathfinding.
   * @param {string} startKey - node key
   * @param {string} endKey - node key
   * @param {string} mode - 'in' | 'out' | 'internal'
   * @returns {{ path: string[], edgeIds: string[], cost: number, error: string|null }}
   */
  function findRoute(startKey, endKey, mode) {
    var graph = GraphBuilder.getGraph();
    var nodesMap = graph.nodes;
    var edgesMap = graph.edges;

    if (!nodesMap.has(startKey)) {
      return { path: [], edgeIds: [], cost: 0, error: 'Nodo origen no existe en el grafo' };
    }
    if (!nodesMap.has(endKey)) {
      return { path: [], edgeIds: [], cost: 0, error: 'Nodo destino no existe en el grafo' };
    }
    if (startKey === endKey) {
      return { path: [startKey], edgeIds: [], cost: 0, error: null };
    }

    // State key = nodeKey + ':' + prevSegmentId (for turn restrictions)
    var open = new MinHeap();
    var gScore = {};
    var cameFrom = {};
    var closed = new Set();

    var startState = startKey + ':_start';
    gScore[startState] = 0;

    open.push({
      f: heuristic(startKey, endKey, nodesMap),
      state: startState,
      nodeKey: startKey,
      prevSeg: null
    });

    var iterations = 0;
    var MAX_ITER = 50000;

    while (open.size() > 0 && iterations < MAX_ITER) {
      iterations++;
      var current = open.pop();

      if (current.nodeKey === endKey) {
        // Reconstruct path
        return reconstructPath(current.state, cameFrom, startState);
      }

      if (closed.has(current.state)) continue;
      closed.add(current.state);

      var neighbors = edgesMap.get(current.nodeKey) || [];
      for (var i = 0; i < neighbors.length; i++) {
        var edge = neighbors[i];

        // Check turn restriction
        if (isTurnRestricted(current.prevSeg, edge, mode)) {
          if (DEBUG) console.log('[Router] Turn restricted:', current.prevSeg, '->', edge.segmentId, 'mode=' + mode);
          continue;
        }

        var nextState = edge.to + ':' + edge.segmentId;

        if (closed.has(nextState)) continue;

        var tentG = gScore[current.state] + edge.weight;

        if (gScore[nextState] === undefined || tentG < gScore[nextState]) {
          gScore[nextState] = tentG;
          cameFrom[nextState] = {
            prevState: current.state,
            nodeKey: current.nodeKey,
            segmentId: edge.segmentId
          };

          open.push({
            f: tentG + heuristic(edge.to, endKey, nodesMap),
            state: nextState,
            nodeKey: edge.to,
            prevSeg: edge.segmentId
          });
        }
      }
    }

    // No route found - diagnose
    var error = diagnoseFailure(startKey, endKey, nodesMap, edgesMap);
    return { path: [], edgeIds: [], cost: 0, error: error };
  }

  /**
   * Reconstruct path from A* cameFrom map.
   */
  function reconstructPath(endState, cameFrom, startState) {
    var path = [];
    var edgeIds = [];
    var state = endState;
    var cost = 0;

    // Extract node key from state
    function nodeFromState(s) {
      return s.split(':')[0];
    }

    path.push(nodeFromState(state));

    while (state !== startState && cameFrom[state]) {
      var step = cameFrom[state];
      edgeIds.unshift(step.segmentId);
      state = step.prevState;
      path.unshift(nodeFromState(state));
    }

    // Calculate total cost
    var graph = GraphBuilder.getGraph();
    for (var i = 0; i < edgeIds.length; i++) {
      var seg = graph.segments.get(edgeIds[i]);
      if (seg) {
        var a = graph.nodes.get(seg.startKey);
        var b = graph.nodes.get(seg.endKey);
        if (a && b) cost += GraphBuilder.dist(a, b);
      }
    }

    return { path: path, edgeIds: edgeIds, cost: cost, error: null };
  }

  /**
   * Diagnose why no route was found.
   */
  function diagnoseFailure(startKey, endKey, nodesMap, edgesMap) {
    // BFS to find connected component of start
    var visited = new Set();
    var queue = [startKey];
    visited.add(startKey);

    while (queue.length > 0) {
      var curr = queue.shift();
      var nbrs = edgesMap.get(curr) || [];
      for (var i = 0; i < nbrs.length; i++) {
        if (!visited.has(nbrs[i].to)) {
          visited.add(nbrs[i].to);
          queue.push(nbrs[i].to);
        }
      }
    }

    if (!visited.has(endKey)) {
      return 'Destino inalcanzable: componente desconectada. Origen alcanza ' +
        visited.size + '/' + nodesMap.size + ' nodos. ' +
        'Posible causa: calles no conectadas o restricciones de sentido.';
    }

    return 'Sin ruta encontrada (máximo de iteraciones alcanzado o restricciones de giro bloquean todos los caminos).';
  }

  /**
   * Determine travel mode based on origin/destination.
   * @param {string} originType - 'marquez'|'florida'|'gps'|'manual'
   * @param {string} destType - 'marquez'|'florida'|'manual'
   */
  function inferMode(originType, destType) {
    if (originType === 'marquez' || originType === 'florida') return MODE_IN;
    if (destType === 'marquez' || destType === 'florida') return MODE_OUT;
    return MODE_INTERNAL;
  }

  function setDebug(v) { DEBUG = v; }

  return {
    findRoute: findRoute,
    inferMode: inferMode,
    setDebug: setDebug,
    MODE_IN: MODE_IN,
    MODE_OUT: MODE_OUT,
    MODE_INTERNAL: MODE_INTERNAL
  };
})();
