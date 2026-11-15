// Покрокове пояснення створення блоку: картка біля вузла на полотні.
//
// Кроки йдуть самі, але їх можна гортати назад і вперед (кнопки, крапки, ← →);
// після ручного переходу автопрогравання зупиняється. Картка закривається лише кнопкою.
//
// Дані беруться з відповіді Rust-ядра. Проміжні хеші на кроці «Nonce» справжні:
// браузер рахує SHA-256 того самого заголовка, що й Rust
// (index|timestamp|prevHash|difficulty|nonce|data), для кількох nonce до знайденого.

const nf = new Intl.NumberFormat('uk-UA');
const fmtMs = (micros) => (micros < 1000 ? `${micros} мкс` : `${(micros / 1000).toFixed(micros < 10000 ? 1 : 0)} мс`);
const plural = (n, one, few, many) => {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
};

const STEPS = ['Вміст', 'Nonce', 'Хеш', 'Ланцюг'];
const LAST = STEPS.length - 1;
/** Рядки, що з'являються на кожному кроці. */
const STEP_ROWS = [['index', 'time', 'data', 'prev', 'difficulty'], ['formula', 'nonce', 'hash'], [], []];
/** Пауза для читання після анімації кроку (автопрогравання). */
const READ_MS = [1600, 700, 3200];

const TEMPLATE = `
  <div class="explain-head">
    <span class="explain-title" data-ref="title"></span>
    <div class="explain-steps" role="tablist">
      ${STEPS.map((s, i) => `<button type="button" role="tab" data-step="${i}" title="${i + 1}. ${s}" aria-label="Крок ${i + 1}: ${s}"></button>`).join('')}
    </div>
    <button class="icon-btn" type="button" data-ref="close" title="Закрити (Esc)" aria-label="Закрити пояснення">×</button>
  </div>
  <p class="explain-step" data-ref="stepName"></p>
  <p class="explain-caption" data-ref="caption"></p>
  <dl class="explain-fields">
    <div class="f" data-row="index"><dt>Номер</dt><dd></dd></div>
    <div class="f" data-row="time"><dt>Час</dt><dd></dd></div>
    <div class="f" data-row="data"><dt>Дані</dt><dd></dd></div>
    <div class="f" data-row="prev"><dt>Попер. хеш</dt><dd class="mono"></dd></div>
    <div class="f" data-row="difficulty"><dt>Складність</dt><dd></dd></div>
    <div class="f" data-row="formula"><dt>Формула</dt><dd class="mono small">SHA-256(номер | час | попер. хеш | складність | nonce | дані)</dd></div>
    <div class="f" data-row="nonce"><dt>Nonce</dt><dd class="mono"></dd></div>
    <div class="f" data-row="hash"><dt>Хеш</dt><dd class="mono"></dd></div>
  </dl>
  <div class="explain-foot">
    <button class="btn ghost" type="button" data-ref="prev">‹ Назад</button>
    <button class="btn" type="button" data-ref="next">Далі ›</button>
  </div>
`;

