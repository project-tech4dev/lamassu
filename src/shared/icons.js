// Inline SVG icons built with DOM calls (no markup strings, no remote images).
(function (root) {
  'use strict';
  const DV = root.DV || (root.DV = {});

  // XML namespace identifier required by createElementNS. It is never fetched.
  const SVG_NS = 'http://www.w3.org/2000/svg';

  const SHAPES = {
    globe: [['circle', { cx: 12, cy: 12, r: 9 }], ['ellipse', { cx: 12, cy: 12, rx: 4, ry: 9 }], ['path', { d: 'M3 12h18' }]],
    link: [['path', { d: 'M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1' }], ['path', { d: 'M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1' }]],
    alert: [['path', { d: 'M12 3 2.5 20h19z' }], ['path', { d: 'M12 10v4' }], ['path', { d: 'M12 17h.01' }]],
    help: [['circle', { cx: 12, cy: 12, r: 9 }], ['path', { d: 'M9.5 9.5a2.5 2.5 0 1 1 3.3 2.4c-.5.2-.8.6-.8 1.1V14' }], ['path', { d: 'M12 17h.01' }]],
    building: [['rect', { x: 5, y: 3, width: 14, height: 18, rx: 1 }], ['path', { d: 'M9 7h1M14 7h1M9 11h1M14 11h1M10 21v-4h4v4' }]],
    people: [['circle', { cx: 9, cy: 8, r: 3 }], ['path', { d: 'M3 20a6 6 0 0 1 12 0' }], ['circle', { cx: 17, cy: 9, r: 2.5 }], ['path', { d: 'M16.5 14a5 5 0 0 1 4.5 5' }]],
    lock: [['rect', { x: 5, y: 11, width: 14, height: 10, rx: 2 }], ['path', { d: 'M8 11V7a4 4 0 0 1 8 0v4' }]],
    clock: [['circle', { cx: 12, cy: 12, r: 9 }], ['path', { d: 'M12 7v5l3 2' }]],
    refresh: [['path', { d: 'M20 12a8 8 0 1 1-2.34-5.66' }], ['path', { d: 'M20 4v5h-5' }]],
    minimize: [['path', { d: 'M6 12h12' }]],
    expand: [['path', { d: 'M8 4H4v4M16 4h4v4M8 20H4v-4M16 20h4v-4' }]],
  };

  function create(name, doc) {
    const d = doc || document;
    const svg = d.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    for (const [tag, attrs] of SHAPES[name] || SHAPES.help) {
      const el = d.createElementNS(SVG_NS, tag);
      for (const k of Object.keys(attrs)) el.setAttribute(k, String(attrs[k]));
      svg.appendChild(el);
    }
    return svg;
  }

  DV.icons = { create, NAMES: Object.keys(SHAPES) };
})(globalThis);
