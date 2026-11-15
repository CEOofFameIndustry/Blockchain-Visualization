// Полотно з нодами-блоками та хвилястими зв'язками між ними (Canvas 2D).
//
// Рух зв'язку: зміщення точки u ∈ [0, 1] перпендикулярно до прямої
//   off(u) = sin(πu) · A(t) · [ sin(2πk(t)u − φ(t)) + 0.3 · sin(2π·1.7k(t)u + 0.6φ(t) + s) ]
// де фаза φ накопичується з кутовою швидкістю ω(t), яка сама повільно змінюється.
// Тому хвиля схожа на синус, але її період не сталий. sin(πu) тримає кінці на нодах.

const R = 22;               // радіус ноди у світових координатах
const SPACING = 150;        // відстань між сусідніми блоками
const SAMPLES = 40;         // точок на одну криву
const TAU = Math.PI * 2;
const SANS = 'system-ui, -apple-system, "Segoe UI", sans-serif';
const MONO = 'ui-monospace, "JetBrains Mono", Menlo, monospace';

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const rand = (seed) => {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};
const easeOutBack = (t) => {
  const c = 1.5;
  const u = t - 1;
  return 1 + (c + 1) * u * u * u + c * u * u;
};
const baseX = (i) => i * SPACING;
const baseY = (i) => Math.sin(i * 1.3) * 34;

