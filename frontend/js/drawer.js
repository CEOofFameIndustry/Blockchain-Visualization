// Ліва висувна панель із посиланнями автора.
//
// Наведення на лівий верхній кут показує язичок зі стрілкою; клік відкриває панель.
// Закрити: стрілка в панелі, Esc або клік по язичку ще раз.

import { LINKS } from './links.js';

const ICONS = {
  youtube: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2" y="5" width="20" height="14" rx="4.5" fill="currentColor"/><path d="M10 9.2v5.6l4.8-2.8z" fill="var(--icon-fg)"/></svg>`,
  github: `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2a10 10 0 0 0-3.16 19.49c.5.09.68-.22.68-.48v-1.7c-2.78.6-3.37-1.34-3.37-1.34-.45-1.16-1.1-1.47-1.1-1.47-.91-.62.07-.6.07-.6 1 .07 1.53 1.03 1.53 1.03.9 1.52 2.34 1.08 2.91.83.09-.65.35-1.08.63-1.33-2.22-.25-4.55-1.11-4.55-4.94 0-1.09.39-1.98 1.03-2.68-.1-.26-.45-1.27.1-2.65 0 0 .84-.27 2.75 1.02a9.58 9.58 0 0 1 5 0c1.91-1.29 2.75-1.02 2.75-1.02.55 1.38.2 2.39.1 2.65.64.7 1.03 1.59 1.03 2.68 0 3.84-2.34 4.68-4.57 4.93.36.31.68.92.68 1.85v2.75c0 .27.18.58.69.48A10 10 0 0 0 12 2z"/></svg>`,
  site: `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.6 2.6 3.9 5.6 3.9 9s-1.3 6.4-3.9 9c-2.6-2.6-3.9-5.6-3.9-9S9.4 5.6 12 3z"/></svg>`,
};
const CHEVRON = `<svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3.5 10.5 8 6 12.5"/></svg>`;
const OUT = `<svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3.5h6.5V10M12.5 3.5 4 12"/></svg>`;

/** Приймає лише http(s)-адреси. */
function safeUrl(raw) {
  try {
    const url = new URL(String(raw ?? '').trim());
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch {
    return null;
  }
}

function card(link) {
  const url = safeUrl(link.url);
  const el = document.createElement(url ? 'a' : 'div');
  el.className = 'link-card';
  el.dataset.icon = link.icon in ICONS ? link.icon : 'site';
  if (url) {
    el.href = url;
    el.target = '_blank';
    el.rel = 'noopener noreferrer';
    el.title = url;
  } else {
    el.classList.add('empty');
    el.setAttribute('aria-disabled', 'true');
    el.title = 'Посилання ще не додано: впишіть url у frontend/js/links.js';
  }

  const icon = document.createElement('span');
  icon.className = 'link-icon';
  icon.innerHTML = ICONS[el.dataset.icon];

  const text = document.createElement('span');
  text.className = 'link-text';
  const title = document.createElement('b');
  title.textContent = link.title;
  const sub = document.createElement('small');
  sub.textContent = link.subtitle;
  text.append(title, sub);

  const arrow = document.createElement('span');
  arrow.className = 'link-out';
  arrow.innerHTML = OUT;

  el.append(icon, text, arrow);
  return el;
}

export function createDrawer({ onChange } = {}) {
  const tab = document.createElement('button');
  tab.type = 'button';
  tab.className = 'drawer-tab';
  tab.id = 'drawer-tab';
  tab.title = 'Посилання автора';
  tab.setAttribute('aria-label', 'Відкрити посилання автора');
  tab.setAttribute('aria-expanded', 'false');
  tab.setAttribute('aria-controls', 'drawer');
  tab.innerHTML = CHEVRON;

  const hot = document.createElement('div');
  hot.className = 'drawer-hot';
  hot.setAttribute('aria-hidden', 'true');

  const drawer = document.createElement('aside');
  drawer.className = 'drawer';
  drawer.id = 'drawer';
  drawer.setAttribute('aria-label', 'Посилання автора');
  drawer.hidden = true;

  const head = document.createElement('header');
  head.className = 'drawer-head';
  const h = document.createElement('h2');
  h.textContent = 'Автор';
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'icon-btn drawer-close';
  close.setAttribute('aria-label', 'Сховати посилання');
  close.title = 'Сховати (Esc)';
  close.innerHTML = CHEVRON;
  head.append(h, close);

  const list = document.createElement('nav');
  list.className = 'link-list';
  list.append(...LINKS.map(card));

  drawer.append(head, list);
  document.body.append(hot, tab, drawer);

  let open = false;
  const set = (value) => {
    open = value;
    document.body.classList.toggle('drawer-open', open);
    tab.setAttribute('aria-expanded', String(open));
    if (open) drawer.hidden = false;
    // Після анімації закриття ховаємо панель від клавіатури й читачів екрана.
    else setTimeout(() => { if (!open) drawer.hidden = true; }, 260);
    onChange?.(open);
  };

  // Наведення на кут: показати язичок (CSS :hover на .drawer-hot + .drawer-tab).
  tab.addEventListener('click', () => set(!open));
  close.addEventListener('click', () => {
    set(false);
    tab.focus({ preventScroll: true });
  });

  return {
    element: drawer,
    get open() { return open; },
    close: () => open && set(false),
  };
}
