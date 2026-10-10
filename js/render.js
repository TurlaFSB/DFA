/*
 * render.js — SVG diagram for a DFA: auto layout, curved edges, draggable nodes,
 * highlighting and a token that travels along the transition being taken.
 */
(function (root) {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';
  const R = 26;            // node radius
  const GAP_X = 170, GAP_Y = 125, PAD = 50;

  function el(name, attrs, parent) {
    const e = document.createElementNS(NS, name);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  const unit = (x, y) => { const d = Math.hypot(x, y) || 1; return { x: x / d, y: y / d }; };

  class DFAView {
    constructor(svg) {
      this.svg = svg;
      this.dfa = null;
      this.pos = [];
      this.hideDead = false;
      this.active = null;       // current state
      this.edgeKey = null;      // "u>v" currently being traversed
      this.verdict = null;      // 'ok' | 'bad' | null
      this.job = 0;             // token animation id
      this.nodeEls = [];
      this.edgeEls = {};
    }

    setDFA(dfa) { this.dfa = dfa; this.active = dfa.start; this.edgeKey = null; this.verdict = null; this.autoLayout(); this.draw(); }
    setHideDead(v) { this.hideDead = v; this.autoLayout(); this.draw(); }

    /* ---------- layout ---------- */
    autoLayout() {
      const d = this.dfa, n = d.n;
      const layer = Array(n).fill(-1);
      layer[d.start] = 0;
      const order = [d.start];
      for (let i = 0; i < order.length; i++) {
        d.delta[order[i]].forEach(t => {
          if (layer[t] < 0 && !d.isDead[t]) { layer[t] = layer[order[i]] + 1; order.push(t); }
        });
      }
      const maxL = Math.max(0, ...layer);
      const cols = Array.from({ length: maxL + 1 }, () => []);
      order.forEach(s => cols[layer[s]].push(s));
      // reduce crossings: sort each column by the average row of its predecessors
      const row = Array(n).fill(0);
      cols[0].forEach((s, i) => (row[s] = i));
      for (let l = 1; l <= maxL; l++) {
        const score = s => {
          const ps = [];
          for (let p = 0; p < n; p++) if (layer[p] === l - 1 && d.delta[p].includes(s)) ps.push(row[p]);
          return ps.length ? ps.reduce((a, b) => a + b, 0) / ps.length : 1e9;
        };
        cols[l].sort((a, b) => score(a) - score(b));
        cols[l].forEach((s, i) => (row[s] = i));
      }
      const maxRows = Math.max(...cols.map(c => c.length));
      const H = (maxRows - 1) * GAP_Y;
      this.pos = Array(n).fill(null).map(() => ({ x: 0, y: 0 }));
      cols.forEach((col, l) => {
        col.forEach((s, i) => {
          this.pos[s] = { x: PAD + 70 + l * GAP_X, y: PAD + 60 + (H - (col.length - 1) * GAP_Y) / 2 + i * GAP_Y };
        });
      });
      // trap / unreachable states go in a row underneath
      let k = 0;
      for (let s = 0; s < n; s++) {
        if (layer[s] < 0) {
          this.pos[s] = { x: PAD + 70 + (k + Math.max(0, maxL - 1) / 2) * GAP_X, y: PAD + 60 + H + GAP_Y + 10 };
          k++;
        }
      }
    }

    theme() {
      const cs = getComputedStyle(document.documentElement);
      const g = n => cs.getPropertyValue(n).trim();
      return {
        bg: g('--panel'), node: g('--node'), stroke: g('--stroke'), text: g('--text'), muted: g('--muted'),
        edge: g('--edge'), accent: g('--accent'), accentSoft: g('--accent-soft'),
        ok: g('--ok'), okSoft: g('--ok-soft'), bad: g('--bad'), badSoft: g('--bad-soft'),
      };
    }

    styleText(T) {
      return `
      .edge-path{fill:none;stroke:${T.edge};stroke-width:1.8}
      .edge.dead .edge-path{opacity:.5;stroke-dasharray:6 4}
      .edge.dead .edge-label{opacity:.6}
      .edge.on .edge-path{stroke:${T.accent};stroke-width:3.4;opacity:1}
      .edge-label{font:600 15px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;fill:${T.text};text-anchor:middle;paint-order:stroke;stroke:${T.bg};stroke-width:5px;stroke-linejoin:round}
      .edge.on .edge-label{fill:${T.accent}}
      .arrow{fill:${T.edge}} .arrow-on{fill:${T.accent}}
      .node{cursor:grab}
      .node-c{fill:${T.node};stroke:${T.stroke};stroke-width:2.2;transition:fill .25s,stroke .25s}
      .node-in{fill:none;stroke:${T.stroke};stroke-width:2}
      .node-t{font:600 17px ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif;fill:${T.text};text-anchor:middle;pointer-events:none}
      .node-t tspan.sub{font-size:12px}
      .node.dead .node-c{stroke-dasharray:5 4;opacity:.75}
      .node.cur .node-c{fill:${T.accentSoft};stroke:${T.accent};stroke-width:4}
      .node.cur .node-in{stroke:${T.accent}}
      .node.cur.ok .node-c{fill:${T.okSoft};stroke:${T.ok}} .node.cur.ok .node-in{stroke:${T.ok}}
      .node.cur.bad .node-c{fill:${T.badSoft};stroke:${T.bad}} .node.cur.bad .node-in{stroke:${T.bad}}
      .start-arrow{stroke:${T.edge};stroke-width:2;fill:none}
      .start-label{font:600 12px ui-sans-serif,system-ui,sans-serif;fill:${T.muted};text-anchor:middle}
      .token{fill:${T.accent};stroke:${T.bg};stroke-width:2.5}
      `;
    }

    /* ---------- drawing ---------- */
    draw() {
      const d = this.dfa, svg = this.svg, T = this.theme();
      svg.innerHTML = '';
      svg.setAttribute('xmlns', NS);
      el('style', {}, svg).textContent = this.styleText(T);
      const defs = el('defs', {}, svg);
      for (const [id, cls] of [['arr', 'arrow'], ['arr-on', 'arrow-on']]) {
        const m = el('marker', { id, viewBox: '0 0 10 10', refX: 9, refY: 5, markerUnits: 'userSpaceOnUse', markerWidth: 12, markerHeight: 12, orient: 'auto' }, defs);
        el('path', { d: 'M0,0 L10,5 L0,10 z', class: cls }, m);
      }
      const gE = el('g', {}, svg), gN = el('g', {}, svg), gT = el('g', { id: 'token-layer' }, svg);
      this.tokenLayer = gT;
      this.edgeEls = {};
      this.nodeEls = [];
      const vis = s => !(this.hideDead && d.isDead[s]);

      // group edges
      const groups = new Map();
      for (let s = 0; s < d.n; s++) {
        if (!vis(s)) continue;
        d.delta[s].forEach((t, ci) => {
          if (!vis(t)) return;
          const key = s + '>' + t;
          if (!groups.has(key)) groups.set(key, { u: s, v: t, syms: [] });
          groups.get(key).syms.push(d.alphabet[ci]);
        });
      }
      const pairs = new Set([...groups.keys()]);
      const loopDown = s => d.isDead[s] && this.pos[s].y > 200;
      const obstacles = [];
      for (let s = 0; s < d.n; s++) {
        if (!vis(s)) continue;
        obstacles.push({ x: this.pos[s].x, y: this.pos[s].y, r: R + 12, owner: s, loop: false });
        if (groups.has(s + '>' + s)) obstacles.push({ x: this.pos[s].x, y: this.pos[s].y + (loopDown(s) ? 1.7 : -1.7) * R, r: R * 1.05 + 8, owner: s, loop: true });
      }

      for (const [key, e] of groups) {
        const label = e.syms.length === d.alphabet.length && d.alphabet.length > 2 ? 'Σ' : e.syms.join(',');
        const g = el('g', { class: 'edge' + (d.isDead[e.u] || d.isDead[e.v] ? ' dead' : '') }, gE);
        let dPath, lx, ly;
        const p = this.pos[e.u];
        if (e.u === e.v) {
          const down = loopDown(e.u);
          const sgn = down ? 1 : -1;
          dPath = `M${p.x - 0.55 * R},${p.y + sgn * 0.84 * R} C${p.x - 1.3 * R},${p.y + sgn * 2.6 * R} ${p.x + 1.3 * R},${p.y + sgn * 2.6 * R} ${p.x + 0.55 * R},${p.y + sgn * 0.84 * R}`;
          lx = p.x; ly = p.y + sgn * 2.25 * R + (down ? 14 : -6);
        } else {
          const q = this.pos[e.v];
          const hasRev = pairs.has(e.v + '>' + e.u);
          const cands = hasRev ? [0.28, 0.42, 0.58] : [0, 0.22, -0.22, 0.4, -0.4, 0.6, -0.6];
          let best = null;
          for (const cv of cands) {
            const geo = this.edgeGeom(p, q, cv);
            const clear = obstacles.every(o => (!o.loop && (o.owner === e.u || o.owner === e.v)) || this.curveClear(geo, o));
            if (clear) { best = geo; break; }
            if (!best) best = geo;
          }
          dPath = best.d; lx = best.lx; ly = best.ly;
        }
        const path = el('path', { d: dPath, class: 'edge-path', 'marker-end': 'url(#arr)' }, g);
        const txt = el('text', { class: 'edge-label', x: lx, y: ly + 5 }, g);
        txt.textContent = label;
        this.edgeEls[key] = { g, path, u: e.u, v: e.v };
      }

      // nodes
      let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
      for (let s = 0; s < d.n; s++) {
        if (!vis(s)) continue;
        const p = this.pos[s];
        minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
        const g = el('g', { class: 'node' + (d.isDead[s] ? ' dead' : ''), transform: `translate(${p.x},${p.y})` }, gN);
        el('circle', { r: R, class: 'node-c' }, g);
        if (d.accept[s]) el('circle', { r: R - 5.5, class: 'node-in' }, g);
        const t = el('text', { class: 'node-t', y: 6 }, g);
        t.appendChild(document.createTextNode('q'));
        const sub = el('tspan', { class: 'sub', dy: 4 }, t);
        sub.textContent = s;
        const title = el('title', {}, g);
        title.textContent = 'q' + s + (d.accept[s] ? ' (final)' : '') + (d.isDead[s] ? ' (trap state)' : '') + ' — drag to move';
        this.nodeEls[s] = g;
        g.addEventListener('pointerdown', ev => this.startDrag(ev, s));
      }
      // start arrow
      if (vis(d.start)) {
        const p = this.pos[d.start];
        el('path', { d: `M${p.x - R - 46},${p.y} L${p.x - R - 2},${p.y}`, class: 'start-arrow', 'marker-end': 'url(#arr)' }, gE);
        const st = el('text', { class: 'start-label', x: p.x - R - 38, y: p.y - 9 }, gE);
        st.textContent = 'start';
      }

      const x0 = minX - 110, x1 = maxX + 70, y0 = minY - 95, y1 = maxY + 85;
      this.vb = { x: x0, y: y0, w: Math.max(420, x1 - x0), h: Math.max(240, y1 - y0) };
      svg.setAttribute('viewBox', `${this.vb.x} ${this.vb.y} ${this.vb.w} ${this.vb.h}`);
      this.applyState();
      if (this.onDraw) this.onDraw(this.vb);
    }

    edgeGeom(p, q, curv) {
      const dx = q.x - p.x, dy = q.y - p.y, dist = Math.hypot(dx, dy) || 1;
      const nx = -dy / dist, ny = dx / dist;
      const c = { x: (p.x + q.x) / 2 + nx * curv * dist, y: (p.y + q.y) / 2 + ny * curv * dist };
      const a = unit(c.x - p.x, c.y - p.y), b = unit(c.x - q.x, c.y - q.y);
      const P0 = { x: p.x + a.x * R, y: p.y + a.y * R }, P1 = { x: q.x + b.x * (R + 3), y: q.y + b.y * (R + 3) };
      const mid = { x: 0.25 * P0.x + 0.5 * c.x + 0.25 * P1.x, y: 0.25 * P0.y + 0.5 * c.y + 0.25 * P1.y };
      const side = curv === 0 ? -1 : Math.sign(curv);
      return { P0, c, P1, d: `M${P0.x},${P0.y} Q${c.x},${c.y} ${P1.x},${P1.y}`, lx: mid.x + nx * side * 15, ly: mid.y + ny * side * 15 };
    }
    curveClear(geo, node) {
      for (let t = 0.12; t <= 0.88; t += 0.08) {
        const x = (1 - t) * (1 - t) * geo.P0.x + 2 * (1 - t) * t * geo.c.x + t * t * geo.P1.x;
        const y = (1 - t) * (1 - t) * geo.P0.y + 2 * (1 - t) * t * geo.c.y + t * t * geo.P1.y;
        if (Math.hypot(x - node.x, y - node.y) < node.r) return false;
      }
      return true;
    }

    /* ---------- dragging ---------- */
    startDrag(ev, s) {
      ev.preventDefault();
      const svg = this.svg;
      const toSvg = e => {
        const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
        return pt.matrixTransform(svg.getScreenCTM().inverse());
      };
      const start = toSvg(ev), orig = { ...this.pos[s] };
      const move = e => {
        const p = toSvg(e);
        this.pos[s] = { x: orig.x + p.x - start.x, y: orig.y + p.y - start.y };
        this.draw();
      };
      const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    }

    /* ---------- state / animation ---------- */
    applyState() {
      this.nodeEls.forEach((g, s) => {
        if (!g) return;
        g.classList.toggle('cur', s === this.active);
        g.classList.toggle('ok', s === this.active && this.verdict === 'ok');
        g.classList.toggle('bad', s === this.active && this.verdict === 'bad');
      });
      for (const key in this.edgeEls) {
        const on = key === this.edgeKey;
        const e = this.edgeEls[key];
        e.g.classList.toggle('on', on);
        e.path.setAttribute('marker-end', on ? 'url(#arr-on)' : 'url(#arr)');
      }
    }
    setActive(s) { this.active = s; this.applyState(); }
    setVerdict(v) { this.verdict = v; this.applyState(); }
    setEdge(u, v) { this.edgeKey = u == null ? null : u + '>' + v; this.applyState(); }

    cancelToken() { this.job++; if (this.tokenLayer) this.tokenLayer.innerHTML = ''; }

    moveToken(u, v, ms, done) {
      const job = ++this.job;
      this.tokenLayer.innerHTML = '';
      const e = this.edgeEls[u + '>' + v];
      if (!e) { setTimeout(() => job === this.job && done(), ms); return; }
      const len = e.path.getTotalLength();
      const tok = el('circle', { r: 8, class: 'token' }, this.tokenLayer);
      const t0 = performance.now();
      const frame = now => {
        if (job !== this.job) return;
        const k = Math.min(1, (now - t0) / ms);
        const ease = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
        const pt = e.path.getPointAtLength(len * ease);
        tok.setAttribute('cx', pt.x); tok.setAttribute('cy', pt.y);
        if (k < 1) requestAnimationFrame(frame);
        else { this.tokenLayer.innerHTML = ''; done(); }
      };
      requestAnimationFrame(frame);
    }

    /* ---------- export ---------- */
    svgString() {
      const clone = this.svg.cloneNode(true);
      const tl = clone.querySelector('#token-layer'); if (tl) tl.innerHTML = '';
      clone.setAttribute('width', Math.round(this.vb.w)); clone.setAttribute('height', Math.round(this.vb.h));
      const bg = el('rect', { x: this.vb.x, y: this.vb.y, width: this.vb.w, height: this.vb.h, fill: this.theme().bg });
      clone.insertBefore(bg, clone.children[1]);
      return new XMLSerializer().serializeToString(clone);
    }
    toPNG(cb) {
      const svgStr = this.svgString();
      const img = new Image();
      img.onload = () => {
        const sc = 2, c = document.createElement('canvas');
        c.width = this.vb.w * sc; c.height = this.vb.h * sc;
        const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0, c.width, c.height);
        c.toBlob(cb, 'image/png');
      };
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgStr);
    }
  }

  root.DFAView = DFAView;
})(window);