export class Graph {
  constructor(canvas, { onSelect } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.onSelect = onSelect ?? (() => {});

    this.nodes = [];          // nodes[i] — блок i
    this.edges = [];          // edges[i] — зв'язок (i − 1) → i
    this.firstInvalid = null;
    this.pending = null;      // «привид» блоку, який зараз майниться
    this.pulse = null;        // анімація перевірки ланцюга

    this.cam = { x: 0, y: 0, z: 1 };
    this.target = { x: 0, y: 0, z: 1 };
    this.inset = { left: 0, right: 0, bottom: 0 };
    this.view = null; // інсет, що плавно наздоганяє this.inset (панелі виїжджають з анімацією)
    this.selected = null;
    this.hover = null;
    this.drag = null;

    this.clock = 0;           // час руху (зупиняється на паузі)
    this.real = 0;            // реальний час (для появи та спалахів)
    this.motion = 1;
    this.motionTarget = 1;
    this.last = performance.now();

    if (matchMedia('(prefers-reduced-motion: reduce)').matches) this.motion = this.motionTarget = 0;

    this.readColors();
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => this.readColors());
    new ResizeObserver(() => this.resize()).observe(canvas);
    this.resize();
    this.bindInput();
    requestAnimationFrame((t) => this.frame(t));
  }

  /* ---------- публічний API ---------- */

  setChain(chain) {
    const { blocks } = chain;
    this.firstInvalid = chain.firstInvalid;
    for (let i = 0; i < blocks.length; i++) {
      if (!this.nodes[i]) this.nodes[i] = this.makeNode(i);
      this.nodes[i].block = blocks[i];
      if (i > 0 && !this.edges[i]) this.edges[i] = this.pending?.edge ?? this.makeEdge(i);
    }
    this.nodes.length = blocks.length;
    this.edges.length = blocks.length;
    if (this.selected != null && this.selected >= blocks.length) this.select(null);
    if (this.hover != null && this.hover >= blocks.length) this.hover = null;
  }

  clear() {
    this.nodes = [];
    this.edges = [];
    this.pulse = null;
    this.select(null);
  }

  setPending(on) {
    if (!on) {
      this.pending = null;
      return;
    }
    const i = this.nodes.length;
    this.pending = { index: i, x: baseX(i), y: baseY(i), edge: this.makeEdge(i), stage: 'mining', hash: null };
  }

  /** Етап «привида»: 'fields' | 'link' | 'mining' | 'found'. */
  setPendingStage(stage, hash = null) {
    if (this.pending) Object.assign(this.pending, { stage, hash });
  }

  /** Екранні координати (CSS px) блоку з індексом `index` — справжнього або «привида», що майниться. */
  anchorScreen(index) {
    const p = this.pending?.index === index ? this.pending : this.nodes[index];
    if (!p) return null;
    const { cam } = this;
    return { x: this.cx() + (p.x - cam.x) * cam.z, y: this.cy() + (p.y - cam.y) * cam.z, r: R * cam.z };
  }

  flashNode(index, tone = 'accent') {
    const n = this.nodes[index];
    if (n) n.flash = { start: this.real, color: this.c[tone] };
  }

  select(index, { silent = false } = {}) {
    this.selected = index;
    if (!silent) this.onSelect(index);
  }

  setInset(inset) {
    this.inset = { left: 0, right: 0, bottom: 0, ...inset };
    if (!this.view) this.view = { ...this.inset };
    if (this.autoFit) this.fit({ instant: true });
  }

  setMotion(on) {
    this.motionTarget = on ? 1 : 0;
  }

  get moving() {
    return this.motionTarget > 0;
  }

  runPulse() {
    if (this.nodes.length) this.pulse = { start: this.real, reached: -1 };
  }

  /** Вміщує ланцюг у видиму область; довгий ланцюг — показує його кінець. */
  fit({ instant = false } = {}) {
    const pts = this.nodes.map((n) => [n.bx + n.ox, n.by + n.oy]);
    if (this.pending) pts.push([this.pending.x, this.pending.y]);
    if (!pts.length) return;
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const aw = Math.max(240, this.w - this.inset.left - this.inset.right - 48);
    const ah = Math.max(200, this.h - this.inset.bottom - 48);
    const bw = maxX - minX + 2 * (R + 60);
    const bh = maxY - minY + 2 * (R + 60);
    let z = Math.min(aw / bw, ah / bh, 1.3);
    if (z < 0.55) {
      z = 0.85;
      const [lx, ly] = pts[pts.length - 1];
      this.target = { x: lx - (aw * 0.3) / z, y: ly, z };
    } else {
      this.target = { x: (minX + maxX) / 2, y: (minY + maxY) / 2, z };
    }
    if (instant) this.cam = { ...this.target };
    // Поки користувач сам не рухав камеру, граф перевміщується при зміні розміру вікна.
    this.autoFit = true;
  }

  /* ---------- внутрішнє ---------- */

  makeNode(i) {
    return {
      index: i,
      bx: baseX(i),
      by: baseY(i),
      ox: 0,
      oy: 0,
      x: baseX(i),
      y: baseY(i),
      still: 1,
      born: this.real,
      flash: null,
      block: null,
      s: [rand(i + 1) * TAU, rand(i + 2.3) * TAU, rand(i + 5.1) * TAU, rand(i + 7.7) * TAU],
      f: [0.8 + rand(i + 9.2) * 0.4, 0.8 + rand(i + 11.4) * 0.4],
    };
  }

  makeEdge(i) {
    return {
      to: i,
      born: this.real,
      phase: rand(i + 3.3) * TAU,
      amp: 0,
      k: 1,
      s: [rand(i + 13.1) * TAU, rand(i + 17.9) * TAU, rand(i + 19.7) * TAU, rand(i + 23.3) * TAU],
    };
  }

  readColors() {
    const style = getComputedStyle(document.documentElement);
    const v = (name) => style.getPropertyValue(name).trim();
    this.c = {
      node: v('--node'), text: v('--text'), muted: v('--muted'), ring: v('--ring'), edge: v('--edge'),
      grid: v('--grid'), accent: v('--accent'), ok: v('--ok'), bad: v('--bad'),
    };
  }

  resize() {
    this.dpr = window.devicePixelRatio || 1;
    this.w = this.canvas.clientWidth;
    this.h = this.canvas.clientHeight;
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
    if (this.autoFit) this.fit({ instant: true });
  }

  cx() { const v = this.view ?? this.inset; return (v.left + this.w - v.right) / 2; }
  cy() { const v = this.view ?? this.inset; return (this.h - v.bottom) / 2; }

  toWorld(sx, sy, cam = this.cam) {
    return { x: cam.x + (sx - this.cx()) / cam.z, y: cam.y + (sy - this.cy()) / cam.z };
  }

  hit(p) {
    for (let i = this.nodes.length - 1; i >= 0; i--) {
      const n = this.nodes[i];
      if (Math.hypot(n.x - p.x, n.y - p.y) <= R + 4) return n;
    }
    return null;
  }

  isUntrusted(index) {
    return this.firstInvalid != null && index > this.firstInvalid;
  }

  bindInput() {
    const cv = this.canvas;

    cv.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      cv.setPointerCapture(e.pointerId);
      const node = this.hit(this.toWorld(e.offsetX, e.offsetY));
      this.drag = {
        node, sx: e.offsetX, sy: e.offsetY, moved: false,
        camX: this.cam.x, camY: this.cam.y, ox: node?.ox ?? 0, oy: node?.oy ?? 0,
      };
    });

    cv.addEventListener('pointermove', (e) => {
      const d = this.drag;
      if (!d) {
        const node = this.hit(this.toWorld(e.offsetX, e.offsetY));
        this.hover = node ? node.index : null;
        cv.style.cursor = node ? 'pointer' : 'grab';
        return;
      }
      const dx = e.offsetX - d.sx;
      const dy = e.offsetY - d.sy;
      if (!d.moved && Math.hypot(dx, dy) < 4) return;
      d.moved = true;
      cv.style.cursor = 'grabbing';
      const z = this.cam.z;
      if (d.node) {
        d.node.ox = d.ox + dx / z;
        d.node.oy = d.oy + dy / z;
      } else {
        this.autoFit = false;
        this.cam.x = this.target.x = d.camX - dx / z;
        this.cam.y = this.target.y = d.camY - dy / z;
      }
    });

    const end = (e) => {
      const d = this.drag;
      if (!d) return;
      this.drag = null;
      // Клік по ноді вибирає її (повторний — знімає вибір), по порожньому місцю — знімає вибір.
      if (!d.moved) this.select(d.node && d.node.index !== this.selected ? d.node.index : null);
      const node = this.hit(this.toWorld(e.offsetX, e.offsetY));
      cv.style.cursor = node ? 'pointer' : 'grab';
    };
    cv.addEventListener('pointerup', end);
    cv.addEventListener('pointercancel', end);
    cv.addEventListener('pointerleave', () => { if (!this.drag) this.hover = null; });

    cv.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.autoFit = false;
      const t = this.target;
      const z1 = clamp(t.z * Math.exp(-e.deltaY * 0.0016), 0.3, 3);
      const w = this.toWorld(e.offsetX, e.offsetY, t);
      t.x = w.x - (e.offsetX - this.cx()) / z1;
      t.y = w.y - (e.offsetY - this.cy()) / z1;
      t.z = z1;
    }, { passive: false });

    cv.addEventListener('dblclick', (e) => {
      if (!this.hit(this.toWorld(e.offsetX, e.offsetY))) this.fit();
    });
  }

  frame(now) {
    // Мітка rAF може бути трохи раніше за performance.now() — dt не має бути від'ємним.
    const dt = clamp((now - this.last) / 1000, 0, 0.05);
    this.last = now;
    this.real += dt;
    this.motion += (this.motionTarget - this.motion) * Math.min(1, dt * 3);
    this.clock += dt * this.motion;

    const k = Math.min(1, dt * 9);
    this.cam.x += (this.target.x - this.cam.x) * k;
    this.cam.y += (this.target.y - this.cam.y) * k;
    this.cam.z += (this.target.z - this.cam.z) * k;
    if (this.view) {
      const kv = Math.min(1, dt * 8);
      for (const side of ['left', 'right', 'bottom']) this.view[side] += (this.inset[side] - this.view[side]) * kv;
    }

    // Наступний кадр плануємо першим: помилка в одному кадрі не має зупиняти анімацію назавжди.
    requestAnimationFrame((t) => this.frame(t));
    try {
      this.update(dt);
      this.draw();
    } catch (err) {
      if (!this.reported) console.error(err);
      this.reported = true;
    } finally {
      this.ctx.setLineDash([]);
      this.ctx.globalAlpha = 1;
    }
  }

  /** Повільний дрейф ноди: дві синусоїди з несумірними частотами. */
  drift(n, t) {
    const a = 4.5 * n.still;
    return [
      a * (0.62 * Math.sin(t * 0.41 * n.f[0] + n.s[0]) + 0.38 * Math.sin(t * 0.67 * n.f[1] + n.s[1])),
      a * (0.62 * Math.sin(t * 0.33 * n.f[1] + n.s[2]) + 0.38 * Math.sin(t * 0.59 * n.f[0] + n.s[3])),
    ];
  }

  stepEdge(e, dt, t) {
    // Кутова швидкість хвилі змінюється в часі → період не сталий.
    const omega = 1.25 * (1 + 0.5 * Math.sin(t * 0.17 + e.s[0]) + 0.28 * Math.sin(t * 0.43 + e.s[1]));
    e.phase += dt * this.motion * omega;
    e.amp = 7 + 4.5 * Math.sin(t * 0.21 + e.s[2]);
    e.k = 1 + 0.4 * Math.sin(t * 0.11 + e.s[3]);
  }

  update(dt) {
    const t = this.clock;
    for (const n of this.nodes) {
      const want = this.drag?.node === n ? 0 : 1;
      n.still += (want - n.still) * Math.min(1, dt * 5);
      const [dx, dy] = this.drift(n, t);
      n.x = n.bx + n.ox + dx;
      n.y = n.by + n.oy + dy;
    }
    for (const e of this.edges) if (e) this.stepEdge(e, dt, t);

    if (this.pending) {
      const p = this.pending;
      this.stepEdge(p.edge, dt, t);
      p.x = baseX(p.index) + 3 * Math.sin(t * 0.5);
      p.y = baseY(p.index) + 3 * Math.cos(t * 0.37);
    }

    const pulse = this.pulse;
    if (pulse) {
      const pos = (this.real - pulse.start) / 0.28;
      const last = this.nodes.length - 1;
      const reached = Math.min(Math.floor(pos), last);
      while (pulse.reached < reached) {
        pulse.reached++;
        const n = this.nodes[pulse.reached];
        const bad = !n.block.valid || this.isUntrusted(n.index);
        n.flash = { start: this.real, color: bad ? this.c.bad : this.c.ok };
      }
      pulse.pos = pos;
      if (pos > last + 0.8) this.pulse = null;
    }
  }

  edgePoint(e, a, b, u) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    const wave = Math.sin(TAU * e.k * u - e.phase) + 0.3 * Math.sin(TAU * 1.7 * e.k * u + 0.6 * e.phase + e.s[0]);
    const off = Math.sin(Math.PI * u) * e.amp * wave;
    return [a.x + dx * u + nx * off, a.y + dy * u + ny * off];
  }

  /* ---------- малювання ---------- */

  draw() {
    const { ctx, dpr, cam } = this;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);
    ctx.setTransform(dpr * cam.z, 0, 0, dpr * cam.z, dpr * (this.cx() - cam.x * cam.z), dpr * (this.cy() - cam.y * cam.z));

    this.drawGrid();
    for (const e of this.edges) if (e) this.drawEdge(e);
    if (this.pending) this.drawPending();
    this.drawPulse();
    for (const n of this.nodes) this.drawNode(n);
    const top = this.hover ?? this.selected;
    if (top != null && this.nodes[top]) this.drawCaption(this.nodes[top]);
  }

  drawGrid() {
    const { ctx, cam } = this;
    const step = cam.z < 0.6 ? 80 : 40;
    const x0 = cam.x - this.cx() / cam.z;
    const y0 = cam.y - this.cy() / cam.z;
    const x1 = x0 + this.w / cam.z;
    const y1 = y0 + this.h / cam.z;
    const s = 1.4 / cam.z;
    ctx.fillStyle = this.c.grid;
    for (let x = Math.floor(x0 / step) * step; x <= x1; x += step) {
      for (let y = Math.floor(y0 / step) * step; y <= y1; y += step) ctx.fillRect(x - s / 2, y - s / 2, s, s);
    }
  }

  strokeCurve(e, a, b, until = 1) {
    const { ctx } = this;
    ctx.beginPath();
    const steps = Math.max(2, Math.round(SAMPLES * until));
    for (let s = 0; s <= steps; s++) {
      const [x, y] = this.edgePoint(e, a, b, (s / steps) * until);
      if (s === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  drawEdge(e) {
    const a = this.nodes[e.to - 1];
    const b = this.nodes[e.to];
    if (!a || !b) return;
    const { ctx } = this;
    const broken = !b.block.linkOk;
    const grow = clamp((this.real - e.born) / 0.6, 0, 1);
    ctx.globalAlpha = this.isUntrusted(e.to) && !broken ? 0.35 : 1;
    ctx.strokeStyle = broken ? this.c.bad : this.c.edge;
    ctx.lineWidth = 1.5;
    ctx.setLineDash(broken ? [5, 5] : []);
    this.strokeCurve(e, a, b, 1 - (1 - grow) ** 3);
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }

  drawPending() {
    const { ctx, c } = this;
    const p = this.pending;
    const stage = p.stage ?? 'mining';
    const prev = this.nodes[p.index - 1];
    const color = stage === 'found' ? c.ok : c.accent;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    if (prev) {
      // На кроці «вміст блоку» зв'язок із попереднім блоком підсвічується.
      ctx.globalAlpha = stage === 'link' ? 1 : 0.5;
      ctx.lineWidth = stage === 'link' ? 2 : 1.5;
      ctx.setLineDash(stage === 'found' ? [] : [3, 6]);
      ctx.lineDashOffset = -this.real * 30;
      this.strokeCurve(p.edge, prev, p);
    }
    ctx.globalAlpha = 1;
    ctx.lineWidth = stage === 'found' ? 2 : 1.5;
    ctx.setLineDash(stage === 'found' ? [] : [4, 5]);
    ctx.beginPath();
    ctx.arc(p.x, p.y, R, 0, TAU);
    ctx.fillStyle = c.node;
    ctx.fill();
    ctx.globalAlpha = stage === 'found' ? 1 : 0.45;
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.lineDashOffset = 0;
    ctx.globalAlpha = 1;
    if (stage === 'mining') {
      ctx.lineWidth = 2;
      ctx.beginPath();
      const a = this.real * 4;
      ctx.arc(p.x, p.y, R, a, a + 1.3);
      ctx.stroke();
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = stage === 'found' ? c.text : c.muted;
    ctx.font = `600 13px ${SANS}`;
    ctx.fillText(String(p.index), p.x, p.y + 0.5);
    ctx.fillStyle = stage === 'found' ? c.ok : c.muted;
    ctx.font = stage === 'found' ? `10px ${MONO}` : `500 11px ${SANS}`;
    const label = stage === 'found' && p.hash ? p.hash.slice(0, 8) : stage === 'mining' ? 'nonce…' : 'новий';
    ctx.fillText(label, p.x, p.y + R + 14);
  }

  drawPulse() {
    const p = this.pulse;
    if (!p || p.pos == null) return;
    const seg = Math.floor(p.pos) + 1;
    if (seg >= this.nodes.length) return;
    const e = this.edges[seg];
    if (!e) return;
    const [x, y] = this.edgePoint(e, this.nodes[seg - 1], this.nodes[seg], p.pos - Math.floor(p.pos));
    const bad = this.firstInvalid != null && seg - 1 >= this.firstInvalid;
    const { ctx } = this;
    ctx.fillStyle = bad ? this.c.bad : this.c.accent;
    ctx.globalAlpha = 0.18;
    ctx.beginPath();
    ctx.arc(x, y, 10, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.beginPath();
    ctx.arc(x, y, 3.5, 0, TAU);
    ctx.fill();
  }

  drawNode(n) {
    const { ctx, c } = this;
    const b = n.block;
    if (!b) return;
    const age = clamp((this.real - n.born) / 0.55, 0, 1);
    const r = R * (age < 1 ? easeOutBack(age) : 1);
    if (r <= 0.5) return;

    const selected = this.selected === n.index;
    const hovered = this.hover === n.index;
    const color = !b.valid ? c.bad : selected ? c.accent : hovered ? c.text : c.ring;
    ctx.globalAlpha = this.isUntrusted(n.index) ? 0.45 : 1;

    if (selected) {
      ctx.fillStyle = c.accent;
      ctx.globalAlpha *= 0.14;
      ctx.beginPath();
      ctx.arc(n.x, n.y, r + 8, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = this.isUntrusted(n.index) ? 0.45 : 1;
    }

    ctx.beginPath();
    ctx.arc(n.x, n.y, r, 0, TAU);
    ctx.fillStyle = c.node;
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = selected || !b.valid ? 2 : 1.5;
    ctx.stroke();

    // Внутрішнє кільце генезису — лише коли нода вже достатньо виросла (інакше радіус < 0).
    if (n.index === 0 && r > 6) {
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.arc(n.x, n.y, r - 4, 0, TAU);
      ctx.stroke();
    }

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = !b.valid ? c.bad : c.text;
    ctx.font = `600 13px ${SANS}`;
    ctx.fillText(String(n.index), n.x, n.y + 0.5);

    ctx.fillStyle = !b.hashOk ? c.bad : c.muted;
    ctx.font = `10px ${MONO}`;
    ctx.fillText(b.hash.slice(0, 8), n.x, n.y + r + 14);

    if (n.flash) {
      const t = (this.real - n.flash.start) / 0.9;
      if (t >= 1) n.flash = null;
      else {
        ctx.strokeStyle = n.flash.color;
        ctx.lineWidth = 2;
        ctx.globalAlpha = (1 - t) * 0.9;
        ctx.beginPath();
        ctx.arc(n.x, n.y, r + 3 + t * 16, 0, TAU);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }

  drawCaption(n) {
    const { ctx } = this;
    const text = n.block.data.length > 30 ? `${n.block.data.slice(0, 29)}…` : n.block.data;
    ctx.font = `12px ${SANS}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = this.c.text;
    ctx.fillText(text, n.x, n.y - R - 16);
  }
}
