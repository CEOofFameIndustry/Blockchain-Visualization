import { api } from './api.js';
import { Graph } from './graph.js';
import { createLog } from './log.js';
import { Explainer } from './explainer.js';
import { createDrawer } from './drawer.js';

const $ = (id) => document.getElementById(id);
const log = createLog($('log'));
const nf = new Intl.NumberFormat('uk-UA');

let chain = null;
let busy = false;
let shownIndex = null;

const graph = new Graph($('scene'), { onSelect: (i) => renderDetails(i) });
const explainer = new Explainer(graph);

/* ---------- геометрія: полотно центрується у вільній від панелі області ---------- */

const panel = $('panel');
// Панель посилань лягає поверх полотна і не впливає на розміщення графа.
const drawer = createDrawer();

function measureInset() {
  const r = panel.getBoundingClientRect();
  if (innerWidth <= 720) {
    graph.setInset({ left: 0, right: 0, bottom: innerHeight - r.top });
    return;
  }
  graph.setInset({ left: 0, right: innerWidth - r.left, bottom: 0 });
}
new ResizeObserver(measureInset).observe(panel);

/* ---------- висота панелі: тягнути за нижню ручку ---------- */

const grip = $('panel-grip');
const PANEL_KEY = 'panelHeight';
function setPanelHeight(h) {
  panel.classList.toggle('sized', h != null);
  panel.style.height = h == null ? '' : `${h}px`;
}
try {
  const saved = Number(localStorage.getItem(PANEL_KEY));
  if (saved > 0) setPanelHeight(Math.min(saved, innerHeight - 32));
} catch { /* сховище недоступне */ }
grip.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  e.preventDefault();
  grip.setPointerCapture(e.pointerId);
  grip.classList.add('dragging');
  const startY = e.clientY;
  const startH = panel.offsetHeight;
  const move = (ev) => setPanelHeight(Math.max(220, Math.min(innerHeight - 32, startH + ev.clientY - startY)));
  const up = () => {
    grip.classList.remove('dragging');
    grip.removeEventListener('pointermove', move);
    grip.removeEventListener('pointerup', up);
    grip.removeEventListener('pointercancel', up);
    try { localStorage.setItem(PANEL_KEY, String(panel.offsetHeight)); } catch { /* ignore */ }
  };
  grip.addEventListener('pointermove', move);
  grip.addEventListener('pointerup', up);
  grip.addEventListener('pointercancel', up);
});
grip.addEventListener('dblclick', () => {
  setPanelHeight(null);
  try { localStorage.removeItem(PANEL_KEY); } catch { /* ignore */ }
});
addEventListener('resize', measureInset);
measureInset();

/* ---------- відображення стану ---------- */

const fmtMs = (micros) => (micros < 1000 ? `${micros} мкс` : `${(micros / 1000).toFixed(micros < 10000 ? 1 : 0)} мс`);
const fmtTime = (ms) => new Date(ms).toLocaleString('uk-UA', { hour12: false });

function renderHash(el, hash, difficulty) {
  const zeros = hash.match(/^0*/)[0].slice(0, difficulty);
  const strong = document.createElement('span');
  strong.className = 'zeros';
  strong.textContent = zeros;
  el.replaceChildren(strong, document.createTextNode(hash.slice(zeros.length)));
}

function renderSummary() {
  const status = $('status');
  if (busy) {
    status.dataset.tone = 'busy';
  } else if (chain.valid) {
    status.dataset.tone = 'ok';
    status.textContent = 'валідний';
  } else {
    status.dataset.tone = 'bad';
    status.textContent = `порушено з #${chain.firstInvalid}`;
  }
  const tip = chain.blocks.at(-1);
  $('stat-count').textContent = chain.blocks.length;
  $('stat-diff').textContent = chain.difficulty;
  $('stat-mine').textContent = fmtMs(tip.mineMicros);
  $('stat-mine').title = `${nf.format(tip.attempts)} спроб`;
  if (document.activeElement !== $('difficulty')) {
    $('difficulty').value = chain.difficulty;
    $('difficulty-out').value = chain.difficulty;
  }
}

function problems(b) {
  const list = [];
  if (!b.hashOk) list.push('хеш не відповідає даним');
  if (!b.linkOk) list.push('prevHash ≠ хешу попереднього');
  if (!b.powOk) list.push('хеш не задовольняє складність');
  return list;
}