async function sha256(text) {
  if (!globalThis.crypto?.subtle) return null;
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const header = (b, nonce) => `${b.index}|${b.timestamp}|${b.prevHash}|${b.difficulty}|${nonce}|${b.data}`;

/** Кілька nonce до знайденого: перші підряд, далі рівномірно. */
function sampleNonces(found, count = 22) {
  if (found <= count) return Array.from({ length: found }, (_, i) => i);
  const head = Array.from({ length: 8 }, (_, i) => i);
  const rest = count - head.length;
  const tail = Array.from({ length: rest }, (_, i) => Math.round(8 + ((found - 9) * (i + 1)) / rest));
  return [...new Set([...head, ...tail])].filter((n) => n < found);
}

export class Explainer {
  constructor(graph) {
    this.graph = graph;
    this.el = document.createElement('section');
    this.el.className = 'explain';
    this.el.hidden = true;
    this.el.setAttribute('aria-live', 'polite');
    this.el.innerHTML = TEMPLATE;
    document.body.append(this.el);
    this.ref = Object.fromEntries([...this.el.querySelectorAll('[data-ref]')].map((n) => [n.dataset.ref, n]));
    this.rows = Object.fromEntries([...this.el.querySelectorAll('[data-row]')].map((n) => [n.dataset.row, n]));
    this.dots = [...this.el.querySelectorAll('[data-step]')];

    this.ref.close.addEventListener('click', () => this.close());
    this.ref.prev.addEventListener('click', () => this.prev());
    this.ref.next.addEventListener('click', () => (this.step >= LAST ? this.close() : this.next()));
    for (const dot of this.dots) dot.addEventListener('click', () => this.goTo(Number(dot.dataset.step), { manual: true }));

    this.active = false;
    this.token = 0;
    this.playing = Promise.resolve();
  }

  /* ---------- керування ---------- */

  /**
   * Показує пояснення для блоку. Promise виконується, коли картку закрито.
   * `onCommit` — блок з'являється в ланцюгу (на останньому кроці або при закритті).
   * `replay` — пояснення для вже наявного блоку (без «привида» на полотні).
   */
  play(block, { onCommit, replay = false, hasNext = false } = {}) {
    this.b = block;
    this.replay = replay;
    this.hasNext = hasNext;
    this.onCommit = onCommit;
    this.committed = replay;
    this.auto = true;
    this.active = true;
    this.samples = Promise.all(sampleNonces(block.nonce).map(async (n) => ({ n, hash: await sha256(header(block, n)) })));

    this.ref.title.replaceChildren(replay ? 'Як створено блок ' : 'Новий блок ', Object.assign(document.createElement('b'), { textContent: `#${block.index}` }));
    this.el.classList.remove('leaving', 'found');
    this.el.hidden = false;
    if (!this.following) this.follow();

    this.playing = new Promise((resolve) => { this.closed = resolve; });
    this.goTo(0);
    return this.playing;
  }

  next() { this.goTo(this.step + 1, { manual: true }); }
  prev() { this.goTo(this.step - 1, { manual: true }); }

  close() {
    if (!this.active) return;
    this.token++;
    this.commit();
    this.active = false;
    this.el.classList.add('leaving');
    setTimeout(() => {
      if (!this.active) this.el.hidden = true;
      this.closed?.();
    }, 260);
  }

  /** Закриває картку (якщо відкрита) і чекає, доки вона зникне. */
  dismiss() {
    this.close();
    return this.playing;
  }

  commit() {
    if (this.committed) return;
    this.committed = true;
    this.onCommit?.();
  }

  /* ---------- кроки ---------- */

  async goTo(k, { manual = false } = {}) {
    if (!this.active) return;
    k = Math.max(0, Math.min(LAST, k));
    if (manual) this.auto = false;
    const token = ++this.token;
    this.step = k;
    if (k === LAST) this.commit();

    this.renderChrome(k);
    this.resetRows(k);
    await this.animate(k, () => token === this.token);
    if (token !== this.token || !this.auto || k >= LAST) return;
    await this.wait(READ_MS[k]);
    if (token === this.token && this.auto) this.goTo(k + 1);
  }

  wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  stage(name, hash) {
    if (!this.committed) this.graph.setPendingStage(name, hash);
  }

  renderChrome(k) {
    this.dots.forEach((d, j) => {
      d.classList.toggle('done', j < k);
      d.classList.toggle('active', j === k);
      d.setAttribute('aria-selected', String(j === k));
    });
    this.ref.stepName.textContent = `Крок ${k + 1} з ${STEPS.length} · ${STEPS[k]}`;
    this.ref.caption.textContent = this.caption(k);
    this.ref.prev.disabled = k === 0;
    this.ref.next.textContent = k >= LAST ? 'Зрозуміло' : 'Далі ›';
    this.el.classList.toggle('found', k >= 2);
  }

  caption(k) {
    const b = this.b;
    const zeros = '0'.repeat(b.difficulty);
    switch (k) {
      case 0:
        return b.index === 0
          ? 'Блок — це запис із кількох полів. Це генезис — перший блок, тому його «попередній хеш» складається з самих нулів.'
          : 'Блок — це запис із кількох полів. Головне з них — хеш попереднього блоку: саме він з’єднує блоки в ланцюг.';
      case 1:
        return `Nonce — число-лічильник. Програма рахує SHA-256 від усього блоку разом із nonce. Якщо хеш не починається з ${zeros}, nonce збільшується на 1 і все повторюється.`;
      case 2: {
        const tries = `${nf.format(b.attempts)} ${plural(b.attempts, 'спроба', 'спроби', 'спроб')}`;
        const base = `Хеш починається з ${zeros} — блок замайнено: ${tries} за ${fmtMs(b.mineMicros)}. Хеш — це «відбиток» вмісту: зміна хоч однієї літери дасть зовсім інший хеш.`;
        return this.replay && !b.hashOk ? `${base} Увага: дані цього блоку змінили вже після майнінгу, тому зараз його хеш не збігається з вмістом.` : base;
      }
      default:
        return this.replay && this.hasNext
          ? `Блок #${b.index + 1} зберігає цей хеш як «попередній». Якщо змінити блок #${b.index}, його хеш зміниться і зв’язок розірветься.`
          : 'Блок додано в кінець ланцюга. Наступний блок збереже цей хеш як «попередній», тож непомітно змінити цей блок уже не вийде.';
    }
  }

  /** Рядки попередніх кроків показано одразу, рядки поточного — сховано для анімації. */
  resetRows(k) {
    const b = this.b;
    STEP_ROWS.forEach((names, j) => {
      for (const name of names) this.rows[name].classList.toggle('on', j < k);
    });
    this.text('index', `${b.index}`);
    this.text('time', new Date(b.timestamp).toLocaleTimeString('uk-UA', { hour12: false }));
    this.text('data', b.data);
    this.text('prev', `${b.prevHash.slice(0, 20)}…`);
    this.text('difficulty', `${b.difficulty} — хеш має починатися з ${'0'.repeat(b.difficulty)}`);
    if (k >= 2) {
      this.text('nonce', nf.format(b.nonce));
      this.renderHash(b.hash, true);
    }
  }

  async animate(k, alive) {
    const b = this.b;
    const show = (name) => this.rows[name].classList.add('on');
    if (k === 0) {
      this.stage('fields');
      for (const name of ['index', 'time', 'data']) {
        show(name);
        await this.wait(450);
        if (!alive()) return;
      }
      this.stage('link');
      this.graph.flashNode(b.index - 1);
      show('prev');
      await this.wait(900);
      if (!alive()) return;
      this.stage('fields');
      show('difficulty');
    } else if (k === 1) {
      this.stage('mining');
      this.text('nonce', '0');
      this.rows.hash.querySelector('dd').replaceChildren();
      show('formula');
      show('nonce');
      show('hash');
      await this.wait(700);
      const samples = await this.samples;
      const tick = Math.max(70, 2400 / Math.max(1, samples.length));
      for (const { n, hash } of samples) {
        if (!alive()) return;
        this.text('nonce', nf.format(n));
        if (hash) this.renderHash(hash, false);
        await this.wait(tick);
      }
    } else if (k === 2) {
      this.stage('found', b.hash);
    }
  }

  text(row, value) {
    this.rows[row].querySelector('dd').textContent = value;
  }

  renderHash(hash, ok) {
    const d = this.b.difficulty;
    const head = Object.assign(document.createElement('span'), { className: ok ? 'ok' : 'bad', textContent: hash.slice(0, d) });
    const mark = Object.assign(document.createElement('span'), { className: `${ok ? 'ok' : 'bad'} mark`, textContent: ok ? ' ✓' : ' ✗' });
    this.rows.hash.querySelector('dd').replaceChildren(head, hash.slice(d), mark);
  }

  /* ---------- розміщення ---------- */

  /** Тримає картку поруч із вузлом і не дає їй накрити його. */
  follow() {
    this.following = this.active || !this.el.hidden;
    if (!this.following) return;
    const p = this.b && this.graph.anchorScreen(this.b.index);
    if (p) {
      const w = this.el.offsetWidth;
      const h = this.el.offsetHeight;
      const m = 16;
      const minX = this.graph.inset.left + m;
      const maxX = this.graph.w - this.graph.inset.right - w - m;
      const maxY = this.graph.h - this.graph.inset.bottom - h - m;
      const gap = p.r + 30;
      const clampX = (x) => Math.max(minX, Math.min(maxX, x));
      const clampY = (y) => Math.max(m, Math.min(maxY, y));
      // Порядок: над вузлом, під ним, ліворуч, праворуч — перше місце, де картка не накриває вузол.
      const spots = [
        [clampX(p.x - w / 2), p.y - gap - h],
        [clampX(p.x - w / 2), p.y + gap],
        [p.x - gap - w, clampY(p.y - h / 2)],
        [p.x + gap, clampY(p.y - h / 2)],
      ];
      const fits = ([x, y]) => x >= minX && x <= maxX && y >= m && y <= maxY;
      const [left, top] = spots.find(fits) ?? [clampX(p.x - w / 2), clampY(p.y + gap)];
      this.el.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
    }
    requestAnimationFrame(() => this.follow());
  }
}
