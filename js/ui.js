/**
 * ui.js — UI interactions: origin/dest selectors, manzana dropdowns,
 *         pan/zoom (viewBox-based), toast notifications, nav panel
 *
 * Zoom is implemented by modifying the SVG viewBox directly, which keeps
 * rendering vectorially crisp at any zoom level (no CSS rasterisation).
 */
var UI = (function () {
  'use strict';

  // View state — expressed in SVG coordinate space.
  // (vx, vy) is the top-left corner of the visible window;
  // (vw, vh) is the size of the visible window (smaller = more zoom).
  var vx = 0, vy = 0, vw = 573.2, vh = 704.1;
  var baseW = 573.2, baseH = 704.1;   // original SVG dimensions
  var MIN_ZOOM = 0.5;
  var MAX_ZOOM = 8;

  var isDragging = false;
  var dragStart = { x: 0, y: 0 };
  var lastView = { x: 0, y: 0 };
  var pinchStartDist = 0;
  var pinchStartVW = 0;
  var pinchStartVH = 0;

  var svgWrapper = null;
  var svgEl = null;
  var mapContainer = null;

  /** Initialize UI: bind events, populate dropdowns */
  function init(manzanaIds) {
    svgWrapper = document.getElementById('svg-wrapper');
    mapContainer = document.getElementById('map-container');
    svgEl = SvgLoader.getSvg();

    var vb = SvgLoader.getViewBox();
    baseW = vb.w; baseH = vb.h;
    vx = vb.x; vy = vb.y; vw = vb.w; vh = vb.h;

    populateManzanas(manzanaIds);
    bindSelectors();
    bindPanZoom();
    bindMapControls();
    fitMapToScreen();
  }

  /** Populate manzana dropdowns */
  function populateManzanas(manzanaIds) {
    var sorted = manzanaIds.slice().sort(function (a, b) {
      return parseInt(a, 10) - parseInt(b, 10);
    });

    ['origin-manzana', 'dest-manzana'].forEach(function (id) {
      var sel = document.getElementById(id);
      sel.innerHTML = '<option value="">Manzana…</option>';
      sorted.forEach(function (m) {
        var opt = document.createElement('option');
        opt.value = m;
        opt.textContent = 'Manzana ' + m;
        sel.appendChild(opt);
      });
    });
  }

  /** Bind origin/dest selector logic */
  function bindSelectors() {
    var originSel = document.getElementById('origin-select');
    var destSel = document.getElementById('dest-select');
    var originManual = document.getElementById('origin-manual');
    var destManual = document.getElementById('dest-manual');

    originSel.addEventListener('change', function () {
      originManual.classList.toggle('hidden', originSel.value !== 'manual');
    });

    destSel.addEventListener('change', function () {
      destManual.classList.toggle('hidden', destSel.value !== 'manual');
    });
  }

  /** Get origin config */
  function getOrigin() {
    var sel = document.getElementById('origin-select');
    if (sel.value === 'manual') {
      return { type: 'manual', manzana: document.getElementById('origin-manzana').value };
    }
    return { type: sel.value };
  }

  /** Get destination config */
  function getDest() {
    var sel = document.getElementById('dest-select');
    if (sel.value === 'manual') {
      return { type: 'manual', manzana: document.getElementById('dest-manzana').value };
    }
    return { type: sel.value };
  }

  // === Pan & Zoom (viewBox-based for crisp vector rendering) ===

  /** Apply the current view to the SVG viewBox */
  function applyTransform() {
    if (svgEl) {
      svgEl.setAttribute('viewBox', vx + ' ' + vy + ' ' + vw + ' ' + vh);
    }
  }

  /** Current zoom factor (baseW / vw) */
  function currentZoom() {
    return baseW / vw;
  }

  function fitMapToScreen() {
    // Make SVG wrapper fill the container
    svgWrapper.style.width = '100%';
    svgWrapper.style.height = '100%';
    if (svgEl) {
      svgEl.style.width = '100%';
      svgEl.style.height = '100%';
      svgEl.removeAttribute('width');
      svgEl.removeAttribute('height');
    }

    var cw = mapContainer.clientWidth;
    var ch = mapContainer.clientHeight;
    var containerAspect = cw / ch;
    var svgAspect = baseW / baseH;

    // Fit with small padding (95%)
    if (containerAspect > svgAspect) {
      // Container is wider — fit height
      vh = baseH / 0.95;
      vw = vh * containerAspect;
    } else {
      // Container is taller — fit width
      vw = baseW / 0.95;
      vh = vw / containerAspect;
    }
    // Center
    vx = (baseW - vw) / 2;
    vy = (baseH - vh) / 2;

    applyTransform();
  }

  /**
   * Convert screen (client) coordinates to SVG coordinates.
   * This is the key function that lets pan/zoom work correctly.
   */
  function clientToSvg(clientX, clientY) {
    var rect = svgWrapper.getBoundingClientRect();
    var fracX = (clientX - rect.left) / rect.width;
    var fracY = (clientY - rect.top) / rect.height;
    return {
      x: vx + fracX * vw,
      y: vy + fracY * vh
    };
  }

  function bindPanZoom() {
    // Mouse events
    mapContainer.addEventListener('mousedown', function (e) {
      if (e.button !== 0) return;
      isDragging = true;
      dragStart = { x: e.clientX, y: e.clientY };
      lastView = { x: vx, y: vy };
      mapContainer.style.cursor = 'grabbing';
    });

    window.addEventListener('mousemove', function (e) {
      if (!isDragging) return;
      var rect = svgWrapper.getBoundingClientRect();
      var dxPx = e.clientX - dragStart.x;
      var dyPx = e.clientY - dragStart.y;
      // Convert screen pixels to SVG units
      vx = lastView.x - dxPx * (vw / rect.width);
      vy = lastView.y - dyPx * (vh / rect.height);
      applyTransform();
    });

    window.addEventListener('mouseup', function () {
      isDragging = false;
      mapContainer.style.cursor = '';
    });

    // Wheel zoom
    mapContainer.addEventListener('wheel', function (e) {
      e.preventDefault();
      var factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      zoomAt(e.clientX, e.clientY, factor);
    }, { passive: false });

    // Touch events
    var activeTouches = [];

    mapContainer.addEventListener('touchstart', function (e) {
      activeTouches = Array.from(e.touches);
      if (activeTouches.length === 1) {
        isDragging = true;
        dragStart = { x: activeTouches[0].clientX, y: activeTouches[0].clientY };
        lastView = { x: vx, y: vy };
      } else if (activeTouches.length === 2) {
        isDragging = false;
        pinchStartDist = touchDist(activeTouches[0], activeTouches[1]);
        pinchStartVW = vw;
        pinchStartVH = vh;
      }
    }, { passive: true });

    mapContainer.addEventListener('touchmove', function (e) {
      e.preventDefault();
      var touches = Array.from(e.touches);
      if (touches.length === 1 && isDragging) {
        var rect = svgWrapper.getBoundingClientRect();
        var dxPx = touches[0].clientX - dragStart.x;
        var dyPx = touches[0].clientY - dragStart.y;
        vx = lastView.x - dxPx * (vw / rect.width);
        vy = lastView.y - dyPx * (vh / rect.height);
        applyTransform();
      } else if (touches.length === 2) {
        var d = touchDist(touches[0], touches[1]);
        var scale = pinchStartDist / d; // inverse: pinch-out → smaller viewBox = zoom in

        var newVW = pinchStartVW * scale;
        var newVH = pinchStartVH * scale;

        // Clamp zoom
        var newZoom = baseW / newVW;
        if (newZoom < MIN_ZOOM) { newVW = baseW / MIN_ZOOM; newVH = baseH / MIN_ZOOM * (newVW / (baseW / MIN_ZOOM)); }
        if (newZoom > MAX_ZOOM) { newVW = baseW / MAX_ZOOM; newVH = baseH / MAX_ZOOM * (newVW / (baseW / MAX_ZOOM)); }

        // Zoom centered on pinch midpoint
        var cx = (touches[0].clientX + touches[1].clientX) / 2;
        var cy = (touches[0].clientY + touches[1].clientY) / 2;
        var svgPt = clientToSvg(cx, cy);

        var fracX = (svgPt.x - vx) / vw;
        var fracY = (svgPt.y - vy) / vh;

        vw = newVW;
        vh = newVH;
        vx = svgPt.x - fracX * vw;
        vy = svgPt.y - fracY * vh;
        applyTransform();
      }
    }, { passive: false });

    mapContainer.addEventListener('touchend', function () {
      isDragging = false;
    }, { passive: true });
  }

  function touchDist(a, b) {
    var dx = a.clientX - b.clientX;
    var dy = a.clientY - b.clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  /** Zoom at a screen point by the given factor (>1 = zoom in) */
  function zoomAt(clientX, clientY, factor) {
    var z = currentZoom() * factor;
    z = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z));

    var svgPt = clientToSvg(clientX, clientY);
    var newVW = baseW / z;
    var newVH = baseH / z;

    // Keep the SVG point under the cursor fixed
    var fracX = (svgPt.x - vx) / vw;
    var fracY = (svgPt.y - vy) / vh;
    vw = newVW;
    vh = newVH;
    vx = svgPt.x - fracX * vw;
    vy = svgPt.y - fracY * vh;
    applyTransform();
  }

  /** Center the map on a SVG coordinate */
  function centerOnSvg(svgX, svgY) {
    vx = svgX - vw / 2;
    vy = svgY - vh / 2;
    applyTransform();
  }

  function bindMapControls() {
    document.getElementById('btn-zoom-in').addEventListener('click', function () {
      var cx = mapContainer.clientWidth / 2;
      var cy = mapContainer.clientHeight / 2;
      zoomAt(cx, cy, 1.4);
    });

    document.getElementById('btn-zoom-out').addEventListener('click', function () {
      var cx = mapContainer.clientWidth / 2;
      var cy = mapContainer.clientHeight / 2;
      zoomAt(cx, cy, 1 / 1.4);
    });
  }

  // === Toast ===

  var toastTimer = null;

  function showToast(msg, type, duration) {
    type = type || 'error';
    duration = duration || 4000;
    var t = document.getElementById('toast');
    t.textContent = msg;
    t.className = type;
    t.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      t.classList.add('hidden');
    }, duration);
  }

  // === Nav panel ===

  function showNavPanel(instruction, distance) {
    var panel = document.getElementById('nav-panel');
    panel.classList.remove('hidden');
    document.getElementById('nav-instruction').textContent = instruction;
    document.getElementById('nav-distance').textContent = distance || '';
  }

  function hideNavPanel() {
    document.getElementById('nav-panel').classList.add('hidden');
  }

  function updateNavInstruction(instruction, distance) {
    document.getElementById('nav-instruction').textContent = instruction;
    document.getElementById('nav-distance').textContent = distance || '';
  }

  /** Show/hide route panel buttons */
  function setNavigating(active) {
    document.getElementById('btn-clear').classList.toggle('hidden', !active);
    document.getElementById('route-panel').style.display = active ? 'none' : '';
    document.body.classList.toggle('navigating', active);
  }

  return {
    init: init,
    getOrigin: getOrigin,
    getDest: getDest,
    centerOnSvg: centerOnSvg,
    fitMapToScreen: fitMapToScreen,
    showToast: showToast,
    showNavPanel: showNavPanel,
    hideNavPanel: hideNavPanel,
    updateNavInstruction: updateNavInstruction,
    setNavigating: setNavigating
  };
})();