function renderDetails(index) {
  const b = chain?.blocks[index];
  if (index == null || !b) {
    $('details').hidden = true;
    shownIndex = null;
    return;
  }
  $('details').hidden = false;
  $('d-index').textContent = `#${index}`;

  const state = $('d-state');
  const issues = problems(b);
  const untrusted = !issues.length && chain.firstInvalid != null && index > chain.firstInvalid;
  state.dataset.tone = issues.length || untrusted ? 'bad' : 'ok';
  state.textContent = issues.length ? 'невалідний' : untrusted ? 'після розриву' : 'валідний';
  state.title = issues.join('; ') || (untrusted ? `ланцюг розірвано в блоці #${chain.firstInvalid}` : '');

  $('d-time').textContent = fmtTime(b.timestamp);
  $('d-nonce').textContent = `${nf.format(b.nonce)} · ${fmtMs(b.mineMicros)}`;
  renderHash($('d-hash'), b.hash, b.difficulty);
  $('d-hash').classList.toggle('bad', !b.hashOk || !b.powOk);
  renderHash($('d-prev'), b.prevHash, b.difficulty);
  $('d-prev').classList.toggle('bad', !b.linkOk);
  $('d-computed').textContent = b.computedHash;
  $('d-computed').hidden = $('d-computed-label').hidden = b.hashOk;
  $('d-computed-label').title = 'Хеш, обчислений з поточних даних';

  if (shownIndex !== index) $('d-data').value = b.data;
  shownIndex = index;

  const last = chain.blocks.length - 1;
  $('d-cascade').hidden = index === last;
  $('d-cascade').textContent = `Перемайнити #${index}–#${last}`;
}

function apply(next) {
  chain = next;
  graph.setChain(next);
  renderSummary();
  renderDetails(graph.selected);
}

function setBusy(on, label = 'майнінг…') {
  busy = on;
  for (const id of ['add-btn', 'd-tamper', 'd-mine', 'd-cascade', 'd-explain', 'validate', 'reset', 'difficulty']) $(id).disabled = on;
  if (on) $('status').textContent = label;
  if (chain) renderSummary();
}

async function act(fn, label) {
  if (busy) return null;
  setBusy(true, label);
  try {
    const next = await fn();
    setBusy(false);
    apply(next);
    return next;
  } catch (err) {
    setBusy(false);
    log.add(err.message, 'bad');
    return null;
  }
}

function describeChain(c) {
  if (c.valid) return [`Ланцюг валідний: ${c.blocks.length} блоків перевірено`, 'ok'];
  const b = c.blocks[c.firstInvalid];
  return [`Порушення в блоці #${b.index}: ${problems(b).join(', ')}`, 'bad'];
}

/* ---------- дії ---------- */

$('add-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = $('add-data');
  const data = input.value.trim();
  if (!data) {
    input.focus();
    return;
  }
  if (busy) return;
  if (explainer.active) await explainer.dismiss();
  setBusy(true);
  graph.setPending(true);
  graph.fit();

  let next;
  try {
    next = await api.add(data);
  } catch (err) {
    graph.setPending(false);
    setBusy(false);
    log.add(err.message, 'bad');
    return;
  }
  input.value = '';
  const b = next.blocks.at(-1);

  // Блок уже є в Rust-ядрі; на полотні він з'являється на останньому кроці пояснення.
  const commit = () => {
    graph.setPending(false);
    setBusy(false);
    apply(next);
    graph.fit();
    graph.flashNode(b.index, 'ok');
    log.add(`Блок #${b.index} замайнено: nonce ${nf.format(b.nonce)}, ${nf.format(b.attempts)} спроб, ${fmtMs(b.mineMicros)}`, 'ok');
  };
  if ($('explain-toggle').checked) explainer.play(b, { onCommit: commit });
  else commit();
});

const explainToggle = $('explain-toggle');
try {
  explainToggle.checked = localStorage.getItem('explain') !== 'off';
} catch { /* сховище недоступне — лишаємо типове значення */ }
explainToggle.addEventListener('change', () => {
  try { localStorage.setItem('explain', explainToggle.checked ? 'on' : 'off'); } catch { /* ignore */ }
});

