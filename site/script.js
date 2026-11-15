// Сайт курсової: тема, бокова хронологія з хвилястими зв'язками і золотою точкою,
// майнінг розділів-блоків у браузері. Звичайний скрипт (не модуль), щоб сторінка
// працювала й при відкритті файлу з диска.

(() => {
  const root = document.documentElement;
  const TAU = Math.PI * 2;
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const darkMedia = matchMedia('(prefers-color-scheme: dark)');
  // Псевдовипадкове число з seed — фази променів і зв'язків однакові при кожному відкритті.
  const rand = (seed) => { const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

  /* ---------- тема ---------- */

  const themeBtn = document.getElementById('theme');
  const currentTheme = () => root.dataset.theme || (darkMedia.matches ? 'dark' : 'light');
  let colors = {};
  let onThemeChange = () => {};
  function readColors() {
    const s = getComputedStyle(root);
    const v = (n) => s.getPropertyValue(n).trim();
    colors = { edge: v('--edge'), trail: v('--gold'), glow: v('--glow') };
  }
  function syncTheme() {
    const mode = currentTheme();
    themeBtn.dataset.mode = mode;
    themeBtn.setAttribute('aria-label', mode === 'dark' ? 'Увімкнути світлу тему' : 'Увімкнути темну тему');
    themeBtn.title = themeBtn.getAttribute('aria-label');
    readColors();
    onThemeChange();
  }
  themeBtn.addEventListener('click', () => {
    root.dataset.theme = currentTheme() === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem('site-theme', root.dataset.theme); } catch (e) { /* ignore */ }
    syncTheme();
  });
  darkMedia.addEventListener('change', syncTheme);
  syncTheme();

  const sections = [...document.querySelectorAll('.block')];

  /* ---------- вузли хронології (лише на головній сторінці) ---------- */

  (function timeline() {
    const list = document.getElementById('rail-list');
    if (!list || !sections.length) return;
    const railScroll = document.getElementById('rail-scroll');
    const canvas = document.getElementById('rail-canvas');
    const ctx = canvas.getContext('2d');
    const count = document.getElementById('rail-count');
    const bar = document.getElementById('progress-bar');

    const nodes = sections.map((section, i) => {
      section.querySelector('.block-no').textContent = `Блок #${i}`;
      const a = document.createElement('a');
      a.className = 'node';
      a.href = `#${section.id}`;
      // Легкий зсув по синусоїді, як розташування блоків на полотні програми.
      a.style.marginLeft = `${Math.round(10 + 10 * Math.sin(i * 1.3))}px`;
      const dot = document.createElement('span');
      dot.className = 'node-dot';
      dot.textContent = String(i);
      const text = document.createElement('span');
      text.className = 'node-text';
      const year = document.createElement('b');
      year.textContent = section.dataset.year;
      const label = document.createElement('span');
      label.textContent = section.dataset.short;
      text.append(year, label);
      a.append(dot, text);
      list.append(a);
      return { a, dot };
    });

    // Фази й частоти кожного зв'язку — детерміновано з номера, як у graph.js програми.
    const edges = nodes.map((_, i) => ({
      phase: rand(i + 3.3) * TAU,
      s: [rand(i + 13.1) * TAU, rand(i + 17.9) * TAU, rand(i + 19.7) * TAU, rand(i + 23.3) * TAU],
      amp: 0,
      k: 1,
    }));

    let centers = [];
    let dpr = 1;
    function layout() {
      dpr = window.devicePixelRatio || 1;
      const w = list.offsetWidth;
      const h = list.offsetHeight;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      const base = list.getBoundingClientRect();
      centers = nodes.map(({ dot }) => {
        const r = dot.getBoundingClientRect();
        return { x: r.left - base.left + r.width / 2, y: r.top - base.top + r.height / 2, r: r.width / 2 };
      });
    }
    new ResizeObserver(layout).observe(list);
    addEventListener('resize', layout);
    layout();

    /** Точка на хвилястому зв'язку між вузлами i−1 та i (u ∈ [0, 1]). */
    function edgePoint(i, u) {
      const a = centers[i - 1];
      const b = centers[i];
      const e = edges[i];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.hypot(dx, dy) || 1;
      const wave = Math.sin(TAU * e.k * u - e.phase) + 0.3 * Math.sin(TAU * 1.7 * e.k * u + 0.6 * e.phase + e.s[0]);
      const off = Math.sin(Math.PI * u) * e.amp * wave;
      return [a.x + dx * u - (dy / len) * off, a.y + dy * u + (dx / len) * off];
    }

    function strokeEdge(i, from, to) {
      const steps = Math.max(2, Math.round(24 * (to - from)));
      ctx.beginPath();
      for (let s = 0; s <= steps; s++) {
        const [x, y] = edgePoint(i, from + ((to - from) * s) / steps);
        if (s === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }

    /* ---------- прогрес гортання ---------- */

    /** Дробовий номер розділу, до якого дочитано: 2.4 — між розділами 2 і 3. */
    function scrollProgress() {
      const probe = innerHeight * 0.35;
      const doc = document.scrollingElement || root;
      if (doc.scrollTop + innerHeight >= doc.scrollHeight - 2) return sections.length - 1;
      const tops = sections.map((s) => s.getBoundingClientRect().top - probe);
      if (tops[0] > 0) return 0;
      let i = 0;
      while (i < tops.length - 1 && tops[i + 1] <= 0) i++;
      if (i >= tops.length - 1) return tops.length - 1;
      return i + clamp(-tops[i] / (tops[i + 1] - tops[i]), 0, 1);
    }

    let shown = scrollProgress();
    let active = -1;
    let clock = 0;
    let last = performance.now();

    function setActive(index) {
      if (index === active) return;
      active = index;
      nodes.forEach(({ a }, j) => {
        a.classList.toggle('active', j === index);
        a.classList.toggle('passed', j < index);
        if (j === index) a.setAttribute('aria-current', 'step');
        else a.removeAttribute('aria-current');
      });
      count.textContent = `${index + 1} / ${sections.length}`;
      // Тримаємо активний вузол у видимій частині хронології.
      const a = nodes[index].a;
      const top = a.offsetTop - railScroll.clientHeight / 2 + a.offsetHeight / 2;
      railScroll.scrollTo({ top, behavior: reduceMotion.matches ? 'auto' : 'smooth' });
    }

    function frame(now) {
      requestAnimationFrame(frame);
      const dt = clamp((now - last) / 1000, 0, 0.05);
      last = now;
      const moving = !reduceMotion.matches;
      if (moving) clock += dt;

      // Точка плавно наздоганяє позицію гортання.
      const target = scrollProgress();
      shown += (target - shown) * (moving ? Math.min(1, dt * 8) : 1);
      if (Math.abs(target - shown) < 0.0005) shown = target;
      // Активний — розділ, який зараз читають; точка тим часом повзе до наступного.
      setActive(Math.floor(shown + 0.001));
      if (bar) bar.style.width = `${(shown / Math.max(1, sections.length - 1)) * 100}%`;

      if (!list.offsetParent || !centers.length) return; // хронологію сховано (вузький екран)

      // Хвиля зв'язків: фаза накопичується зі змінною швидкістю — період не сталий.
      for (const e of edges) {
        const omega = 1.25 * (1 + 0.5 * Math.sin(clock * 0.17 + e.s[0]) + 0.28 * Math.sin(clock * 0.43 + e.s[1]));
        if (moving) e.phase += dt * omega;
        e.amp = 3.2 + 2 * Math.sin(clock * 0.21 + e.s[2]);
        e.k = 1 + 0.4 * Math.sin(clock * 0.11 + e.s[3]);
      }

      // Очищаємо в пікселях полотна (без масштабу): при масштабі сторінки < 100%
      // devicePixelRatio < 1, і clearRect у масштабованих координатах не покривав низ полотна.
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.lineWidth = 1.5;
      ctx.lineCap = 'round';
      const passedEdge = Math.floor(shown);
      const frac = shown - passedEdge;
      for (let i = 1; i < centers.length; i++) {
        ctx.strokeStyle = colors.edge;
        ctx.globalAlpha = 1;
        strokeEdge(i, 0, 1);
        // Пройдена частина ланцюга — золота.
        const done = i <= passedEdge ? 1 : i === passedEdge + 1 ? frac : 0;
        if (done > 0) {
          ctx.strokeStyle = colors.trail;
          ctx.globalAlpha = 0.9;
          strokeEdge(i, 0, done);
        }
      }
      ctx.globalAlpha = 1;

      // Точка на зв'язку між поточним і наступним розділом.
      const i = Math.min(passedEdge + 1, centers.length - 1);
      const [x, y] = i > passedEdge ? edgePoint(i, frac) : [centers[i].x, centers[i].y];
      // Золота точка з м'яким сяйвом.
      const halo = ctx.createRadialGradient(x, y, 0, x, y, 16);
      halo.addColorStop(0, colors.glow);
      halo.addColorStop(1, 'transparent');
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(x, y, 16, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = colors.glow;
      ctx.beginPath();
      ctx.arc(x, y, 4.5, 0, TAU);
      ctx.fill();
    }
    requestAnimationFrame(frame);
  })();

  /* ---------- світло на обкладинці ---------- */

  // Об'ємні промені з правого верхнього кута. Промені малюються в зниженій
  // роздільності й розтягуються — так вони природно розмиті, без різких країв.
  // Кожен промінь має свою ширину, яскравість і повільне «дихання»; біля джерела
  // сяйво; пил світиться лише тоді, коли потрапляє в промінь.
  (function heroLight() {
    const hero = document.querySelector('.hero');
    const cv = document.getElementById('hero-light');
    if (!hero || !cv) return;
    const g = cv.getContext('2d');
    const off = document.createElement('canvas');
    const o = off.getContext('2d');
    const LOW = 0.3;
    const SRC = { x: 0.88, y: -0.1 }; // джерело світла в частках обкладинки

    let W = 0;
    let H = 0;
    let ratio = 1;
    let dark = true;
    let rayRGB = [255, 195, 77];
    let dustRGB = [255, 214, 140];
    let visible = true;
    let t = 0;
    let prev = performance.now();
    let rafId = 0;

    const rays = Array.from({ length: 15 }, (_, i) => ({
      a: Math.PI * (0.55 + 0.4 * (i / 14)) + (rand(i + 41.7) - 0.5) * 0.06,
      w: 0.012 + rand(i + 51.3) * 0.045,
      I: 0.3 + rand(i + 61.9) * 0.7,
      s1: 0.18 + rand(i + 71.1) * 0.4,
      s2: 0.04 + rand(i + 81.5) * 0.1,
      p: rand(i + 91.2) * TAU,
      // поточний стан кадру
      ca: 0,
      cw: 0,
      cI: 0,
    }));
    const dust = Array.from({ length: 120 }, (_, i) => ({
      x: rand(i + 101.3),
      y: rand(i + 131.7),
      r: 0.5 + rand(i + 151.9) * 1.5,
      vx: -0.003 - rand(i + 171.1) * 0.007,
      vy: 0.002 + rand(i + 191.3) * 0.007,
      tw: rand(i + 211.7) * TAU,
      ts: 0.5 + rand(i + 231.3) * 1.4,
    }));

    const hexToRgb = (hex) => {
      const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
      if (!m) return [255, 195, 77];
      const n = parseInt(m[1], 16);
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    };
    const rgba = ([r, gr, b], a) => `rgba(${r},${gr},${b},${Math.max(0, a).toFixed(3)})`;

    function refresh() {
      dark = currentTheme() === 'dark';
      const glow = hexToRgb(getComputedStyle(root).getPropertyValue('--glow'));
      // Темна тема: золоте світло додається до тла (screen).
      // Світла: майже біле тепле світло поверх блідо-золотого тла — промені світліші за тло.
      rayRGB = dark ? glow : [255, 250, 235];
      dustRGB = dark ? [255, 222, 160] : [196, 140, 52];
      cv.style.mixBlendMode = dark ? 'screen' : 'normal';
      if (!running()) render(0);
    }

    function resize() {
      ratio = Math.min(window.devicePixelRatio || 1, 2);
      W = hero.clientWidth;
      H = hero.clientHeight;
      cv.width = Math.max(1, Math.round(W * ratio));
      cv.height = Math.max(1, Math.round(H * ratio));
      off.width = Math.max(1, Math.round(W * LOW));
      off.height = Math.max(1, Math.round(H * LOW));
      if (!running()) render(0);
    }

    function drawRays() {
      const w = off.width;
      const h = off.height;
      const sx = w * SRC.x;
      const sy = h * SRC.y;
      const L = Math.hypot(w, h) * 1.15;
      const k = dark ? 1 : 1.35;
      o.setTransform(1, 0, 0, 1, 0, 0);
      o.globalCompositeOperation = 'source-over';
      o.clearRect(0, 0, w, h);
      o.globalCompositeOperation = 'lighter';
      for (const r of rays) {
        const breathe = (0.7 + 0.3 * Math.sin(t * r.s1 + r.p)) * (0.85 + 0.15 * Math.sin(t * r.s2 * 2.3 + r.p * 1.7));
        r.ca = r.a + 0.02 * Math.sin(t * r.s2 + r.p);
        r.cw = r.w * (0.88 + 0.12 * Math.sin(t * r.s1 * 0.7 + r.p));
        r.cI = r.I * breathe;
        const I = r.cI * k;
        const grad = o.createRadialGradient(sx, sy, 0, sx, sy, L);
        grad.addColorStop(0, rgba(rayRGB, I * 0.5));
        grad.addColorStop(0.22, rgba(rayRGB, I * 0.3));
        grad.addColorStop(0.55, rgba(rayRGB, I * 0.1));
        grad.addColorStop(1, rgba(rayRGB, 0));
        o.fillStyle = grad;
        o.beginPath();
        o.moveTo(sx, sy);
        o.lineTo(sx + L * Math.cos(r.ca - r.cw / 2), sy + L * Math.sin(r.ca - r.cw / 2));
        o.lineTo(sx + L * Math.cos(r.ca + r.cw / 2), sy + L * Math.sin(r.ca + r.cw / 2));
        o.closePath();
        o.fill();
      }
      // Сяйво самого джерела і легкий серпанок навколо.
      const R = Math.max(w, h) * 0.75;
      const halo = o.createRadialGradient(sx, sy, 0, sx, sy, R);
      halo.addColorStop(0, rgba(rayRGB, 0.6 * k));
      halo.addColorStop(0.25, rgba(rayRGB, 0.22 * k));
      halo.addColorStop(0.6, rgba(rayRGB, 0.05 * k));
      halo.addColorStop(1, rgba(rayRGB, 0));
      o.fillStyle = halo;
      o.fillRect(0, 0, w, h);
    }

    function drawDust(dt) {
      const sx = W * SRC.x;
      const sy = H * SRC.y;
      const L = Math.hypot(W, H) * 1.15;
      g.setTransform(ratio, 0, 0, ratio, 0, 0);
      g.globalCompositeOperation = dark ? 'lighter' : 'source-over';
      for (const d of dust) {
        d.x += d.vx * dt;
        d.y += d.vy * dt;
        if (d.x < -0.02) d.x += 1.04;
        if (d.y > 1.02) d.y -= 1.04;
        const px = d.x * W;
        const py = d.y * H;
        const ang = Math.atan2(py - sy, px - sx);
        let lit = 0;
        for (const r of rays) {
          const inside = 1 - Math.abs(ang - r.ca) / (r.cw * 0.5 + 0.006);
          if (inside > 0) lit += inside * r.cI;
        }
        if (lit <= 0) continue;
        const fade = Math.max(0, 1 - Math.hypot(px - sx, py - sy) / L);
        const twinkle = 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(t * d.ts + d.tw));
        const a = Math.min(1, lit) * fade * twinkle * (dark ? 0.9 : 0.55);
        if (a < 0.02) continue;
        g.fillStyle = rgba(dustRGB, a * 0.22);
        g.beginPath();
        g.arc(px, py, d.r * 3.2, 0, TAU);
        g.fill();
        g.fillStyle = rgba(dustRGB, a);
        g.beginPath();
        g.arc(px, py, d.r, 0, TAU);
        g.fill();
      }
      g.globalCompositeOperation = 'source-over';
    }

    function render(dt) {
      drawRays();
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, cv.width, cv.height);
      g.imageSmoothingEnabled = true;
      g.imageSmoothingQuality = 'high';
      g.drawImage(off, 0, 0, cv.width, cv.height);
      drawDust(dt);
    }

    const running = () => visible && !reduceMotion.matches && rafId !== 0;

    function tick(now) {
      const dt = clamp((now - prev) / 1000, 0, 0.05);
      prev = now;
      t += dt;
      render(dt);
      rafId = visible && !reduceMotion.matches ? requestAnimationFrame(tick) : 0;
    }

    function start() {
      if (rafId || reduceMotion.matches || !visible) return;
      prev = performance.now();
      rafId = requestAnimationFrame(tick);
    }

    // Анімуємо лише поки обкладинку видно.
    new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      if (visible) start();
    }).observe(hero);
    new ResizeObserver(resize).observe(hero);
    reduceMotion.addEventListener('change', () => (reduceMotion.matches ? render(0) : start()));

    onThemeChange = refresh;
    resize();
    refresh();
    t = 12; // не з нуля, щоб промені одразу мали різну фазу
    render(0);
    start();
  })();

  /* ---------- сторінка «Про автора» ---------- */

  (function authorLinks() {
    const nav = document.getElementById('author-links');
    if (!nav) return;
    const data = window.SITE_AUTHOR || { name: '', links: [] };

    const title = document.getElementById('author-title');
    if (title && data.name && data.name.trim()) {
      const em = document.createElement('em');
      em.textContent = `${data.name.trim()}.`;
      title.replaceChildren(em);
    }

    const ICONS = {
      youtube: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2" y="5" width="20" height="14" rx="4.5" fill="currentColor"/><path d="M10 9.2v5.6l4.8-2.8z" fill="var(--bg)"/></svg>',
      github: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2a10 10 0 0 0-3.16 19.49c.5.09.68-.22.68-.48v-1.7c-2.78.6-3.37-1.34-3.37-1.34-.45-1.16-1.1-1.47-1.1-1.47-.91-.62.07-.6.07-.6 1 .07 1.53 1.03 1.53 1.03.9 1.52 2.34 1.08 2.91.83.09-.65.35-1.08.63-1.33-2.22-.25-4.55-1.11-4.55-4.94 0-1.09.39-1.98 1.03-2.68-.1-.26-.45-1.27.1-2.65 0 0 .84-.27 2.75 1.02a9.58 9.58 0 0 1 5 0c1.91-1.29 2.75-1.02 2.75-1.02.55 1.38.2 2.39.1 2.65.64.7 1.03 1.59 1.03 2.68 0 3.84-2.34 4.68-4.57 4.93.36.31.68.92.68 1.85v2.75c0 .27.18.58.69.48A10 10 0 0 0 12 2z"/></svg>',
      site: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.6 2.6 3.9 5.6 3.9 9s-1.3 6.4-3.9 9c-2.6-2.6-3.9-5.6-3.9-9S9.4 5.6 12 3z"/></svg>',
    };

    /** Приймає лише http(s)-адреси. */
    const safeUrl = (raw) => {
      try {
        const url = new URL(String(raw || '').trim());
        return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
      } catch (e) {
        return null;
      }
    };

    for (const link of data.links || []) {
      const url = safeUrl(link.url);
      const row = document.createElement(url ? 'a' : 'div');
      row.className = 'social';
      if (url) {
        row.href = url;
        row.target = '_blank';
        row.rel = 'noopener noreferrer';
      } else {
        row.classList.add('empty');
        row.setAttribute('aria-disabled', 'true');
        row.title = 'Посилання ще не додано: впишіть url у site/links.js';
      }
      const icon = document.createElement('span');
      icon.className = 'social-icon';
      icon.innerHTML = ICONS[link.icon] || ICONS.site;
      const text = document.createElement('span');
      text.className = 'social-text';
      const name = document.createElement('b');
      name.textContent = link.title;
      const sub = document.createElement('small');
      sub.textContent = url ? link.subtitle : `${link.subtitle} · незабаром`;
      text.append(name, sub);
      const arrow = document.createElement('span');
      arrow.className = 'social-arrow';
      arrow.setAttribute('aria-hidden', 'true');
      arrow.textContent = '↗';
      row.append(icon, text, arrow);
      nav.append(row);
    }
  })();

  /* ---------- майнінг розділів ---------- */

  const DIFFICULTY = 3;
  const ZEROS = '0'.repeat(DIFFICULTY);
  const BATCH = 128;
  const enc = new TextEncoder();

  async function sha256(text) {
    const buf = await crypto.subtle.digest('SHA-256', enc.encode(text));
    let out = '';
    for (const b of new Uint8Array(buf)) out += b.toString(16).padStart(2, '0');
    return out;
  }

  function hashSpan(hash) {
    const span = document.createElement('span');
    const zeros = document.createElement('b');
    zeros.className = 'zeros';
    zeros.textContent = hash.slice(0, DIFFICULTY);
    span.append(zeros, `${hash.slice(DIFFICULTY, 16)}…`);
    return span;
  }

  function metaPart(label, content) {
    const span = document.createElement('span');
    const i = document.createElement('i');
    i.textContent = `${label} `;
    span.append(i, content);
    return span;
  }

  async function mineSections() {
    const metas = sections.map((s) => s.querySelector('.meta'));
    if (!globalThis.crypto?.subtle) {
      metas.forEach((m) => { m.textContent = 'Цей браузер не дає порахувати SHA-256 (WebCrypto недоступний).'; });
      return;
    }
    metas.forEach((m) => m.classList.add('mining'));
    let prev = '0'.repeat(64);
    for (const [i, section] of sections.entries()) {
      const title = section.querySelector('h2').textContent.trim();
      const header = (nonce) => `${i}|${section.dataset.year}|${prev}|${DIFFICULTY}|${nonce}|${title}`;
      let nonce = 0;
      let hash = null;
      while (!hash) {
        const batch = await Promise.all(Array.from({ length: BATCH }, (_, k) => sha256(header(nonce + k))));
        const k = batch.findIndex((h) => h.startsWith(ZEROS));
        if (k >= 0) {
          hash = batch[k];
          nonce += k;
        } else {
          nonce += BATCH;
        }
      }
      const meta = metas[i];
      meta.classList.remove('mining');
      const prevShort = document.createElement('span');
      prevShort.textContent = `${prev.slice(0, 12)}…`;
      meta.replaceChildren(
        metaPart('попер.', prevShort),
        metaPart('nonce', new Intl.NumberFormat('uk-UA').format(nonce)),
        metaPart('хеш', hashSpan(hash)),
      );
      meta.title = `SHA-256(${i} | ${section.dataset.year} | попередній хеш | ${DIFFICULTY} | ${nonce} | заголовок) = ${hash}`;
      prev = hash;
    }
  }
  if (sections.length) mineSections();
})();
