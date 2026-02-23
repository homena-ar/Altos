/**
 * ui.js — UI interactions: origin/dest selectors, manzana dropdowns,
 *         pan/zoom, toast notifications, nav panel
 */
var UI = (function () {
  'use strict';

  // Pan & Zoom state
  var pan = { x: 0, y: 0 };
  var zoom = 1;
  var MIN_ZOOM = 0.5;
  var MAX_ZOOM = 8;
  var isDragging = false;
  var dragStart = { x: 0, y: 0 };
  var lastPan = { x: 0, y: 0 };
  var pinchStartDist = 0;
  var pinchStartZoom = 1;

  var svgWrapper = null;
  var mapContainer = null;

  /** Initialize UI: bind events, populate dropdowns */
  function init(manzanaIds) {
    svgWrapper = document.getElementById('svg-wrapper');
    mapContainer = document.getElementById('map-container');

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

  // === Pan & Zoom ===

  function applyTransform() {
    svgWrapper.style.transform = 'translate(' + pan.x + 'px,' + pan.y + 'px) scale(' + zoom + ')';
  }

  function fitMapToScreen() {
    var vb = SvgLoader.getViewBox();
    var cw = mapContainer.clientWidth;
    var ch = mapContainer.clientHeight;

    // Fit SVG into container
    var scaleX = cw / vb.w;
    var scaleY = ch / vb.h;
    zoom = Math.min(scaleX, scaleY) * 0.95;

    // Center
    var svgW = vb.w * zoom;
    var svgH = vb.h * zoom;
    pan.x = (cw - svgW) / 2;
    pan.y = (ch - svgH) / 2;

    svgWrapper.style.width = vb.w + 'px';
    svgWrapper.style.height = vb.h + 'px';
    applyTransform();
  }

  function bindPanZoom() {
    // Mouse events
    mapContainer.addEventListener('mousedown', function (e) {
      if (e.button !== 0) return;
      isDragging = true;
      dragStart = { x: e.clientX, y: e.clientY };
      lastPan = { x: pan.x, y: pan.y };
      mapContainer.style.cursor = 'grabbing';
    });

    window.addEventListener('mousemove', function (e) {
      if (!isDragging) return;
      pan.x = lastPan.x + (e.clientX - dragStart.x);
      pan.y = lastPan.y + (e.clientY - dragStart.y);
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
        lastPan = { x: pan.x, y: pan.y };
      } else if (activeTouches.length === 2) {
        isDragging = false;
        pinchStartDist = touchDist(activeTouches[0], activeTouches[1]);
        pinchStartZoom = zoom;
      }
    }, { passive: true });

    mapContainer.addEventListener('touchmove', function (e) {
      e.preventDefault();
      var touches = Array.from(e.touches);
      if (touches.length === 1 && isDragging) {
        pan.x = lastPan.x + (touches[0].clientX - dragStart.x);
        pan.y = lastPan.y + (touches[0].clientY - dragStart.y);
        applyTransform();
      } else if (touches.length === 2) {
        var d = touchDist(touches[0], touches[1]);
        var newZoom = pinchStartZoom * (d / pinchStartDist);
        newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, newZoom));

        var cx = (touches[0].clientX + touches[1].clientX) / 2;
        var cy = (touches[0].clientY + touches[1].clientY) / 2;

        pan.x = cx - (cx - pan.x) * (newZoom / zoom);
        pan.y = cy - (cy - pan.y) * (newZoom / zoom);
        zoom = newZoom;
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

  function zoomAt(clientX, clientY, factor) {
    var newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom * factor));
    pan.x = clientX - (clientX - pan.x) * (newZoom / zoom);
    pan.y = clientY - (clientY - pan.y) * (newZoom / zoom);
    zoom = newZoom;
    applyTransform();
  }

  /** Center the map on a SVG coordinate */
  function centerOnSvg(svgX, svgY) {
    var cw = mapContainer.clientWidth;
    var ch = mapContainer.clientHeight;
    pan.x = cw / 2 - svgX * zoom;
    pan.y = ch / 2 - svgY * zoom;
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