$('difficulty').addEventListener('input', (e) => { $('difficulty-out').value = e.target.value; });
$('difficulty').addEventListener('change', async (e) => {
  const value = Number(e.target.value);
  const next = await act(() => api.difficulty(value), 'зміна…');
  if (next) log.add(`Складність ${value}: хеш нового блоку має починатися з ${'0'.repeat(value)}`);
  e.target.blur();
});

$('validate').addEventListener('click', async () => {
  const next = await act(() => api.chain(), 'перевірка…');
  if (!next) return;
  graph.runPulse();
  log.add(...describeChain(next));
});

$('reset').addEventListener('click', async () => {
  const next = await act(async () => {
    const fresh = await api.reset();
    graph.clear();
    return fresh;
  }, 'скидання…');
  if (!next) return;
  graph.fit();
  log.add('Ланцюг скинуто до початкового стану');
});

$('d-close').addEventListener('click', () => graph.select(null));

$('d-tamper').addEventListener('click', async () => {
  const i = graph.selected;
  const data = $('d-data').value.trim();
  if (i == null) return;
  if (data === chain.blocks[i].data) {
    log.add('Змініть дані в полі, щоб підробити блок', 'warn');
    $('d-data').focus();
    return;
  }
  shownIndex = null;
  const next = await act(() => api.tamper(i, data), 'зміна…');
  if (next) log.add(`Дані блоку #${i} змінено без перерахунку хешу`, 'warn');
});

$('d-mine').addEventListener('click', async () => {
  const i = graph.selected;
  if (i == null) return;
  const next = await act(() => api.remine(i, false));
  if (!next) return;
  const child = next.blocks[i + 1];
  const tail = child && !child.linkOk ? ` — тепер розірвано зв'язок #${i}→#${i + 1}` : '';
  log.add(`Блок #${i} перемайнено: nonce ${nf.format(next.blocks[i].nonce)}${tail}`, tail ? 'warn' : 'ok');
});

$('d-explain').addEventListener('click', async () => {
  const i = graph.selected;
  if (i == null || busy) return;
  await explainer.dismiss();
  explainer.play(chain.blocks[i], { replay: true, hasNext: i < chain.blocks.length - 1 });
});

$('d-cascade').addEventListener('click', async () => {
  const i = graph.selected;
  if (i == null) return;
  const next = await act(() => api.remine(i, true));
  if (!next) return;
  const micros = next.blocks.slice(i).reduce((sum, b) => sum + b.mineMicros, 0);
  log.add(`Перемайнено блоки #${i}–#${next.blocks.length - 1} за ${fmtMs(micros)}`, 'ok');
});

const toggleMotion = () => graph.setMotion(!graph.moving);

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && explainer.active) {
    explainer.close();
    return;
  }
  if (e.key === 'Escape' && drawer.open) {
    drawer.close();
    return;
  }
  const target = e.target instanceof Element ? e.target : document.body;
  if (target.closest('input, textarea') || e.ctrlKey || e.metaKey || e.altKey) return;
  if (explainer.active && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
    e.preventDefault();
    if (e.key === 'ArrowLeft') explainer.prev();
    else explainer.next();
    return;
  }
  if (e.key === 'Escape') graph.select(null);
  else if (e.key === 'f' || e.key === 'F' || e.key === 'а' || e.key === 'А') graph.fit();
  else if (e.key === ' ' && !target.closest('button')) {
    e.preventDefault();
    toggleMotion();
  } else return;
});

/* ---------- старт ---------- */

// Відкрите з'єднання каже Rust-ядру, що вікно живе; після закриття вікна програма завершується.
new EventSource('/api/events');

act(() => api.chain(), 'завантаження…').then((next) => {
  if (!next) return;
  graph.fit({ instant: true });
  log.add(`Підключено до Rust-ядра: ${next.blocks.length} блоків, SHA-256, складність ${next.difficulty}`);
  if (next.storage) {
    log.add(next.restored
      ? `Ланцюг відновлено з диска (${next.storage}) і перевірено: ${next.valid ? 'валідний' : `порушено з #${next.firstInvalid}`}`
      : `Створено новий ланцюг; він зберігається в ${next.storage}`, next.valid ? 'info' : 'bad');
  }
});
