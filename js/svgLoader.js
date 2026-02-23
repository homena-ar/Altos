/**
 * svgLoader.js — Load SVG map, fix namespaces, inject into DOM
 */
const SvgLoader = (function () {
  'use strict';

  let svgElement = null;
  let svgDoc = null;

  /**
   * Fetch SVG, strip ns0: namespace prefix, inject into container.
   * @param {string} url - Path to SVG file
   * @param {string} containerId - DOM id of wrapper element
   * @returns {Promise<SVGSVGElement>}
   */
  async function load(url, containerId) {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error('No se pudo cargar el SVG: ' + resp.status);

    let text = await resp.text();

    // Strip ns0: namespace prefix (Illustrator artifact)
    text = text.replace(/<\/?ns0:/g, function (m) {
      return m.startsWith('</') ? '</' : '<';
    });
    text = text.replace(/xmlns:ns0=/g, 'xmlns=');

    const parser = new DOMParser();
    svgDoc = parser.parseFromString(text, 'image/svg+xml');

    const parsedSvg = svgDoc.querySelector('svg');
    if (!parsedSvg) throw new Error('SVG inválido');

    // Import into main document
    svgElement = document.importNode(parsedSvg, true);

    // Ensure overlays group exists
    let overlays = svgElement.querySelector('#overlays');
    if (!overlays) {
      overlays = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      overlays.id = 'overlays';
      svgElement.appendChild(overlays);
    }

    const container = document.getElementById(containerId);
    container.innerHTML = '';
    container.appendChild(svgElement);

    return svgElement;
  }

  /** @returns {SVGSVGElement|null} */
  function getSvg() {
    return svgElement;
  }

  /**
   * Get all street segments from #streets group.
   * @returns {SVGElement[]}
   */
  function getStreetElements() {
    if (!svgElement) return [];
    const g = svgElement.querySelector('#streets');
    if (!g) return [];
    return Array.from(g.children).filter(function (el) {
      return el.id && el.id.startsWith('st_');
    });
  }

  /**
   * Get control points (entries, manzana starts).
   * @returns {{ florida: {x,y}, marquez: {x,y}, manzanas: Object.<string,{x,y}> }}
   */
  function getControlPoints() {
    var result = { florida: null, marquez: null, manzanas: {} };
    if (!svgElement) return result;

    var ctrlFlorida = svgElement.querySelector('#ctrl_florida');
    if (ctrlFlorida) {
      result.florida = {
        x: parseFloat(ctrlFlorida.getAttribute('cx')),
        y: parseFloat(ctrlFlorida.getAttribute('cy'))
      };
    }

    var ctrlMarquez = svgElement.querySelector('#ctrl_marquez');
    if (ctrlMarquez) {
      result.marquez = {
        x: parseFloat(ctrlMarquez.getAttribute('cx')),
        y: parseFloat(ctrlMarquez.getAttribute('cy'))
      };
    }

    // Manzana start points
    var all = svgElement.querySelectorAll('[id^="start_M"]');
    all.forEach(function (el) {
      var m = el.id.match(/^start_M(\d+)$/);
      if (m) {
        result.manzanas[m[1]] = {
          x: parseFloat(el.getAttribute('cx')),
          y: parseFloat(el.getAttribute('cy'))
        };
      }
    });

    return result;
  }

  /**
   * Get SVG viewBox dimensions.
   * @returns {{ x:number, y:number, w:number, h:number }}
   */
  function getViewBox() {
    if (!svgElement) return { x: 0, y: 0, w: 573.2, h: 704.1 };
    var vb = svgElement.getAttribute('viewBox');
    if (!vb) return { x: 0, y: 0, w: 573.2, h: 704.1 };
    var p = vb.split(/[\s,]+/).map(Number);
    return { x: p[0], y: p[1], w: p[2], h: p[3] };
  }

  return { load: load, getSvg: getSvg, getStreetElements: getStreetElements, getControlPoints: getControlPoints, getViewBox: getViewBox };
})();
